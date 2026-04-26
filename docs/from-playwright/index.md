---
title: "@taprun/from-playwright — SoftwareAgent identifier"
description: "Stable IRI for the @taprun/from-playwright adapter. Embedded as generator.id in every .tap.json plan compiled from a Playwright test. Convert Playwright scripts to local-first plan-v1 envelopes, no rewrite."
permalink: /from-playwright/
layout: default
---

# @taprun/from-playwright

> Stable identifier (`SoftwareAgent.id`) for the [`@taprun/from-playwright`](https://jsr.io/@taprun/from-playwright) adapter. Every `.tap.json` plan compiled from a Playwright source carries `"generator": { "id": "https://taprun.dev/from-playwright", "type": "SoftwareAgent" }` so any W3C Web Annotation consumer can dereference the producer.

Part of the [**Capture**](/capture/) plane — one of Tap's three primitive planes (Capture / Replay / Verify).

## What this adapter does

Convert Playwright tests into local-first `.tap.json` plans, no rewrite. Maps the deterministic page-level APIs (`page.goto`, `.click`, `.fill`, `.type`, `.press`, `.waitForSelector`, `.waitForTimeout`, `.screenshot`) to the plan-v1 op union. Anything outside that surface becomes `{ op: "exec", allowUnverifiable: true }` preserving the original line, or throws under `strict: true`.

## Install

- JSR: <https://jsr.io/@taprun/from-playwright>
- npm: <https://www.npmjs.com/package/@taprun/from-playwright>
- Source: <https://github.com/LeonTing1010/tap>

## Sample envelope produced

```json
{
  "@context": [
    "http://www.w3.org/ns/anno.jsonld",
    "https://taprun.dev/ns/tap-v1"
  ],
  "type": "Annotation",
  "motivation": "tap:executing",
  "target": "https://github.com/trending",
  "body": {
    "type": "tap:ExecutionPlan",
    "site": "github",
    "name": "trending",
    "intent": "read",
    "ops": [
      { "op": "nav", "url": "https://github.com/trending" },
      { "op": "wait", "selector": "article.Box-row" }
    ]
  },
  "generator": {
    "id": "https://taprun.dev/from-playwright",
    "type": "SoftwareAgent",
    "name": "@taprun/from-playwright"
  }
}
```

## Related

- [`plan-v1` reference](/spec/plan-v1/) — the format produced
- [`tap-v1` namespace](/ns/tap-v1/) — the JSON-LD vocabulary
- Sister adapters: [`@taprun/from-puppeteer`](/from-puppeteer/) · [`@taprun/from-stagehand`](/from-stagehand/)
- [Compare to Stagehand / Browserbase](/compare/stagehand/)
