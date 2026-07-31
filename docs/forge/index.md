---
title: "forge — capture-plane engine"
description: "Stable IRI for the forge engine. The `capture` meta verb turns a URL × natural-language intent into a deterministic v2 Plan. Deterministic templates first, AI long-tail."
permalink: /forge/
layout: default
---

# forge

> Stable identifier (`SoftwareAgent.id`) for the **forge** engine. Forge is the engine behind the `capture` meta verb — one of Tap's three primitive planes (Capture / Replay / Verify). Plans produced by forge carry `compiled_by` metadata so consumers can distinguish forge output from hand-edits.

## What this engine does

Forge is exposed via the single `capture` meta verb (per the v2 surface vocabulary — three meta verbs: `capture` / `verify` / `mark`). Internally it runs three stages that share an inspect cache:

1. **Inspect** — pulls the live page's structural signal: JSON-LD, schema.org, Annotation/RDFa data, semantic HTML, network-layer JSON the page actually fetches, agents.json descriptors, OpenAPI references. Output is a normalised structural report; no plan is written.

2. **Draft** — consumes the inspect report (and any natural-language `intent`) and emits a bare v2 `Plan`. Two paths:
   - **Deterministic templates** (~80% of common shapes) — when a high-trust source carries the answer (RSS feed, JSON-LD, OpenAPI, agents.json, observed API endpoint), forge emits a template-derived Plan with no LLM tokens spent.
   - **AI fallback** (long tail) — when no template fits, forge prompts an AI model with the structural signal as context and asks it to produce the `observe` (or `act`+`confirm`+`key`) array. The model writes Plan ops within the closed 13-op vocabulary, not arbitrary code. Requires the **Capture** tier or higher (`core/auth.ts:gateAiForge`).

3. **Lint gate** — forge runs the output through `lintPlan` before saving. Non-conformant outputs are rejected; the AI is reprompted up to N times. Saved plans land in `~/.tap/flows/<site>/<name>.flow.json`. The `core/auth.ts:gateCaptureSave` fleet-cap gate fires before persistence: re-saves of an existing `<site>/<name>` (overwrite / heal) are exempt; new entries count against the tier budget (3 / 5 / 20).

## Where it ships

`forge` is part of the proprietary Tap CLI (closed engine). The output conforms to [`@taprun/spec`](https://www.npmjs.com/package/@taprun/spec) v1.0+.

- Install Tap: <https://taprun.dev>
- Format types and JSON Schema: <https://www.npmjs.com/package/@taprun/spec>

## Sample plans produced

### Read variant

```json
{
  "id": { "site": "github", "name": "trending" },
  "description": "Trending repos via the search API",
  "observe": [
    {
      "op": "fetch",
      "url": "https://api.github.com/search/repositories?q=stars:>1000",
      "format": "json",
      "save": "raw"
    }
  ],
  "return": "$.raw.items"
}
```

### Write variant

```json
{
  "id": { "site": "twitter", "name": "post" },
  "args": { "text": { "type": "string", "required": true } },
  "key": "$.args.text",
  "observe": [
    { "op": "fetch", "url": "https://twitter.com/api/me/drafts", "save": "drafts" }
  ],
  "act": [
    { "op": "input", "kind": "fill",  "target": "[data-testid='tweetTextarea_0']", "value": "{{$.args.text}}" },
    { "op": "input", "kind": "click", "target": "[data-testid='tweetButton']" }
  ],
  "confirm": [
    { "op": "wait", "selector": "[data-testid='toast']", "timeout_ms": 5000 }
  ],
  "return": "$.confirm[0]"
}
```

The read variant has no `act` or `key` (TypeScript: `never`). The write variant requires both. Invalid combinations are unrepresentable at the type level, not just at lint time.

## Related

- [Plan format](/spec/plan-v1/) — bare `Plan` reference
- [verify](/doctor/) — 4-arm verdict on forge output
- [Migration guide](/migration-guide/) — upgrading v1 envelopes to v2 Plans
- Already have a script? Use the dedicated adapters: [`@taprun/from-playwright`](/from-playwright/) · [`@taprun/from-puppeteer`](/from-puppeteer/) · ([`@taprun/from-stagehand`](/from-stagehand/) is deprecated — see [migration guide](/migration-guide/))
