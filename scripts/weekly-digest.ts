// Weekly digest for taprun.dev — aggregates GSC + Ahrefs + Clarity.
//
// Run locally (needs logged-in Chrome via Tap bridge):
//   deno run --allow-all scripts/weekly-digest.ts
//   deno run --allow-all scripts/weekly-digest.ts --out digest-$(date +%Y-W%U).md
//
// Ahrefs + Clarity go through `tap run ...` subprocess (MCP tap bridge must
// be running + logged-in). GSC uses the same OAuth refresh_token as
// gsc-ping.ts / gsc-insights.ts (~/.google-oauth-token.ga-admin).
//
// Prints markdown to stdout; --out writes to a file. State (for WoW deltas)
// lives at ~/.taprun-weekly-state.json — the first run seeds baseline, the
// second run starts surfacing Δ arrows.

const SITE_URL = "https://taprun.dev/";
const GSC_CLIENT = "/Users/leo/Documents/keystore/client_secret_200215826367-rjr1bmvh2okj7umq1ijb3bfv5n9idm3i.apps.googleusercontent.com.json";
const GSC_TOKEN = `${Deno.env.get("HOME")}/.google-oauth-token.ga-admin`;
const AHREFS_PROJECT = "9680757";
const CLARITY_PROJECT = "wcmkaafekz";
const GA4_PROPERTY = "356723562";
const CF_ZONE = "c0ea314ee2cd7f483c43ea91b69ea131";
const CF_ANALYTICS_TOKEN_PATH = `${Deno.env.get("HOME")}/.cloudflare-token.analytics`;
const GH_REPO = "LeonTing1010/tap";
const STATE_FILE = `${Deno.env.get("HOME")}/.taprun-weekly-state.json`;
const DAYS = 7;

const args = Deno.args;
const outIdx = args.indexOf("--out");
const outFile = outIdx >= 0 ? args[outIdx + 1] : null;

// ─── ISO week label ─────────────────────────────────────────────
function isoWeek(d: Date): { year: number; week: number } {
  const t = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const day = t.getUTCDay() || 7;
  t.setUTCDate(t.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(t.getUTCFullYear(), 0, 1));
  return { year: t.getUTCFullYear(), week: Math.ceil(((+t - +yearStart) / 86400000 + 1) / 7) };
}

const now = new Date();
const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 23, 59, 59));
const start = new Date(end.getTime() - (DAYS - 1) * 86400000);
start.setUTCHours(0, 0, 0, 0);
const { year, week } = isoWeek(end);
const periodLabel = `${start.toISOString().slice(0, 10)} → ${end.toISOString().slice(0, 10)}`;
const weekLabel = `${year}-W${String(week).padStart(2, "0")}`;

// ─── Shared helpers ─────────────────────────────────────────────
async function runTap(site: string, name: string, tapArgs: Record<string, unknown>): Promise<Array<Record<string, string>> | null> {
  try {
    const argPairs: string[] = [];
    for (const [k, v] of Object.entries(tapArgs)) {
      argPairs.push(`--${k}`, String(v));
    }
    const p = new Deno.Command("tap", {
      args: ["run", `${site}/${name}`, ...argPairs, "--format", "json"],
      stdout: "piped",
      stderr: "piped",
    });
    const { success, stdout, stderr } = await p.output();
    if (!success) {
      console.error(`[tap ${site}/${name}] failed: ${new TextDecoder().decode(stderr).slice(0, 300)}`);
      return null;
    }
    const text = new TextDecoder().decode(stdout);
    const json = JSON.parse(text);
    return json.rows ?? json ?? null;
  } catch (e) {
    console.error(`[tap ${site}/${name}] ${e instanceof Error ? e.message : e}`);
    return null;
  }
}

async function gscAccessToken(): Promise<string | null> {
  try {
    const client = JSON.parse(await Deno.readTextFile(GSC_CLIENT)).installed;
    const token = JSON.parse(await Deno.readTextFile(GSC_TOKEN));
    const res = await fetch(client.token_uri, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: client.client_id,
        client_secret: client.client_secret,
        refresh_token: token.refresh_token,
        grant_type: "refresh_token",
      }),
    });
    if (!res.ok) throw new Error(await res.text());
    return (await res.json()).access_token;
  } catch (e) {
    console.error(`[gsc token] ${e instanceof Error ? e.message : e}`);
    return null;
  }
}

async function gscQuery(token: string, dims: string[]): Promise<Array<{ keys: string[]; clicks: number; impressions: number; ctr: number; position: number }>> {
  const res = await fetch(
    `https://www.googleapis.com/webmasters/v3/sites/${encodeURIComponent(SITE_URL)}/searchAnalytics/query`,
    {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        startDate: start.toISOString().slice(0, 10),
        endDate: end.toISOString().slice(0, 10),
        dimensions: dims,
        rowLimit: 500,
      }),
    },
  );
  if (!res.ok) return [];
  return (await res.json()).rows ?? [];
}

// ─── State (WoW deltas) ─────────────────────────────────────────
interface WeekSnapshot {
  week: string;
  period: string;
  ahrefsVisitors: number | null;
  ahrefsVisits: number | null;
  ahrefsViews: number | null;
  ahrefsBounceRate: number | null;
  claritySessions: number | null;
  clarityBot: number | null;
  clarityDeadPct: number | null;
  clarityQuickBackPct: number | null;
  gscClicks: number | null;
  gscImpressions: number | null;
  gscQueries: number | null;
  ghViews: number | null;
  ghUniqueViewers: number | null;
  ghClones: number | null;
  cfPageViews: number | null;
  cfRequests: number | null;
  refDomainsReal: number | null;
  refDomainsSpam: number | null;
}

async function loadState(currentWeek: string): Promise<WeekSnapshot | null> {
  try {
    const txt = await Deno.readTextFile(STATE_FILE);
    const arr = JSON.parse(txt) as WeekSnapshot[];
    // Return most recent snapshot STRICTLY before the current week (so re-runs
    // within the same week compare against last week, not themselves).
    const prior = arr.filter((s) => s.week < currentWeek);
    return prior.length > 0 ? prior[prior.length - 1] : null;
  } catch {
    return null;
  }
}

async function appendState(snap: WeekSnapshot): Promise<void> {
  let arr: WeekSnapshot[] = [];
  try {
    arr = JSON.parse(await Deno.readTextFile(STATE_FILE));
  } catch { /* new file */ }
  // Replace same-week snapshot if re-run
  arr = arr.filter((s) => s.week !== snap.week);
  arr.push(snap);
  await Deno.writeTextFile(STATE_FILE, JSON.stringify(arr, null, 2));
}

const fmtDelta = (cur: number | null, prev: number | null, reverse = false): string => {
  if (cur == null || prev == null || prev === 0) return "";
  const d = cur - prev;
  const pct = (d / prev) * 100;
  const arrow = d > 0 ? (reverse ? "🔻" : "🔺") : d < 0 ? (reverse ? "🔺" : "🔻") : "➖";
  return ` ${arrow} ${d > 0 ? "+" : ""}${pct.toFixed(0)}%`;
};

// ─── GitHub Traffic API ──────────────────────────────────────────
interface GhTraffic { count: number; uniques: number }
interface GhReferrer { referrer: string; count: number; uniques: number }
async function ghApi<T>(path: string): Promise<T | null> {
  try {
    const p = new Deno.Command("gh", { args: ["api", path], stdout: "piped", stderr: "piped" });
    const { success, stdout } = await p.output();
    if (!success) return null;
    return JSON.parse(new TextDecoder().decode(stdout)) as T;
  } catch {
    return null;
  }
}

// ─── Cloudflare Web Analytics (GraphQL) ──────────────────────────
async function cfAnalytics(): Promise<{ requests: number; pageViews: number; uniques: number; threats: number } | null> {
  try {
    const token = (await Deno.readTextFile(CF_ANALYTICS_TOKEN_PATH)).trim();
    const since = start.toISOString().slice(0, 10);
    const q = `query { viewer { zones(filter: { zoneTag: "${CF_ZONE}" }) { httpRequests1dGroups(limit: 10, filter: { date_geq: "${since}" }) { sum { requests pageViews threats } uniq { uniques } } } } }`;
    const res = await fetch("https://api.cloudflare.com/client/v4/graphql", {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ query: q }),
    });
    const j = await res.json();
    const groups = j?.data?.viewer?.zones?.[0]?.httpRequests1dGroups ?? [];
    if (groups.length === 0) return null;
    return groups.reduce((a: { requests: number; pageViews: number; uniques: number; threats: number }, g: { sum: { requests: number; pageViews: number; threats: number }; uniq: { uniques: number } }) => ({
      requests: a.requests + (g.sum?.requests ?? 0),
      pageViews: a.pageViews + (g.sum?.pageViews ?? 0),
      uniques: a.uniques + (g.uniq?.uniques ?? 0),
      threats: a.threats + (g.sum?.threats ?? 0),
    }), { requests: 0, pageViews: 0, uniques: 0, threats: 0 });
  } catch {
    return null;
  }
}

// GA4 Data API intentionally NOT pulled.
//
// With only the default `page_view` event firing on taprun.dev, GA4 returns
// the same pageviews/sessions/sources numbers Ahrefs + CF Analytics already
// give us — zero unique signal. Re-add this block ONCE custom events like
// install_click / blog_scroll_complete / tap_demo_view are instrumented;
// that's what makes GA4 earn its section in the digest.

// ─── Fetch all sources in parallel ──────────────────────────────
const [overview, sources, pages, clarity, refdomains, gscToken, ghViews, ghClones, ghReferrers, cf] = await Promise.all([
  runTap("ahrefs", "web-analytics-overview", { project_id: AHREFS_PROJECT, days: DAYS }),
  runTap("ahrefs", "web-analytics-sources", { project_id: AHREFS_PROJECT, days: DAYS }),
  runTap("ahrefs", "web-analytics-pages", { project_id: AHREFS_PROJECT, days: DAYS, view: "top" }),
  runTap("clarity", "dashboard-insights", { project_id: CLARITY_PROJECT, days: DAYS }),
  runTap("ahrefs", "referring-domains", { target: "taprun.dev", project_id: AHREFS_PROJECT, mode: "subdomains" }),
  gscAccessToken(),
  ghApi<GhTraffic>(`repos/${GH_REPO}/traffic/views`),
  ghApi<GhTraffic>(`repos/${GH_REPO}/traffic/clones`),
  ghApi<GhReferrer[]>(`repos/${GH_REPO}/traffic/popular/referrers`),
  cfAnalytics(),
]);

const gscByQuery = gscToken ? await gscQuery(gscToken, ["query"]) : [];
const gscByPage = gscToken ? await gscQuery(gscToken, ["page"]) : [];
const gscTotals = gscToken ? await gscQuery(gscToken, []) : [];

// ─── Unpack ────────────────────────────────────────────────────
const ovRow = (k: string) => (overview?.find((r) => r.metric === k)?.value) ?? "";
const clRow = (k: string) => (clarity?.find((r) => r.metric === k)?.value) ?? "";
const pctFromStr = (s: string) => Number(s.replace("%", "")) || null;

const realRefDomains = refdomains ? refdomains.filter((r) => String(r.is_spam) === "false") : null;
const spamRefDomains = refdomains ? refdomains.filter((r) => String(r.is_spam) === "true") : null;

const curSnap: WeekSnapshot = {
  week: weekLabel,
  period: periodLabel,
  ahrefsVisitors: overview ? Number(ovRow("unique_visitors")) : null,
  ahrefsVisits: overview ? Number(ovRow("total_visits")) : null,
  ahrefsViews: overview ? Number(ovRow("total_views")) : null,
  ahrefsBounceRate: overview ? pctFromStr(ovRow("bounce_rate")) : null,
  claritySessions: clarity ? Number(clRow("total_sessions")) : null,
  clarityBot: clarity ? Number(clRow("total_bot_sessions")) : null,
  clarityDeadPct: clarity ? pctFromStr(clRow("dead_clicks_pct")) : null,
  clarityQuickBackPct: clarity ? pctFromStr(clRow("quick_backs_pct")) : null,
  gscClicks: gscTotals[0] ? gscTotals[0].clicks : null,
  gscImpressions: gscTotals[0] ? gscTotals[0].impressions : null,
  gscQueries: gscByQuery.length || null,
  ghViews: ghViews?.count ?? null,
  ghUniqueViewers: ghViews?.uniques ?? null,
  ghClones: ghClones?.count ?? null,
  cfPageViews: cf?.pageViews ?? null,
  cfRequests: cf?.requests ?? null,
  refDomainsReal: realRefDomains?.length ?? null,
  refDomainsSpam: spamRefDomains?.length ?? null,
};

const prev = await loadState(weekLabel);
const d = (f: keyof WeekSnapshot, reverse = false): string =>
  fmtDelta(curSnap[f] as number | null, prev?.[f] as number | null ?? null, reverse);

// ─── Compose markdown ───────────────────────────────────────────
const lines: string[] = [];
const p = (s: string) => lines.push(s);

p(`# 📊 taprun.dev Weekly Digest — ${weekLabel}`);
p(``);
p(`**Period**: ${periodLabel} (${DAYS}d) ${prev ? `  ·  previous: ${prev.week}` : `  ·  baseline week — no WoW yet`}`);
p(``);
p(`## TL;DR`);
p(``);
p(`| Metric | Value | WoW |`);
p(`|---|---|---|`);
p(`| Ahrefs visitors | ${curSnap.ahrefsVisitors ?? "—"} |${d("ahrefsVisitors")} |`);
p(`| Ahrefs visits | ${curSnap.ahrefsVisits ?? "—"} |${d("ahrefsVisits")} |`);
p(`| Ahrefs pageviews | ${curSnap.ahrefsViews ?? "—"} |${d("ahrefsViews")} |`);
p(`| Bounce rate | ${ovRow("bounce_rate") || "—"} |${d("ahrefsBounceRate", true)} |`);
p(`| Clarity sessions | ${curSnap.claritySessions ?? "—"} (bot ${curSnap.clarityBot ?? 0}) |${d("claritySessions")} |`);
p(`| Dead clicks | ${clRow("dead_clicks_pct") || "—"} |${d("clarityDeadPct", true)} |`);
p(`| Quick backs | ${clRow("quick_backs_pct") || "—"} |${d("clarityQuickBackPct", true)} |`);
p(`| GSC clicks (${DAYS}d) | ${curSnap.gscClicks ?? "—"} |${d("gscClicks")} |`);
p(`| GSC impressions | ${curSnap.gscImpressions ?? "—"} |${d("gscImpressions")} |`);
p(`| Distinct queries | ${curSnap.gscQueries ?? "—"} |${d("gscQueries")} |`);
p(`| GitHub repo views | ${curSnap.ghViews ?? "—"} (${curSnap.ghUniqueViewers ?? 0} unique) |${d("ghViews")} |`);
p(`| GitHub clones | ${curSnap.ghClones ?? "—"} |${d("ghClones")} |`);
p(`| CF pageviews | ${curSnap.cfPageViews ?? "—"} |${d("cfPageViews")} |`);
p(`| CF total requests | ${curSnap.cfRequests ?? "—"} |${d("cfRequests")} |`);
p(`| **Real ref domains** | **${curSnap.refDomainsReal ?? "—"}** |${d("refDomainsReal")} |`);
p(`| (spam ref domains) | ${curSnap.refDomainsSpam ?? "—"} |${d("refDomainsSpam")} |`);
p(``);

// ─── Traffic sources ────────────────────────────────────────
if (sources && sources.length) {
  p(`## 🌍 Traffic sources (Ahrefs)`);
  p(``);
  p(`| Source | Visitors | Bounce | Avg dur |`);
  p(`|---|---|---|---|`);
  for (const s of sources) {
    const br = Number(s.session_bounce_rate || 0);
    const avg = Number(s.avg_session_duration_sec || 0);
    const dur = `${Math.floor(avg / 60)}:${String(Math.round(avg % 60)).padStart(2, "0")}`;
    p(`| ${s.source} | ${s.visitors} | ${(br * 100).toFixed(0)}% | ${dur} |`);
  }
  p(``);
}

// ─── Top pages ──────────────────────────────────────────────
if (pages && pages.length) {
  p(`## 📄 Top pages (Ahrefs)`);
  p(``);
  p(`| URL | Visitors | Bounce | Avg dur | Flag |`);
  p(`|---|---|---|---|---|`);
  for (const r of pages.slice(0, 10)) {
    const url = String(r.url).replace("https://taprun.dev", "") || "/";
    const br = Number(r.session_bounce_rate || 0);
    const avg = Number(r.avg_page_visit_duration_sec || 0);
    const dur = `${Math.floor(avg / 60)}:${String(Math.round(avg % 60)).padStart(2, "0")}`;
    const flag = br === 1 && avg === 0 ? "🤖 likely unfurler/bot" :
                 br === 0 ? "⭐ zero bounce — strong page" :
                 br >= 0.9 ? "⚠️ dead-end" : "";
    p(`| \`${url}\` | ${r.visitors} | ${(br * 100).toFixed(0)}% | ${dur} | ${flag} |`);
  }
  p(``);
}

// ─── GSC queries ────────────────────────────────────────────
if (gscByQuery.length) {
  p(`## 🔍 Google Search queries (${DAYS}d)`);
  p(``);
  p(`| Query | Impressions | Clicks | CTR | Avg pos |`);
  p(`|---|---|---|---|---|`);
  for (const r of gscByQuery.sort((a, b) => b.impressions - a.impressions).slice(0, 10)) {
    p(`| \`${r.keys[0]}\` | ${r.impressions} | ${r.clicks} | ${(r.ctr * 100).toFixed(1)}% | ${r.position.toFixed(1)} |`);
  }
  p(``);
}

// ─── GSC page coverage ──────────────────────────────────────
if (gscByPage.length) {
  p(`## 📑 Pages with Google impressions (${DAYS}d)`);
  p(``);
  p(`| URL | Impressions | Clicks | Avg pos |`);
  p(`|---|---|---|---|`);
  for (const r of gscByPage.sort((a, b) => b.impressions - a.impressions).slice(0, 10)) {
    const url = String(r.keys[0]).replace("https://taprun.dev", "") || "/";
    p(`| \`${url}\` | ${r.impressions} | ${r.clicks} | ${r.position.toFixed(1)} |`);
  }
  p(``);
}

// ─── GitHub referrers ────────────────────────────────────────
if (ghReferrers && ghReferrers.length) {
  p(`## 🐙 GitHub repo referrers (14d — GitHub's fixed window)`);
  p(``);
  p(`| Referrer | Views | Unique |`);
  p(`|---|---|---|`);
  for (const r of ghReferrers.slice(0, 10)) {
    p(`| ${r.referrer} | ${r.count} | ${r.uniques} |`);
  }
  p(``);
}

// ─── Ahrefs referring domains ────────────────────────────────
if (refdomains && refdomains.length) {
  p(`## 🔗 Ahrefs referring domains`);
  p(``);
  const real = (realRefDomains ?? []).slice(0, 15);
  const spam = (spamRefDomains ?? []).slice(0, 5);
  if (real.length) {
    p(`### Real (${realRefDomains?.length ?? 0})`);
    p(``);
    p(`| Domain | DR | Traffic | Links | First seen |`);
    p(`|---|---|---|---|---|`);
    for (const r of real) {
      p(`| ${r.domain} | ${r.dr} | ${r.traffic} | ${r.links_to_target} | ${r.first_seen} |`);
    }
    p(``);
  }
  if (spam.length) {
    p(`<details><summary>Spam backlinks (${spamRefDomains?.length ?? 0}) — ignore, Ahrefs auto-tags</summary>`);
    p(``);
    p(`| Domain | DR |`);
    p(`|---|---|`);
    for (const r of spam) p(`| ${r.domain} | ${r.dr} |`);
    p(``);
    p(`</details>`);
    p(``);
  }
}

// ─── Action items (derived heuristics) ──────────────────────
p(`## 🎯 Derived action items`);
p(``);
const actions: string[] = [];
if (curSnap.clarityDeadPct && curSnap.clarityDeadPct > 20) {
  actions.push(`Dead clicks at ${curSnap.clarityDeadPct.toFixed(1)}% (>20% threshold). Open Clarity → filter dead-click → run \`tap run clarity/recordings-list\` to locate the offending page/element.`);
}
if (curSnap.clarityQuickBackPct && curSnap.clarityQuickBackPct > 10) {
  actions.push(`Quick backs at ${curSnap.clarityQuickBackPct.toFixed(1)}% — visitors land, scan, leave. Check which SERP snippet / inbound link is misleading.`);
}
if (sources) {
  const direct = sources.find((s) => s.source === "direct");
  if (direct && Number(direct.visitors) > (curSnap.ahrefsVisitors || 0) * 0.6) {
    actions.push(`Direct traffic is ${Math.round((Number(direct.visitors) / (curSnap.ahrefsVisitors || 1)) * 100)}% — most visits have no referer. Tag every external share link with UTM to un-blind this.`);
  }
}
if (curSnap.gscQueries && curSnap.gscQueries < 5) {
  actions.push(`GSC only knows ${curSnap.gscQueries} queries for you. Google hasn't placed the site in its evaluation pool yet — backlinks (awesome-lists, dev.to crossposts) are the lever, not on-page edits.`);
}
if (actions.length === 0) {
  p(`_No threshold triggers — quiet week._`);
} else {
  for (const a of actions) p(`- ${a}`);
}
p(``);

// ─── Footer ──────────────────────────────────────────────────
p(`---`);
p(``);
p(`_Generated ${new Date().toISOString()} by scripts/weekly-digest.ts — data via Ahrefs Web Analytics taps, Clarity dashboard-insights tap, Google Search Analytics API._`);

// ─── Write snapshot for next week's WoW ─────────────────────
await appendState(curSnap);

const out = lines.join("\n") + "\n";
if (outFile) {
  await Deno.writeTextFile(outFile, out);
  console.error(`Wrote ${outFile} (${out.length} bytes)`);
} else {
  console.log(out);
}
