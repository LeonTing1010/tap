---
title: "tap migrate — SoftwareAgent identifier"
description: "Stable IRI for the tap migrate agent. Embedded as generator.id in every plan that has been mechanically migrated from a legacy plan format to the current plan-v1 envelope."
permalink: /migrate/
layout: default
---

# tap migrate

> Stable identifier (`SoftwareAgent.id`) for the **migrate** agent. Plans that have been mechanically translated from a legacy plan format into the current `plan-v1` W3C Annotation envelope carry `"generator": { "id": "https://taprun.dev/migrate", "type": "SoftwareAgent" }` so consumers can distinguish migrated plans from freshly-forged ones.

## What this agent does

`migrate` is the internal one-way translator inside the Tap CLI that lifts legacy `.tap.js` plan files into the canonical `plan-v1` W3C Annotation envelope. It runs automatically — there is no user-facing `tap migrate` command. Plans are migrated on the path that needs them (e.g. `handleSavePlan`, fingerprint baselining, fleet refresh), and the resulting `.tap.json` carries `"generator": { "id": "https://taprun.dev/migrate" }` so consumers can distinguish a migrated plan from one that was freshly forged.

Migrations preserve all observable behaviour and never invent ops. Anything the legacy `.tap.js` source expressed that has no clean `plan-v1` op becomes `{ op: "exec", allowUnverifiable: true }` carrying the original function body, so the consumer knows the step needs review or a re-forge.

A migrated plan that no longer matches site behaviour is a candidate for re-forge: `tap forge <site>/<name>` produces a fresh deterministic plan from the current page, and [`tap doctor`](/doctor/) can pinpoint exactly which migrated step diverged.

## Where it ships

`migrate` is part of the proprietary Tap CLI. The output is an open `.tap.json` envelope conforming to [`@taprun/spec`](https://jsr.io/@taprun/spec).

- Install Tap: <https://taprun.dev>
- Source for the public format / spec: <https://github.com/LeonTing1010/tap>

## Sample migrated envelope

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
    "id": "https://taprun.dev/migrate",
    "type": "SoftwareAgent",
    "version": "1"
  }
}
```

## Related

- [`plan-v1` reference](/spec/plan-v1/) — the target format
- [`tap-v1` namespace](/ns/tap-v1/) — the JSON-LD vocabulary
- [`tap forge`](/forge/) — the agent that produces fresh (non-migrated) plans
- [`tap doctor`](/doctor/) — the drift detector for migrated plans
