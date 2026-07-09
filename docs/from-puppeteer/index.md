---
title: "@taprun/from-puppeteer — Puppeteer → v2 Plan adapter"
description: "Stable IRI for the @taprun/from-puppeteer adapter. Convert Puppeteer scripts into local-first bare v2 Plans, no rewrite."
permalink: /from-puppeteer/
layout: default
---

# @taprun/from-puppeteer

> Stable identifier for the [`@taprun/from-puppeteer`](https://www.npmjs.com/package/@taprun/from-puppeteer) adapter. Every plan compiled from a Puppeteer source carries `compiled_by` metadata so consumers can dereference the producer.

Part of the **Capture** plane — one of Tap's three primitive planes (Capture / Replay / Verify). Bumped to **v1.0** for the v2 schema break (see [Migration guide](/migration-guide/)).

## What this adapter does

Convert Puppeteer scripts into local-first bare v2 `Plan`s, no rewrite. Maps the most common page-level APIs (`page.goto`, `.click`, `.type`, `.keyboard.press`, `.waitForSelector`, `.waitForTimeout`) to the 13-op v2 closure. Lifecycle calls (`puppeteer.launch` / `browser.close`) silently dropped. `page.type` aligns to `op:input` with `kind:"fill"` (semantic alignment); `keyboard.press` to `op:input` with `kind:"press"` and no `target` (focused element). Anything outside the deterministic surface either throws under `strict: true` or becomes a typed `op:eval` with the original line preserved as a comment.

## Install

- npm: <https://www.npmjs.com/package/@taprun/from-puppeteer>
- Format types: <https://www.npmjs.com/package/@taprun/spec>

```bash
npm install @taprun/from-puppeteer@^1 @taprun/spec@^1
```

## Sample plan produced

```json
{
  "id": { "site": "example", "name": "login" },
  "args": { "password": { "type": "string", "required": true } },
  "key": "$.args.password",
  "observe": [
    { "op": "nav", "url": "https://app.example.com/login" }
  ],
  "act": [
    { "op": "input", "kind": "fill",  "target": "#email",    "value": "alice@example.com" },
    { "op": "input", "kind": "fill",  "target": "#password", "value": "{{$.args.password}}" },
    { "op": "input", "kind": "press", "value": "Enter" }
  ],
  "confirm": [
    { "op": "wait", "selector": ".dashboard", "timeout_ms": 5000 }
  ],
  "return": "$.confirm[0]"
}
```

The output is a **bare Plan** — no `@context`, no W3C wrapper, no `body`. The read/write discriminated union is encoded at the type level.

## Rather buy the outcome than maintain the tool?

If a Puppeteer scraper you rely on keeps breaking, we'll set up the Tap
automation on your own machine and keep it working when the site changes —
flat monthly, cancel anytime. [See done-for-you →](/done-for-you/)

## Related

- [Plan format](/spec/plan-v1/) — bare `Plan` reference
- [Migration guide](/migration-guide/) — v0.x → v1.0 upgrade path
- Sister adapter: [`@taprun/from-playwright`](/from-playwright/)
- [`@taprun/from-stagehand`](/from-stagehand/) — deprecated; see migration guide for alternative
