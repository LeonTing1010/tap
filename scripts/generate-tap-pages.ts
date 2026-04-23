// Generate docs/taps/<site>/<name>.html pages from tap-skills/*.tap.json plans.
//
// Runs locally or in CI. Reads .tap.json files under <source>/{showcase,community,skills}/**,
// writes a Jekyll-ready .html per plan. Skips files that already exist unless --force.
// Never touches test/ or plans outside the include list.
//
//   deno run --allow-read --allow-write scripts/generate-tap-pages.ts \
//     --source ../../tap-skills --out docs/taps
//
// Flags:
//   --source <dir>   root of tap-skills checkout (required)
//   --out <dir>      output root (required)
//   --force          overwrite existing files
//   --dry-run        report what would be written, no writes

const args = parseArgs(Deno.args);
if (!args.source || !args.out) {
  console.error("Usage: generate-tap-pages.ts --source <tap-skills-dir> --out <docs/taps> [--force] [--dry-run]");
  Deno.exit(2);
}

const INCLUDE = ["showcase", "community", "skills"];
const REPO = "LeonTing1010/tap-skills";

interface TapPlan {
  body: {
    site: string;
    name: string;
    description?: string;
    intent?: string;
    columns?: string[];
    args?: Record<string, { type?: string; default?: unknown; description?: string }>;
    examples?: Array<Record<string, unknown>>;
    health?: { min_rows?: number; non_empty?: string[] };
  };
}

interface Outcome {
  path: string;
  rel: string;
  status: "written" | "skipped-exists" | "skipped-invalid" | "written-forced";
  reason?: string;
}

const outcomes: Outcome[] = [];

for (const top of INCLUDE) {
  const topDir = `${args.source}/${top}`;
  try { await Deno.stat(topDir); } catch { continue; }
  for await (const siteEntry of Deno.readDir(topDir)) {
    if (!siteEntry.isDirectory) continue;
    const siteDir = `${topDir}/${siteEntry.name}`;
    // Dedupe: if both .tap.json and .tap.js exist for same name, prefer .tap.json.
    const seen = new Set<string>();
    const files: Array<{ name: string; ext: string }> = [];
    for await (const f of Deno.readDir(siteDir)) {
      if (!f.isFile) continue;
      if (f.name.endsWith(".tap.json")) files.push({ name: f.name, ext: ".tap.json" });
      else if (f.name.endsWith(".tap.js")) files.push({ name: f.name, ext: ".tap.js" });
    }
    files.sort((a, b) => a.ext.localeCompare(b.ext)); // .tap.js first, .tap.json second, so .tap.json wins dedup
    for (const f of files) {
      const base = f.name.replace(/\.tap\.(json|js)$/, "");
      if (seen.has(base)) continue;
      seen.add(base);
      const srcPath = `${siteDir}/${f.name}`;
      const planRel = `${top}/${siteEntry.name}/${f.name}`;
      try {
        const plan = f.ext === ".tap.json"
          ? JSON.parse(await Deno.readTextFile(srcPath)) as TapPlan
          : await loadFromTapJs(srcPath);
        if (!plan.body || !plan.body.site || !plan.body.name) {
          outcomes.push({ path: srcPath, rel: planRel, status: "skipped-invalid", reason: "missing body.site/name" });
          continue;
        }
        const outPath = `${args.out}/${plan.body.site}/${plan.body.name}.html`;
        let exists = false;
        try { await Deno.stat(outPath); exists = true; } catch { /* not found */ }
        if (exists && !args.force) {
          outcomes.push({ path: outPath, rel: planRel, status: "skipped-exists" });
          continue;
        }
        const html = renderPage(plan, planRel);
        if (!args.dryRun) {
          await Deno.mkdir(`${args.out}/${plan.body.site}`, { recursive: true });
          await Deno.writeTextFile(outPath, html);
        }
        outcomes.push({ path: outPath, rel: planRel, status: exists ? "written-forced" : "written" });
      } catch (e) {
        outcomes.push({ path: srcPath, rel: planRel, status: "skipped-invalid", reason: e instanceof Error ? e.message : String(e) });
      }
    }
  }
}

// ─── Load a legacy .tap.js and coerce into TapPlan-shaped object ────────────
async function loadFromTapJs(path: string): Promise<TapPlan> {
  // Dynamic import: file only declares an object + async fn body; body is
  // never executed here so browser globals inside it are safe.
  const absPath = path.startsWith("/") ? path : `${Deno.cwd()}/${path}`;
  const mod = await import(`file://${absPath}?t=${Date.now()}`);
  const t = mod.default ?? {};
  return {
    body: {
      site: t.site,
      name: t.name,
      description: t.description,
      intent: t.intent,
      columns: t.columns,
      args: t.args,
      examples: t.examples,
      health: t.health,
    },
  };
}

// ─── Report ──────────────────────────────────────────────────────
const counts = outcomes.reduce<Record<string, number>>((a, o) => { a[o.status] = (a[o.status] ?? 0) + 1; return a; }, {});
console.error(`tap-skills → docs/taps sync — ${args.dryRun ? "DRY RUN" : "wrote"}`);
for (const [k, v] of Object.entries(counts).sort()) console.error(`  ${k}: ${v}`);
const invalid = outcomes.filter(o => o.status === "skipped-invalid");
if (invalid.length > 0) {
  console.error(`\nInvalid (skipped):`);
  for (const o of invalid) console.error(`  ${o.rel}: ${o.reason}`);
}

// ─── Page renderer ───────────────────────────────────────────────
function renderPage(plan: TapPlan, planRel: string): string {
  const b = plan.body;
  const desc = b.description ?? `${b.site}/${b.name} — a Taprun tap.`;
  const intent = b.intent ?? "read";
  const columns = b.columns ?? [];
  const args = b.args ?? {};
  const examples = b.examples ?? [];
  const health = b.health ?? { min_rows: 1, non_empty: [] };

  // Transform args object → YAML-friendly list
  const argList = Object.entries(args).map(([name, spec]) => ({
    name,
    type: spec.type ?? "string",
    default: spec.default ?? "",
    description: spec.description ?? "",
  }));

  // Build CLI example invocation from examples[0]
  const ex = examples[0] ?? {};
  const exampleArgs = Object.entries(ex)
    .map(([k, v]) => `--${k} ${shellQuote(String(v))}`)
    .join(" ");

  const sourceUrl = `https://github.com/${REPO}/blob/main/${planRel}`;

  const frontmatter = [
    "---",
    `layout: tap`,
    `site_name: ${yamlScalar(b.site)}`,
    `tap_name: ${yamlScalar(b.name)}`,
    `description: ${yamlString(desc)}`,
    `intent: ${yamlScalar(intent)}`,
    columns.length ? `columns:\n${columns.map(c => `  - ${yamlScalar(c)}`).join("\n")}` : `columns: []`,
    argList.length ? `args:\n${argList.map(renderArgYaml).join("\n")}` : `args: []`,
    `args_json: |\n  ${JSON.stringify(args)}`,
    `health_json: |\n  ${JSON.stringify(health)}`,
    `example_args: ${yamlString(exampleArgs)}`,
    `source_url: ${sourceUrl}`,
    `license: MIT`,
    "---",
  ].join("\n");

  const mcpInvoke = `tap.run({ site: ${JSON.stringify(b.site)}, name: ${JSON.stringify(b.name)}${exampleArgs ? `, args: ${JSON.stringify(ex)}` : ""} })`;

  const body = `
<section>
  <h2>What it does</h2>
  <p>${escapeHtml(desc)}</p>
</section>

<section>
  <h2>How to call it</h2>
  <p>From your terminal once Tap is installed:</p>
  <pre><code>tap run ${b.site}/${b.name}${exampleArgs ? " " + exampleArgs : ""}</code></pre>
  <p>Or from an MCP-aware client (Claude Code, Cursor, Cline) — the exact same plan runs deterministically without re-inferring the site structure:</p>
  <pre><code>${escapeHtml(mcpInvoke)}</code></pre>
</section>

<section>
  <h2>Why compile it once</h2>
  <p>This plan was forged once — the AI read <code>${b.site}</code>, picked stable structural addresses, and saved them to a <code>.tap.json</code>. Every replay since then has used zero LLM tokens. When <code>${b.site}</code> ships a site change that breaks the extraction, <code>tap doctor</code> surfaces it before your data goes stale.</p>
</section>
`;

  return frontmatter + "\n" + body + "\n";
}

function renderArgYaml(a: { name: string; type: string; default: unknown; description: string }): string {
  const lines: string[] = [`  - name: ${yamlScalar(a.name)}`, `    type: ${yamlScalar(a.type)}`];
  if (a.default !== "" && a.default !== undefined) lines.push(`    default: ${yamlScalar(String(a.default))}`);
  if (a.description) lines.push(`    description: ${yamlString(a.description)}`);
  return lines.join("\n");
}

// ─── YAML / shell / HTML escaping ────────────────────────────────
function yamlScalar(s: string): string {
  // Simple bare scalar safe for Jekyll YAML if no special chars; otherwise quote.
  if (/^[\w./-]+$/.test(s)) return s;
  return yamlString(s);
}
function yamlString(s: string): string {
  // JSON-encoded double-quoted string is a valid YAML flow scalar.
  return JSON.stringify(s);
}
function shellQuote(s: string): string {
  if (/^[\w./-]+$/.test(s)) return s;
  return `'${s.replace(/'/g, "'\\''")}'`;
}
function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

function parseArgs(argv: string[]): { source?: string; out?: string; force?: boolean; dryRun?: boolean } {
  const o: Record<string, unknown> = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--source") o.source = argv[++i];
    else if (a === "--out") o.out = argv[++i];
    else if (a === "--force") o.force = true;
    else if (a === "--dry-run") o.dryRun = true;
  }
  return o as ReturnType<typeof parseArgs>;
}
