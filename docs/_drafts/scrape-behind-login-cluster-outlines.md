---
status: outline-only
created: 2026-05-28
purpose: SEO cluster around "scrape behind login" — supports own-the-query goal from GSC 90d audit
parent_finding: project_tap_owns_no_google_query_2026-05-28
---

# Scrape-behind-login cluster — 4 satellite articles

Target: own the Google query "scrape behind login" (and adjacent JTBD queries).
GSC baseline (2026-05-28): 0 impressions for any variant of the target phrase in 90d.

---

## Article 1 — Why no cloud scraper can sit behind your login

**Slug**: `why-cloud-scrapers-cant-see-your-login.html`
**Target query**: "cloud scraper login" / "browserbase login" / "scrape behind login cloud"
**Word target**: 1500
**Subtitle**: The structural reason BrowserBase, Browserless, and Stagehand can't run inside your authenticated session — and what that costs you operationally

**Section structure**:
1. The hidden assumption in every cloud-scraper marketing page: "send us the URL." The unstated requirement: send the credentials too.
2. The three vendor workarounds: pasted cookies, "session import" wizards, BYO browser bridge. All leak credentials across a trust boundary by design.
3. Why each workaround drifts in production: cookie expiry, mid-session OTP, MFA re-prompts, IP reputation flips.
4. The local-first alternative: drive the Chrome the user is already logged in to (Tap, BrowserMCP, chrome-devtools-mcp).
5. When cloud is still the right call: high-throughput anonymous scraping, where there is no "your account" to begin with.

**Why it ranks**: Hits the named-competitor query cluster (Browserbase / Stagehand / Browserless) AND the JTBD phrase ("scrape behind login").

---

## Article 2 — Scrape LinkedIn and X without giving credentials to a vendor

**Slug**: `scrape-linkedin-without-credential-handover.html`
**Target query**: "scrape LinkedIn without account ban" / "linkedin scraping logged in" / "scrape twitter authenticated"
**Word target**: 2000
**Subtitle**: Why the third-party "LinkedIn scraper" market is structurally a credential-laundering operation — and the boring path that isn't

**Section structure**:
1. The third-party LinkedIn scraper market: PhantomBuster, Apollo, Bright Data. The thing they share: your login flowing through their infra.
2. Threat model when a vendor "logs in for you": cookie theft scope, account ban liability, MFA blast radius.
3. What LinkedIn's anti-bot actually scores: TLS fingerprint, IP reputation, behavior cadence — not just "is this Selenium."
4. The local-first path: drive your already-logged-in Chrome from your own machine. What you can do (read your feed, your connections' posts), what you can't (other people's networks).
5. Rate-limit discipline so your account doesn't get flagged for behaving like a bot anyway.
6. Code: a Tap plan that scrapes your LinkedIn search results, runs locally, and never sends cookies anywhere.

**Why it ranks**: Names a high-search-volume platform. "scrape linkedin" gets ~5K queries/mo per Ahrefs. Long-tail "without account ban" / "logged in" variants are uncrowded.

**Risk**: LinkedIn is litigious. Frame as "scrape your own data" not "scrape other users' data." HiQ v. LinkedIn precedent applies — public profiles are fair game per 9th Circuit, but framing matters.

---

## Article 3 — Local-first scraping: 4 approaches, when to pick which

**Slug**: `local-first-scraping-4-approaches.html`
**Target query**: "local first scraping" / "self hosted scraping" / "playwright vs browserless"
**Word target**: 1800
**Subtitle**: The four ways to run a scraper without giving credentials to someone else's cloud, ranked by operational friction

**Section structure**:
1. The four approaches:
   - (a) Playwright in CI with `storageState` reuse — engineering cost: low, credential lifetime: short
   - (b) Browserless self-hosted on your VPS — engineering cost: medium, credential lifetime: indefinite if you maintain it
   - (c) Chrome extension bridge driving your real browser — engineering cost: low, credential lifetime: matches your normal browsing session
   - (d) Hybrid: Playwright with cookies extracted from your live Chrome
2. Decision tree: do you need auth at all? do non-devs need to run it? do you need a CI-replayable artifact?
3. Per-run cost comparison: time-to-first-success, cost-per-1k-runs, debugging surface.
4. Failure modes: how each approach fails in week 2 vs day 1.
5. The "which approach for which job" matrix.

**Why it ranks**: Comparison content gets long-tail traffic. "Playwright alternative" / "Browserless self hosted" all anchor here.

---

## Article 4 — Why your Playwright scraper keeps getting logged out (and what 'logged-in' actually means)

**Slug**: `playwright-keeps-getting-logged-out.html`
**Target query**: "playwright authenticated session" / "playwright cookie reuse" / "playwright storageState" / "scrape after login playwright"
**Word target**: 1500
**Subtitle**: The three things "logged in" depends on, the storageState trap, and why a real Chrome session sidesteps the whole class of bug

**Section structure**:
1. The Reddit/HN/StackOverflow archive: 5+ years of "Playwright loses login between runs" questions, same shape, never quite answered.
2. The three things a "logged-in" web session actually depends on: cookies, localStorage/sessionStorage, service-worker-state. Plus the implicit fourth: a CSRF/token endpoint that re-issues on each fresh navigation.
3. What `storageState` captures (cookies + localStorage) vs what it misses (sessionStorage, IndexedDB, SW state, in-memory CSRF tokens).
4. Anatomy of a re-login bug: a JWT in sessionStorage that storageState drops, debugged step-by-step.
5. Three fixes ranked by leverage: (i) wait for re-auth + capture, (ii) reuse a persistent context dir, (iii) drive your real Chrome and stop simulating sessions.
6. When each fix is right — and the operational scenario where "use a real Chrome" is unambiguously cheapest.

**Why it ranks**: This is the most engineering-flavored query cluster. "playwright storageState" gets ~800 queries/mo per Ahrefs; "playwright login" much higher. HN-shareable.

---

## Priority: which one to draft first

**Article 4** wins on three axes:
- Engineering-flavored → HN-shareable → backlink potential beyond Google
- Lowest political risk (no platform names, no legal grey area)
- Direct keyword bridge: "Playwright" queries are high-volume and the post bridges them to the "scrape behind login" cluster
- Style matches existing `capture-trace-spa-shells` (engineering-driven, code-walked, ADR-referenced)

Article 1 second priority — names competitors (BrowserBase/Stagehand), positions Tap.
Article 2 (LinkedIn) is the highest SEO ceiling but carries platform-naming risk; ship after the cluster is established and the brand has more trust signal.
Article 3 is generic comparison content — useful but adds the least new query coverage.

---

## Distribution loop (per article)

For each article shipped:
1. Push to taprun.dev (Jekyll auto-builds in 1-2 min via GH Pages).
2. Cross-post to Hashnode with `<link rel="canonical">` set to taprun.dev URL — DO NOT rely on Hashnode's Attribution tab silently (per `feedback_hashnode_editor_substrate_2026-05-19`, that step has a known UI bug; verify the canonical actually serialized).
3. After 7d, check GSC for new query coverage via `gsc/taprun_search_performance`. Variants of "scrape behind login" / "playwright logged out" / "scrape linkedin local" appearing = funnel opening.
4. After 28d, decide whether to ship the next article in the cluster or pivot keyword.

**Don't ship all 4 at once.** Stagger 7-14 days apart so each gets its own indexing window and you can observe which query variants Google actually surfaces.
