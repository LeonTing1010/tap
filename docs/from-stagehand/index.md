---
title: "@taprun/from-stagehand — SoftwareAgent identifier"
description: "Stable IRI for the @taprun/from-stagehand adapter. Embedded as generator.id in every .tap.json plan compiled from a Stagehand script. Hybrid: deterministic ops where structure is known, NL fallback at runtime where it isn't — runs locally, no Browserbase egress."
permalink: /from-stagehand/
layout: default
---

# @taprun/from-stagehand

> Stable identifier (`SoftwareAgent.id`) for the [`@taprun/from-stagehand`](https://jsr.io/@taprun/from-stagehand) adapter. Every `.tap.json` plan compiled from a Stagehand source carries `"generator": { "id": "https://taprun.dev/from-stagehand", "type": "SoftwareAgent" }` so any W3C Web Annotation consumer can dereference the producer.

Part of the [**Capture**](/capture/) plane — one of Tap's three primitive planes (Capture / Replay / Verify).

## What this adapter does

Convert Stagehand scripts to `.tap.json` and run them locally — keep your `act()` / `extract()` calls, drop the cloud dependency. Hybrid mode:

- Deterministic Playwright surface (`page.goto`, `.click`, `.fill`, etc.) → fixed plan-v1 ops
- Stagehand NL surface (`stagehand.act`, `stagehand.extract`, `stagehand.observe`, `stagehand.agent().execute`) → `{ op: "exec", allowUnverifiable: true }` with the original prompt preserved in the `fn` field

The result is a partially deterministic plan: Tap can `doctor` and `fix` the deterministic portion; the NL portion remains a black box that Stagehand re-resolves at runtime. Tap reports each NL step via `allowUnverifiable: true` so consumers know exactly which steps require an LLM.

## Install

- JSR: <https://jsr.io/@taprun/from-stagehand>
- npm: <https://www.npmjs.com/package/@taprun/from-stagehand>
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
    "name": "trending-search",
    "intent": "read",
    "ops": [
      { "op": "nav", "url": "https://github.com/trending" },
      {
        "op": "exec",
        "allowUnverifiable": true,
        "fn": "stagehand.act('click the language filter and pick TypeScript')"
      }
    ]
  },
  "generator": {
    "id": "https://taprun.dev/from-stagehand",
    "type": "SoftwareAgent",
    "name": "@taprun/from-stagehand"
  }
}
```

## Related

- [`plan-v1` reference](/spec/plan-v1/) — the format produced
- [`tap-v1` namespace](/ns/tap-v1/) — the JSON-LD vocabulary
- Sister adapters: [`@taprun/from-playwright`](/from-playwright/) · [`@taprun/from-puppeteer`](/from-puppeteer/)
- [Why Tap vs Stagehand / Browserbase](/compare/stagehand/) — the architectural argument for going local-first
