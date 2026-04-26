---
title: "create-tap-script — SoftwareAgent identifier"
description: "Stable IRI for the create-tap-script scaffolder. Embedded as generator.id in every starter .tap.json plan produced via `npx create-tap-script <site>/<name> <url>`."
permalink: /create-tap-script/
layout: default
---

# create-tap-script

> Stable identifier (`SoftwareAgent.id`) for the [`create-tap-script`](https://jsr.io/@taprun/create-tap-script) scaffolder. Every starter `.tap.json` plan produced by the CLI carries `"generator": { "id": "https://taprun.dev/create-tap-script", "type": "SoftwareAgent" }` so any W3C Web Annotation consumer can dereference the producer.

## What this tool does

Scaffold a starter `.tap.json` plan in one command:

```bash
npx create-tap-script <site>/<name> <url> [--intent read|write] [--out DIR]
```

Outputs a valid plan-v1 envelope (passes `runConformance` from `@taprun/spec` out of the box) plus a `<name>.README.md` with next-step notes. Customize the `body.ops` array from there.

## Install

- npm: <https://www.npmjs.com/package/create-tap-script>
- JSR: <https://jsr.io/@taprun/create-tap-script>
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
    "description": "Starter plan scaffolded by create-tap-script. Customize body.ops.",
    "ops": [
      { "op": "nav", "url": "https://github.com/trending" }
    ]
  },
  "generator": {
    "id": "https://taprun.dev/create-tap-script",
    "type": "SoftwareAgent",
    "version": "0.1.1"
  }
}
```

## Related

- [`plan-v1` reference](/spec/plan-v1/) — the format produced
- [`tap-v1` namespace](/ns/tap-v1/) — the JSON-LD vocabulary
- Already have a script? Use the dedicated adapters: [`@taprun/from-playwright`](/from-playwright/) · [`@taprun/from-puppeteer`](/from-puppeteer/) · [`@taprun/from-stagehand`](/from-stagehand/)
