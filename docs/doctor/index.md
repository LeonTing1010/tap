---
title: "tap doctor — SoftwareAgent identifier"
description: "Stable IRI for the tap doctor diagnostic agent. Embedded as generator.id in every drift-detection annotation and 4-layer cross-validation report Tap produces."
permalink: /doctor/
layout: default
---

# tap doctor

> Stable identifier (`SoftwareAgent.id`) for the **doctor** agent. Doctor is the headline tool of the [**Verify**](/verify/) plane — one of Tap's three primitive planes (Capture / Replay / Verify). Drift-detection annotations and 4-layer semantic cross-validation reports carry `"generator": { "id": "https://taprun.dev/doctor", "type": "SoftwareAgent" }` so consumers can dereference the producer.

## What this agent does

`tap doctor <site>/<name>` runs a 4-layer semantic cross-validation against the page Tap last compiled:

1. **JSON-LD** — schema.org / Annotation / RDFa canonical data, when present
2. **API JSON** — the network-layer JSON the page actually fetches
3. **Semantic HTML** — `<article>`, `<h1>`, `<address>`, `<time>` and matching ARIA roles
4. **CSS / structure** — class names and DOM shape

When higher-trust layers disagree with the layer the plan currently uses, doctor emits a drift report and (optionally) suggests a re-forge from a higher-trust layer. This is the part of Tap that catches "site changed but my scraper still pretends to work" — silent rot.

## Where it ships

`doctor` is part of the proprietary Tap CLI (closed engine). Drift reports it produces are open W3C Annotation envelopes that any tool can consume.

- Install Tap: <https://taprun.dev>
- Source for the public format / spec: <https://github.com/LeonTing1010/tap>

## Sample doctor assessment

```json
{
  "@context": [
    "http://www.w3.org/ns/anno.jsonld",
    "https://taprun.dev/ns/tap-v1"
  ],
  "type": "Annotation",
  "motivation": "assessing",
  "target": "tap:github/trending",
  "body": {
    "tap:verdict": "layer-mismatch",
    "tap:compiledFromLayer": 4,
    "tap:recommendedLayer": 1,
    "tap:crossValidation": {
      "layer1Value": 25,
      "observedValue": 18,
      "disagreement": "ItemList.numberOfItems differs from extracted row count"
    },
    "tap:suggestions": [
      "Re-forge from Layer 1 (JSON-LD ItemList present on this page)",
      "Current selector targets Layer 4 (CSS classes); higher-trust source available"
    ]
  },
  "generator": { "id": "https://taprun.dev/doctor", "type": "SoftwareAgent" },
  "created": "2026-04-26T00:00:00Z"
}
```

The `motivation` is W3C-standard `"assessing"` — Tap does **not** mint a `tap:diagnosing` motivation; doctor reports ride the W3C envelope directly. See [`tap-v1` namespace](/ns/tap-v1/) for the full term list including verdict states (`healthy` / `broken` / `stale` / `layer-mismatch` / `unreachable` / `unverified`) and the optional `tap:suggest_authoritative` field.

## Related

- [`plan-v1` reference](/spec/plan-v1/) — the plan format doctor cross-validates against
- [`tap-v1` namespace](/ns/tap-v1/) — the JSON-LD vocabulary including `tap:DriftReport` and `tap:layerDisagreement`
- [Why competitors can't solve silent rot](/compare/stagehand/) — the architectural argument
