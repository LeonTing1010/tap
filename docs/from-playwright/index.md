---
title: "@taprun/from-playwright — Playwright → v2 Plan adapter"
description: "Stable IRI for the @taprun/from-playwright adapter. Convert Playwright tests into local-first bare v2 Plans, no rewrite."
permalink: /from-playwright/
layout: default
---

# @taprun/from-playwright

> Stable identifier for the [`@taprun/from-playwright`](https://www.npmjs.com/package/@taprun/from-playwright) adapter. Every plan compiled from a Playwright source carries `compiled_by` metadata so consumers can dereference the producer.

Part of the **Capture** plane — one of Tap's three primitive planes (Capture / Replay / Verify). Bumped to **v1.0** for the v2 schema break (see [Migration guide](/migration-guide/)).

## What this adapter does

Convert Playwright tests into local-first bare v2 `Plan`s, no rewrite. Maps the deterministic page-level APIs (`page.goto`, `.click`, `.fill`, `.type`, `.press`, `.waitForSelector`, `.waitForTimeout`) to the 13-op v2 closure. Lifecycle calls (`browser.launch` / `close`) silently dropped. Anything outside the deterministic surface either throws under `strict: true` or becomes a typed `op:eval` with the original line preserved as a comment for human follow-up — never free-form JS.

## Install

- npm: <https://www.npmjs.com/package/@taprun/from-playwright>
- Format types: <https://www.npmjs.com/package/@taprun/spec>

```bash
npm install @taprun/from-playwright@^1 @taprun/spec@^1
```

## Sample plan produced

A read tap:

```json
{
  "id": { "site": "github", "name": "trending" },
  "observe": [
    { "op": "nav",  "url": "https://github.com/trending" },
    { "op": "wait", "selector": "article.Box-row" }
  ],
  "return": "$.observe[1]"
}
```

A write tap (login flow):

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
    { "op": "input", "kind": "click", "target": "button[type='submit']" }
  ],
  "confirm": [
    { "op": "wait", "selector": ".dashboard", "timeout_ms": 5000 }
  ],
  "return": "$.confirm[0]"
}
```

The output is a **bare Plan** — no `@context`, no W3C wrapper, no `body`. The discriminated union (read vs write) is encoded at the type level: a write tap that omits `key` fails compilation in `@taprun/spec`.

## Rather buy the outcome than maintain the tool?

If a Playwright scraper you rely on keeps breaking, we'll set up the Tap
automation on your own machine and keep it working when the site changes —
flat monthly, cancel anytime. [See done-for-you →](/done-for-you/)

## Related

- [Plan format](/spec/plan-v1/) — bare `Plan` reference
- [Migration guide](/migration-guide/) — v0.x → v1.0 upgrade path
- Sister adapter: [`@taprun/from-puppeteer`](/from-puppeteer/)
- [`@taprun/from-stagehand`](/from-stagehand/) — deprecated; see migration guide for alternative
