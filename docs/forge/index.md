---
title: "forge — capture-plane agent"
description: "Stable IRI for the forge agent. forge.inspect + forge.draft turn a URL or natural-language description into a deterministic v2 Plan. Deterministic templates first, AI long-tail."
permalink: /forge/
layout: default
---

# forge

> Stable identifier (`SoftwareAgent.id`) for the **forge** agent. Forge is the headline tool of the **Capture** plane — one of Tap's three primitive planes (Capture / Replay / Verify). Plans produced by forge carry `compiled_by` metadata so consumers can distinguish forge output from hand-edits.

## What this agent does

Forge is split into two MCP tools that share an inspect cache:

1. **`forge.inspect <url>`** — pulls the live page's structural signal: JSON-LD, schema.org, Annotation/RDFa data, semantic HTML, network-layer JSON the page actually fetches, agents.json descriptors, OpenAPI references. Output is a normalised structural report; no plan is written.

2. **`forge.draft`** — consumes the inspect report (or a natural-language description) and emits a bare v2 `Plan`. Two paths:
   - **Deterministic templates** (~80% of common shapes) — when a high-trust source carries the answer (RSS feed, JSON-LD, OpenAPI, agents.json, observed API endpoint), forge emits a template-derived Plan with no LLM tokens spent.
   - **AI fallback** (long tail) — when no template fits, forge prompts an AI model with the structural signal as context and asks it to produce the `observe` (or `act`+`confirm`+`key`) array. The model writes Plan ops within the closed 11-op vocabulary, not arbitrary code.

3. **Lint gate** — forge runs the output through `lintPlan` before saving. Non-conformant outputs are rejected; the AI is reprompted up to N times. Saved plans land in `~/.tap/plans/<site>/<name>.plan.json`.

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
- [doctor](/doctor/) — 4-arm verdict on forge output
- [Migration guide](/migration-guide/) — upgrading v1 envelopes to v2 Plans
- Already have a script? Use the dedicated adapters: [`@taprun/from-playwright`](/from-playwright/) · [`@taprun/from-puppeteer`](/from-puppeteer/) · ([`@taprun/from-stagehand`](/from-stagehand/) is deprecated — see [migration guide](/migration-guide/))
