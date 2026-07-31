<!--
DRAFT for dev.to cross-post. Jekyll skips _drafts/ by default — won't deploy.

PUBLISH STEPS:
  1. Copy body (everything below the dev.to frontmatter fence) into dev.to editor.
  2. dev.to canonical_url MUST point back to https://taprun.dev/blog/authenticated-browser-mcp.html
     so Google attributes ranking to taprun.dev, not dev.to.
  3. Tags: pick 4 max — recommended: mcp, ai, webdev, automation
  4. Publish: leave `published: false` initially, preview, then flip to `true` in dev.to UI.
  5. After publish, watch the canonical-tag behavior: dev.to honors `canonical_url` and adds
     a "Originally published at taprun.dev" credit link — this is the SEO benefit.

WHY DEV.TO (per 2026-05-18 verification):
  - Perplexity cited "dev" as a source domain when answering "what is taprun"
  - Google AI Overview cited Cursor Directory + GitHub + PulseMCP but NOT taprun.dev directly
  - The aggregator/community-site layer is doing the discovery work; dev.to fills the gap
  - dev.to articles get indexed in Google AI Overview within ~48h based on prior precedent
-->

---
title: "The authenticated browser MCP: why cloud tools can't see your logged-in state"
published: false
description: "Playwright MCP, BrowserBase, Firecrawl all run fresh or anonymous browsers. Real AI agent work lives behind auth. Here's the architectural gap — and the fix."
tags: mcp, ai, webdev, automation
canonical_url: https://taprun.dev/blog/authenticated-browser-mcp.html
cover_image: https://taprun.dev/social-preview.png
---

> Your browser is logged in. Claude's browser isn't.

There are 4 popular MCP browser tools right now. None of them can see your logged-in Shopify, HubSpot, or Gmail. **That's not a bug — that's the architecture.** Once you see why, "use your real Chrome via extension" is the only fix that doesn't compromise.

## What you actually want to automate

Open the prompt log of any team using Claude Code / Cursor / Cline for browser tasks. The asks cluster:

- "Summarize this week's HubSpot deals into Notion"
- "Check Wise / 招行 balance, alert if below $X"
- "Pull three vendor invoices from their portals to a folder"
- "Read my Gmail contracts, extract obligations"
- "Verify staging is on the latest commit (internal dashboard)"
- "Route Intercom escalations into Linear"

Notice: **every single one is behind a login.** Public-web scraping is the rounding error, not the workload.

## What today's MCP browser tools actually do

Read each project's source for `browser_navigate` / `browser_extract`. Here's the truth table:

| Tool | Browser runs on | Session state | Can read your logged-in Shopify? |
|---|---|---|---|
| **Playwright MCP** | New Chromium per session | Empty — no cookies, localStorage, IndexedDB | ❌ |
| **BrowserBase MCP** | Their cloud Chromium | Empty — anonymous on their infra | ❌ |
| **Firecrawl MCP** | Their server-side crawler | Public web only | ❌ |
| **Stagehand (MCP)** | New Playwright instance | Empty unless you ship cookies | ❌ |
| **Bardeen-class extensions** | ✅ Your Chrome | ✅ Real session | ✅ but no MCP — visual only |

Four mature tools, structurally blind to 90% of the workload you actually want.

## Why "just add login" never ships

Cloud browser vendors keep promising "session support coming soon" without delivering. The reasons compound:

### 1. You can't legally / safely ship cookies to a cloud browser
Your `shopify.com` session cookie is a device-bound auth credential. Even if a vendor asks you to upload it, you've now handed a third party your store's auth token. They become the next target for credential theft, and they'd need SOC 2-level compliance to handle that liability across millions of users. Both sides hate it.

### 2. Browser fingerprints betray cloud origin
Google, LinkedIn, every bank, most SaaS SSO providers flag logins from unfamiliar IPs / device fingerprints. A browser running on AWS triggers 2FA, device verification, or outright block — even if you somehow shared the right cookie. **The only fingerprint that doesn't trigger these defenses is the one on your own machine.**

### 3. 2FA needs the human to be physically present
If sessions expire mid-task, re-auth asks for TOTP or device push approval. The cloud browser can't answer; the human at their desk can't answer either, because they're not in front of *that* browser.

These three stack into a wall. **No amount of engineering on the cloud browser side can climb it.**

## The category nobody named: authenticated browser MCP

This is a category with clear constraints:

- Runs in the user's own Chrome (extension) or local Chromium with the user's profile
- Operates the user's *existing* session — cookies / localStorage / IndexedDB that's already there
- Exposes the substrate via **MCP**, not a visual GUI like Bardeen
- **No user data leaves the machine** — blast radius is capped at the local device
- Outputs **reusable, auditable, version-controllable** programs, not one-off actions

Today there's exactly one MCP server that hits all five: **[Tap](https://taprun.dev)**. Not because Tap is cleverer than the others — because those constraints force this shape, and nobody else started from those constraints.

## How Tap does it (briefly)

```
npx -y @taprun/cli                            # zero-install
curl -fsSL https://taprun.dev/install.sh | sh # permanent binary
brew install LeonTing1010/tap/taprun          # macOS/Linux via brew
```

Connect to any MCP host:

```json
{ "mcpServers": { "tap": { "command": "tap" } } }
```

Tap exposes **four meta verbs** that any AI host gets:

- `capture { url, intent, site, name }` — AI inspects the page once, emits a deterministic `.flow.json` program
- `verify { site, name }` — read-only substrate equivalence check (catches drift before prod breaks)
- `mark { site, name, key, as }` — resolves uncertain side-effects (the "did the post actually send?" problem)
- `run { ref, args }` — replays a saved tap at **zero LLM tokens** — pure data + dispatch

Saved taps appear as MCP Resources at `tap://{site}/{name}` so any IDE can discover them. The browser is *your* Chrome (via extension peer); the session is whatever you're already logged into. The credentials never cross a network boundary, by construction.

## When NOT to use Tap

Tap is wrong for **public-web high-parallelism scraping** — 10K product pages, no login, hammering one site. That's BrowserBase / Firecrawl / Playwright territory. Different problem, different right answer.

The categorization, finally:

| Workload | Right tool |
|---|---|
| Public web at scale, no auth | BrowserBase / Firecrawl / Playwright MCP |
| Authenticated SaaS / internal dashboards / banking | **Tap** |
| Visual demos / one-off recordings | Bardeen / Magical |

## Closing

The MCP ecosystem grew up assuming "browser = headless Chrome we spin up". That worked for the demo-driven first wave. For the actual workflows people want AI agents to handle in production, **the session is the product** — not a parameter you can pass to a cloud sandbox.

Pick the tool that matches your trust boundary. If the task needs login, the trust boundary is your laptop. Run the substrate there.

---

*Originally published at [taprun.dev](https://taprun.dev/blog/authenticated-browser-mcp.html). Tap is local-first, MIT-licensed extension + closed-core CLI; the [community tap registry](https://github.com/LeonTing1010/tap-skills) is open.*
