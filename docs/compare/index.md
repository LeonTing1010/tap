---
title: "Tap vs cloud MCP servers — pick by trust boundary"
description: "Tap is the MCP for browser tasks that need login. Cloud MCP servers (Stagehand, Browserbase, Playwright-MCP-hosted, browser-use) need the session in their database to function — Tap runs in the user's real Chrome. Side-by-side comparison."
permalink: /compare/
layout: default
---

# Tap vs cloud MCP servers — pick by trust boundary

> **The MCP server for browser tasks that need login.** Cloud-hosted MCP servers need your session in *their* database to function. Tap runs in your real Chrome via extension — credentials never leave your machine.

The browser-automation MCP landscape splits along a single architectural seam: **where the live browser runs**. Once that's decided, everything else follows.

- **Cloud-hosted MCPs** (Stagehand, Browserbase, Playwright-MCP-as-a-service, browser-use) run the browser in their pool. To do anything authenticated, they need your cookies in their database.
- **Tap** runs the browser on your laptop via a Chrome extension. The MCP server bridges to a process the user owns; the substrate is the user's own logged-in profile.

For public-page scraping at high parallelism, cloud is the right answer. For tasks that touch your WeChat draft / Linear / Notion / internal SaaS / banking / SSO-gated admin consoles, only Tap is even architecturally eligible.

<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "Article",
  "headline": "Tap vs cloud MCP servers — pick by trust boundary",
  "about": [
    { "@type": "SoftwareApplication", "name": "Taprun", "url": "https://taprun.dev" },
    { "@type": "SoftwareApplication", "name": "Stagehand", "url": "https://github.com/browserbase/stagehand" },
    { "@type": "SoftwareApplication", "name": "Browserbase", "url": "https://www.browserbase.com" },
    { "@type": "SoftwareApplication", "name": "Playwright MCP", "url": "https://github.com/microsoft/playwright-mcp" },
    { "@type": "SoftwareApplication", "name": "browser-use", "url": "https://github.com/browser-use/browser-use" }
  ],
  "isPartOf": { "@type": "WebSite", "url": "https://taprun.dev", "name": "Taprun" }
}
</script>

## Pick by use case

| Your task | Pick |
|---|---|
| Logged-in account (WeChat / Linear / Notion / Twitter / LinkedIn) | **Tap** — session stays in your Chrome |
| Internal / VPN-restricted / SSO-gated tools | **Tap** — your laptop is on the VPN, the cloud isn't |
| HIPAA / SOC2 / regulated cohort, data can't cross vendor boundary | **Tap** — no vendor-side log to subpoena |
| 10K parallel scrape jobs against public pages | **Stagehand + Browserbase** — built for this |
| AI agent that browses public web for end users | **browser-use** or **Stagehand** — cloud-first scales out |
| Quick prototype, want LLM to figure it out at runtime | **Stagehand** — `act("click the price")` is faster than compiling a plan |
| Cron job that runs the same flow forever, can't pay tokens per run | **Tap** — plans compile once, replay at zero tokens |
| Existing Playwright/Puppeteer scripts that keep breaking | **Tap** — [adapters](/spec/plan-v1/) convert source 1:1, plus drift verify |

Both lists are real. Pick the architecture that matches what you're actually trying to do.

## Architecture, in one diagram

```
                  AGENT  (Claude Code · Cursor · Cline · Continue · Zed)
                                       │
                                       ▼
                ┌──────────────────────────────────────────┐
                │              MCP server                   │
                └──────────────────────────────────────────┘
                          │                          │
              ── runs IN your Chrome ──    ── runs IN vendor cloud ──
                          ▼                          ▼
                  ┌──────────────┐          ┌──────────────────┐
                  │ Tap          │          │ Stagehand        │
                  │  ext + plan  │          │ Browserbase      │
                  │  (this site) │          │ Playwright-MCP*  │
                  └──────┬───────┘          │ browser-use      │
                         │                  └────────┬─────────┘
                         ▼                           ▼
                  ╔═════════════╗             ╔════════════════╗
                  ║ Your Chrome ║             ║ Vendor browser ║
                  ║ Your cookies║             ║ Your cookies   ║
                  ╚═════════════╝             ║ (in their DB)  ║
                                              ╚════════════════╝

* Playwright-MCP itself can run locally; the comparison here is to the
  hosted-service flavor most agents reach via remote MCP endpoints.
```

The trust boundary is the load-bearing distinction. Everything else (cost model, parallelism profile, headless support, anti-bot infra) is downstream of where the browser runs.

## Per-project deep-dives

### vs Stagehand

Stagehand (Browserbase, 22K★, 745K weekly npm downloads) and Tap target the same broken-scraper pain from opposite architectural ends. Stagehand: cloud SDK, plan-as-code, LLM-at-runtime. Tap: local-first, plan-as-data, AI-only-at-compile.

[Full breakdown → `/compare/stagehand/`](/compare/stagehand/) — TL;DR-by-use-case table, the single trust-boundary decision, and honest weakness for both sides.

### vs Browserbase

Browserbase hosts the browser; Tap defines the program. They're not the same product even though both touch "reliable browser automation." Browserbase's value is hosted infra (anti-bot, replay, hosted sessions for orgs without infra). Tap's value is the program format (`.plan.json`, compile-once, deterministic replay, drift verify).

A `.plan.json` plan with `runtime: "playwright"` can target any Playwright endpoint, including a Browserbase-hosted browser — Browserbase as a deployment target, not a competitor.

*Honest weakness*: Browserbase has $20M+ funding, hosted control plane, replay tooling Tap doesn't ship. Tap doesn't compete on infrastructure. Pick Browserbase when you need a hosted browser pool; pick Tap when the session has to stay on the user's machine.

### vs Playwright MCP

Playwright-MCP (the Microsoft project) and Tap overlap in one specific mode: Playwright-MCP run **with `--extension`** also uses the user's Chrome via extension. In that mode the credential-safety properties match Tap's. The difference is then about the program format:

- Playwright-MCP: LLM operates on a live Playwright session every call. Each agent turn costs tokens.
- Tap: AI compiles once into an 11-op closed-union plan; every subsequent run is pure data + dispatch, zero tokens.

[Full breakdown → `/blog/playwright-mcp-vs-tap.html`](/blog/playwright-mcp-vs-tap.html) — when each wins, when they compose.

### vs browser-use

browser-use runs an LLM at every step; Tap runs an LLM once at compile time and never again. Inside a browser-use agent, a saved Tap is the no-think sub-routine layer.

*Where they compose*: a browser-use agent that needs deterministic sub-tasks (paginated extraction, periodic scrape, repeatable login flow) calls `mcp__tap__run` instead of re-deciding at every step.

*Honest weakness*: browser-use handles novel pages with no prior compile step. For one-shot exploration, browser-use is faster to first execution. Tap is the answer when the same task will run more than twice.

## When Tap is the wrong answer

- You need 10K parallel sessions against public pages. Tap runs in *one* Chrome (yours). Use Browserbase.
- You're building a consumer agent that browses arbitrary user-supplied URLs. The cloud pool model fits; Tap doesn't.
- You want hosted replay, session recordings, an admin UI. Tap ships none of that — its scope is the program format + the local runtime.

If your task description starts with "for each customer's account" — Tap is the right answer. If it starts with "for each search result" — probably not.

## Further reading

- [Authenticated browser MCP — what the trust boundary actually means](/blog/authenticated-browser-mcp.html)
- [Why local-first browser automation outlasts cloud SDKs](/local-first/)
- [Plan-v1 spec (11-op closed union)](/spec/plan-v1/)
- [Compile once, run forever — the four meta verbs](/blog/compile-once-diff-the-drift.html)

---

<small>Found an error or out-of-date claim? <a href="https://github.com/LeonTing1010/tap/issues/new">Open an issue</a>. Last reviewed 2026-05-14.</small>
