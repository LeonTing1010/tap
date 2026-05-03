---
title: "create-tap-script — v2 starter scaffolder"
description: "create-tap-script scaffolds a bare v2 Plan in one command, ready to customize."
permalink: /create-tap-script/
layout: default
---

# create-tap-script

> Stable identifier for the [`create-tap-script`](https://www.npmjs.com/package/create-tap-script) scaffolder. Bumped to **v1.0** for the v2 schema break. Output is a bare v2 `Plan` — no W3C envelope.

Part of the **Capture** plane — one of Tap's three primitive planes (Capture / Replay / Verify).

## What this tool does

Scaffold a starter v2 Plan in one command:

```bash
npx create-tap-script@latest <site>/<name> <url> [--mode read|write] [--out DIR]
```

Outputs a valid bare `Plan` (passes `lintPlan` from `@taprun/spec@^1` out of the box) plus a `<name>.README.md` with next-step notes. Customize the `observe` (or `act`+`confirm`) array from there.

## Install

- npm: <https://www.npmjs.com/package/create-tap-script>
- Format types: <https://www.npmjs.com/package/@taprun/spec>

## Sample plans produced

### Read variant (default)

```json
{
  "id": { "site": "github", "name": "trending" },
  "description": "Starter plan scaffolded by create-tap-script. Customize observe[].",
  "observe": [
    { "op": "nav", "url": "https://github.com/trending" }
  ],
  "return": "$.observe[0]"
}
```

### Write variant (with `--mode write`)

```json
{
  "id": { "site": "example", "name": "post" },
  "description": "Starter write plan. Fill in act[] + confirm[].",
  "args": { "text": { "type": "string", "required": true } },
  "key": "$.args.text",
  "observe": [
    { "op": "nav", "url": "https://example.com" }
  ],
  "act": [
    { "op": "input", "kind": "click", "target": "button.compose" }
  ],
  "confirm": [
    { "op": "wait", "selector": ".toast", "timeout_ms": 5000 }
  ],
  "return": "$.confirm[0]"
}
```

The read variant has `observe` only; the write variant requires `act` + `key` together (TypeScript discriminated union — the type system rejects `{act: [...]}` without `key`).

## Related

- [Plan format](/spec/plan-v1/) — bare `Plan` reference
- [Migration guide](/migration-guide/) — v1 envelope → v2 bare Plan
- Already have a script? Use the dedicated adapters: [`@taprun/from-playwright`](/from-playwright/) · [`@taprun/from-puppeteer`](/from-puppeteer/)
