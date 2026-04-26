---
title: "tap forge — SoftwareAgent identifier"
description: "Stable IRI for the tap forge agent. Embedded as generator.id in every .tap.json plan compiled from a URL or natural-language description by the proprietary Tap CLI's forge command."
permalink: /forge/
layout: default
---

# tap forge

> Stable identifier (`SoftwareAgent.id`) for the **forge** agent. Forge is the headline tool of the [**Capture**](/capture/) plane — one of Tap's three primitive planes (Capture / Replay / Verify). Plans compiled by `tap forge <url|"description">` carry `"generator": { "id": "https://taprun.dev/forge", "type": "SoftwareAgent" }` so consumers can dereference the producer.

## What this agent does

`tap forge <url>` (or `tap forge "<natural-language description>"`) compiles a target page into a deterministic `.tap.json` plan. The pipeline is structural-first:

1. **Inspect** — pull the live page's structural signal: JSON-LD, schema.org, Annotation/RDFa data, semantic HTML, network-layer JSON the page actually fetches.
2. **Tier 0 compile** — when a high-trust source (Layer 1 / Layer 2) carries the answer, forge emits a deterministic program directly. No LLM token is spent on Tier 0 plans.
3. **AI fallback** — when Tier 0 fails, forge prompts an AI model with the structural signal as context and asks it to produce a `body.ops` array. The model writes plan ops, not arbitrary code.
4. **Conformance gate** — forge runs the output through `runConformance` from [`@taprun/spec`](https://jsr.io/@taprun/spec) before saving. Non-conformant outputs are rejected; the AI is reprompted up to N times.

The result is a `.tap.json` plan that any other Tap install can replay at zero LLM cost.

## Where it ships

`forge` is part of the proprietary Tap CLI (closed engine). The output is an open `.tap.json` envelope conforming to [`@taprun/spec`](https://jsr.io/@taprun/spec).

- Install Tap: <https://taprun.dev>
- Source for the public format / spec: <https://github.com/LeonTing1010/tap>

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
      { "op": "fetch", "url": "https://github.com/trending" },
      { "op": "extract", "root": "article.Box-row", "per_item": { "repo": "h2 a" } }
    ]
  },
  "generator": {
    "id": "https://taprun.dev/forge",
    "type": "SoftwareAgent",
    "version": "plan-v1"
  }
}
```

## Why this URL exists

The IRI is the protocol-stable identifier for "this plan was produced by Tap forge". Tap consumers (or any W3C Web Annotation consumer) can dereference it to learn what compiled the plan, its versioning policy, and how to verify the output via `tap doctor`.

## Related

- [`plan-v1` reference](/spec/plan-v1/) — the format produced
- [`tap-v1` namespace](/ns/tap-v1/) — the JSON-LD vocabulary
- [`tap doctor`](/doctor/) — drift-detection on plans forge produced
- Already have a script? Use the dedicated adapters: [`@taprun/from-playwright`](/from-playwright/) · [`@taprun/from-puppeteer`](/from-puppeteer/) · [`@taprun/from-stagehand`](/from-stagehand/)
