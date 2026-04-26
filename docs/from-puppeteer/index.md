---
title: "@taprun/from-puppeteer — SoftwareAgent identifier"
description: "Stable IRI for the @taprun/from-puppeteer adapter. Embedded as generator.id in every .tap.json plan compiled from a Puppeteer script. Convert Puppeteer automation to local-first plan-v1 envelopes, no rewrite."
permalink: /from-puppeteer/
layout: default
---

# @taprun/from-puppeteer

> Stable identifier (`SoftwareAgent.id`) for the [`@taprun/from-puppeteer`](https://jsr.io/@taprun/from-puppeteer) adapter. Every `.tap.json` plan compiled from a Puppeteer source carries `"generator": { "id": "https://taprun.dev/from-puppeteer", "type": "SoftwareAgent" }` so any W3C Web Annotation consumer can dereference the producer.

Part of the [**Capture**](/capture/) plane — one of Tap's three primitive planes (Capture / Replay / Verify).

## What this adapter does

Convert Puppeteer scripts into local-first `.tap.json` plans, no rewrite. Maps the seven most common page-level APIs (`page.goto`, `.click`, `.type`, `.keyboard.press`, `.waitForSelector`, `.waitForTimeout`, `.screenshot`) to the plan-v1 op union. Anything outside that surface becomes `{ op: "exec", allowUnverifiable: true }` preserving the original line, or throws under `strict: true`.

## Install

- JSR: <https://jsr.io/@taprun/from-puppeteer>
- npm: <https://www.npmjs.com/package/@taprun/from-puppeteer>
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
  "target": "https://example.com/login",
  "body": {
    "type": "tap:ExecutionPlan",
    "site": "example",
    "name": "login",
    "intent": "write",
    "ops": [
      { "op": "nav", "url": "https://example.com/login" },
      { "op": "input", "kind": "fill", "target": "#email", "value": "..." },
      { "op": "input", "kind": "click", "target": "button[type=submit]" }
    ]
  },
  "generator": {
    "id": "https://taprun.dev/from-puppeteer",
    "type": "SoftwareAgent",
    "name": "@taprun/from-puppeteer"
  }
}
```

## Related

- [`plan-v1` reference](/spec/plan-v1/) — the format produced
- [`tap-v1` namespace](/ns/tap-v1/) — the JSON-LD vocabulary
- Sister adapters: [`@taprun/from-playwright`](/from-playwright/) · [`@taprun/from-stagehand`](/from-stagehand/)
- [Compare to Stagehand / Browserbase](/compare/stagehand/)
