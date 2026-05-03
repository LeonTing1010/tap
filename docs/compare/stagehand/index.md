---
title: "Tap vs Stagehand — local-first plans vs cloud-first SDK"
description: "Stagehand and Tap target the same broken-scraper pain from opposite ends of the architectural axis. Stagehand: cloud SDK, plan-as-code, LLM-at-runtime. Tap: local-first, plan-as-data, AI-only-at-compile. Honest comparison of where each wins."
permalink: /compare/stagehand/
layout: default
---

# Tap vs Stagehand

> Same pain. Opposite architectures. Different right answers.

[Stagehand](https://github.com/browserbase/stagehand) (Browserbase, 22K★, 745K weekly npm downloads) and [Tap](https://taprun.dev) both promise: AI helps you build a browser automation that doesn't break next week. The pitches even sound similar — Stagehand says "Write once, run forever" and Tap says "Compile once. Run forever. Diff the drift."

Same target. Opposite engineering choices. The split happens at one design decision — where the trust boundary lives — and once that's made, the rest of the stack falls into place automatically. This page lays out both choices honestly so you can pick the right one for your task.

---

## TL;DR by use case

| Your task | Pick |
|---|---|
| Building an AI agent that browses the web for end users (no logged-in state) | **Stagehand** — cloud-first scales out, no local browser needed |
| Need 10K parallel scraping jobs against public pages | **Stagehand + Browserbase** — built for this pattern |
| Quick prototype where the LLM should figure things out at runtime | **Stagehand** — `act("click on the price")` is genuinely faster than compiling a plan |
| Scraping your own logged-in account (LinkedIn, Twitter, internal SaaS) | **Tap** — your cookies stay on your machine; cloud-vendor TOS doesn't apply |
| HIPAA / SOC2 / regulated cohort where data can't leave the boundary | **Tap** — runs entirely local, no vendor-side log to subpoena |
| Need an audit trail of every action your scraper takes | **Tap** — `.tap.json` is data; every op is grep-able |
| Internal / intranet sites, VPN-restricted | **Tap** — your laptop is on the VPN; the cloud isn't |
| Want to monitor drift on existing Playwright/Puppeteer scripts without rewriting | **Tap** — [adapters](https://taprun.dev/spec/plan-v1/) convert your source 1:1 |
| Worried about vendor lock-in / want a portable plan format | **Tap** — `.tap.json` is open spec, MIT |

Both lists are real. Pick the architecture that matches what you're actually trying to do.

---

## The single decision that shapes everything

```
                  Stagehand                                    Tap
                  ─────────                                    ───
              ┌─ trust boundary ─┐                  ┌─ no external boundary ─┐
              │                  │                  │                         │
   You ──►  Cloud  ──►  Site            You ◄──── Your CLI ────► Site
   (cookies)         (browser)          (cookies)  (your browser)
   crossed                                no boundary crossed
   to vendor                              no vendor logs to subpoena
```

That single architectural axis — *where do logged-in cookies live during automation?* — explains every other difference between the two products. Cloud-first SDKs answer "the vendor's servers." Local-first answers "only your machine." Once you make that call, the rest follows: how AI participates, where the plan lives, what the failure modes look like.

---

## Side-by-side architecture

| Dimension | Stagehand | Tap |
|---|---|---|
| **Where it runs** | Browserbase cloud (or your machine if self-hosted) | Your local Chrome (extension) or your local CLI |
| **Plan representation** | TypeScript code: `act()`, `extract()`, `observe()` calls embedded in your `.ts` | Bare v2 Plan — 11-op closed union, pure data, no JS in the runtime path |
| **AI in runtime?** | Yes — every `act()` calls an LLM to choose the next action (with caching) | No — LLM only at compile/`forge` time. Runtime is pure code. |
| **Cookie / session storage** | Browserbase stores them (encrypted at rest, but they cross a boundary) | Local browser only — never serialized, never transmitted |
| **What "self-repair" means** | LLM re-decides on retry when an `act()` fails | Per-tap CEL `snapshot_equivalent` catches drift; re-running `capture` against the same site/name re-compiles the broken op |
| **Plan portability** | Locked to Stagehand SDK + Browserbase runtime | `.tap.json` runs on any Tap-compatible runtime (CLI, Chrome ext, future Playwright runtime) |
| **Audit trail** | Read TypeScript source + LLM black box | `grep` `.tap.json` — every op is a row |
| **License of the plan format** | Stagehand SDK is MIT but the format is whatever your TS code does | `tap-v1` namespace ([taprun.dev/ns/tap-v1](https://taprun.dev/ns/tap-v1/)), JSON Schema 2020-12, [@taprun/spec](https://www.npmjs.com/package/@taprun/spec) MIT |
| **Pricing model** | Stagehand SDK free; Browserbase paid by browser-hour + actions | $0 spec & runtime free forever; AI compile $19/mo, AI heal $49/mo, team $199/mo |
| **Backed by** | Browserbase (funded company, $20M+ raised) | Bootstrapped, solo |
| **GitHub stars** | 22K | 3 |
| **npm weekly downloads** | 745K (`@browserbasehq/stagehand`) | small (`@taprun/spec` published 2026-04-26) |

---

## Where Stagehand wins, honestly

1. **Distribution.** 22K stars and 745K weekly npm downloads is real network effect. Tap is at the start of its ecosystem; Stagehand has been growing for two years. If you need a battle-tested community and immediate Stack Overflow answers, Stagehand is the safer bet.

2. **Scale-out.** Cloud-first means you can run thousands of headless browsers in parallel without buying machines. Tap's local-first model puts the scaling burden on you.

3. **Anonymous public scraping.** If your task has no login state — say, scraping all GitHub trending repos — there's nothing to protect locally. Stagehand+Browserbase is engineered for this; Tap's privacy moat is irrelevant.

4. **Stagehand's `act()` ergonomics.** Natural language directly to action is genuinely good UX for prototyping. Tap requires you to compile a plan first (via `forge`) — slightly more friction up front, more determinism after.

5. **Vision-based reasoning.** Stagehand can chain LLM-at-runtime with screenshots; Tap's compile-time model is text/DOM only. If your task needs the model to look at the rendered page, Stagehand wins.

6. **Polished docs + example gallery.** docs.stagehand.dev is a serious investment. Tap's documentation is improving but not on Stagehand's level yet.

---

## Where Tap wins, honestly

1. **Local-first by architecture.** Six independent engineering-philosophy facts (A2/A3/D2/R1/T1/R3) all align with local-first execution — see [the local-first argument](/local-first/) for the full derivation. Cloud-first SDKs cannot match this without a fundamental rewrite.

2. **Plan-as-data.** A `.tap.json` file is a data blob you can `grep`, version, audit, sign with [APS receipts](https://github.com/aeoess), or feed to a static analyzer. A Stagehand `.ts` file with embedded `act()` calls is opaque — you have to read it (or run it) to understand what it does.

3. **Zero LLM tokens at runtime.** A compiled `.tap.json` replays at $0 LLM cost, deterministically, every time. Stagehand's caching reduces but doesn't eliminate runtime LLM calls — every uncached path is a fresh inference.

4. **Drift-aware verify.** Tap's `verify` independently fetches an authoritative source (JSON-LD / OpenAPI / sitemap / RSS) and cross-validates the scraped output against it. Stagehand's "self-healing" re-runs the LLM; Tap's `verify` notices that a `name` extraction now matches schema.org's `Product` type 0% of the time.

5. **Bring-your-own-script via adapters.** Tap's [from-playwright](https://www.npmjs.com/package/@taprun/from-playwright), [from-puppeteer](https://www.npmjs.com/package/@taprun/from-puppeteer), and [from-stagehand](https://www.npmjs.com/package/@taprun/from-stagehand) packages convert existing source into `.tap.json`. You don't have to rewrite to start using Tap; Stagehand requires migration to its SDK.

6. **Vendor exit.** If Browserbase shuts down or pivots, your Stagehand-based scrapers stop. If Tap-the-company shuts down, your `.tap.json` plans keep running on local CLI forever.

7. **Compliance-friendly cohort.** HIPAA/SOC2/legal-finance teams can use Tap because data and plans never leave the local boundary. Cloud-first SDKs are usually a non-starter for these cohorts.

---

## When the two compose, instead of compete

Tap's `from-stagehand` adapter is a deliberate choice: **we'd rather you keep your Stagehand code and add Tap on top than ask you to rewrite.**

If you have a Stagehand `.ts` script and want to add drift detection / audit trail / local fallback:

```bash
npm install @taprun/from-stagehand @taprun/spec
```

```ts
import { stagehandToTap } from "@taprun/from-stagehand";
import { runConformance } from "@taprun/spec";

const source = await readFile("scripts/my-stagehand-script.ts", "utf8");
const plan = stagehandToTap(source, {
  site: "github",
  name: "browserbase-search",
  intent: "read",
});

// runs validation
const v = runConformance(plan);
if (!v.pass) throw new Error(JSON.stringify(v.failures));

// you now have a .tap.json that can run via Tap CLI alongside your Stagehand script
await writeFile("github/browserbase-search.tap.json", JSON.stringify(plan, null, 2));
```

> **Note:** `from-stagehand` is **deprecated as of v2.** Stagehand requires Browserbase (cloud-coupled), which contradicts the local-first stance. The recommended path is `@taprun/from-playwright` against the deterministic page-level calls in your Stagehand script (Stagehand wraps Playwright anyway), then re-capture the natural-language portions via `tap capture <url> <site>/<name> --intent "..."`. See the [Migration guide](/migration-guide/).

The result is a *partially* deterministic plan. Tap's `verify` can check the deterministic portions; the NL portions remain Stagehand's job. Most production Stagehand scripts have a deterministic backbone with NL embellishments — Tap converts the backbone, and you keep using Stagehand for the NL parts.

---

## How to switch (if you want to)

**You're using Stagehand and want to try Tap on a single script:**

```bash
# 1. Convert (one-shot)
npx -p @taprun/from-stagehand -e "
const fs = require('fs');
const { stagehandToTap } = require('@taprun/from-stagehand');
const src = fs.readFileSync(process.argv[1], 'utf8');
const plan = stagehandToTap(src, { site: 'mysite', name: 'flow', intent: 'read' });
fs.writeFileSync('flow.tap.json', JSON.stringify(plan, null, 2));
" scripts/your-stagehand-script.ts

# 2. Run via Tap CLI
brew install LeonTing1010/tap/tap
tap run mysite/flow

# 3. Optional — install Chrome extension for logged-in sites
# Chrome Web Store: https://chromewebstore.google.com/detail/tap/llcidejeoobdegbkolbjhfoeckphldce
```

**You're starting fresh and unsure which to pick:**

- Public, anonymous, scale-out → **Stagehand**
- Logged-in, audit-able, single-machine or small team → **Tap**
- Hybrid → start with Tap's adapter on top of a Stagehand script, see which side carries more weight

---

## Related

- [Local-first by architecture](/local-first/) — the full architectural argument behind Tap's design
- [Plan-v1 format reference](/spec/plan-v1/) — what `.tap.json` actually looks like
- [Compare with all adjacent tools](/compare/) — overview including browser-use, Libretto, Replay MCP

---

*Last updated 2026-04-27. Stagehand stats from [@browserbasehq/stagehand](https://www.npmjs.com/package/@browserbasehq/stagehand) on 2026-04-26.*
