---
title: "tap-v1 — Web Annotation extension vocabulary"
description: "Stable JSON-LD vocabulary that extends W3C Web Annotation with tap-specific terms (tap:ExecutionPlan, tap:executing, tap:layer). Versioned at tap-v1 since 2026-04-15."
permalink: /ns/tap-v1/
---

# tap-v1 — Web Annotation extension vocabulary

**Stable IRI:** `https://taprun.dev/ns/tap-v1`
**JSON-LD context:** [`index.jsonld`](./index.jsonld)
**Version:** `tap-v1`
**Issued:** 2026-04-15
**Modified:** 2026-04-23
**License:** [CC0 1.0 Universal](https://creativecommons.org/publicdomain/zero/1.0/)

## What this is

`tap-v1` is the namespace for Tap-specific extensions to the
[W3C Web Annotation Data Model](https://www.w3.org/TR/annotation-model/).

Two on-disk surfaces carry `tap:*` terms:

1. **A compiled Tap program** — stored as a `.tap.json` W3C Annotation with
   motivation `tap:executing` and a `tap:ExecutionPlan` body. Authors write
   programs in JavaScript (`.tap.js` is a plain ES module, not an
   Annotation); Tap's migrator compiles that source into the `.tap.json`
   plan that runtimes actually execute.
2. **A doctor assessment** — a W3C Annotation with motivation
   `oa:assessing` whose body carries `tap:verdict` and related diagnostic
   properties.

A third set of terms (`tap:SemanticHashState`, `tap:JsonPathSelector`,
and their sub-properties) is defined for Tap's forge-time intermediate
fingerprint artifacts. These are used inside the toolchain but are not
persisted in a stored `.tap.json`.

## Why it exists

The W3C Web Annotation context (`http://www.w3.org/ns/anno.jsonld`) does
not define tokens for program execution plans, structural-hash
fingerprints, or doctor diagnostics. Without a published `tap-v1`
context, every `tap:*` CURIE in a Tap annotation would fail strict
JSON-LD validation. This document is what lets external tooling
(annotation stores, EPUB readers, validators) consume Tap annotations
without a custom profile.

Tap itself parses `tap:*` fields by literal key and does not require
runtime context resolution, so the runtime cost of this document is zero
— it exists purely as a stable identifier and as documentation for
external consumers.

## What it defines

### Live in stored `.tap.json`

| Term | Kind | Role |
|---|---|---|
| `tap:executing` | `oa:Motivation` | Motivation of a compiled Tap program |
| `tap:ExecutionPlan` | `rdfs:Class` | Body type of a compiled Tap program |
| `tap:site`, `tap:name`, `tap:intent` | properties | Tap identity/direction (appear as bare keys inside `tap:ExecutionPlan`) |
| `tap:health`, `tap:args` | properties | Tap contract + argument schema (bare keys inside `tap:ExecutionPlan`) |

### Live in a doctor `assessing` annotation

| Term | Kind | Role |
|---|---|---|
| `tap:verdict` | property | `healthy` · `broken` · `stale` · `layer-mismatch` · `unreachable` · `unverified` |
| `tap:compiledFromLayer` | property | Trust layer 1–4 the tap was compiled from |
| `tap:recommendedLayer` | property | Layer doctor recommends re-forging from |
| `tap:crossValidation` | property | Layer-1 vs. observed-value disagreement record (`{layer1Value, observedValue, disagreement}`) |
| `tap:suggestions` | property | Ordered diagnostic suggestions (free-text) |
| `tap:suggest_authoritative` | property | Optional ready-to-embed `AuthoritativeSpec` shown only when verdict is `unverified` AND a known-shape source exists for the target. Lets agents close the verification gap without hand-writing the V config. |

### Forge-time intermediate (not persisted)

| Term | Kind | Role |
|---|---|---|
| `tap:JsonPathSelector` | `rdfs:Class`, subclass of `oa:Selector` | JSONPath candidate selector per RFC 9535 |
| `tap:SemanticHashState` | `rdfs:Class`, subclass of `oa:State` | Forge fingerprint blob |
| `tap:rootHash`, `tap:selectors`, `tap:endpoints`, `tap:jsonLdValues` | properties | Fingerprint sub-hashes inside `tap:SemanticHashState` |

### Deprecated

| Term | Kind | Note |
|---|---|---|
| `tap:extracting` | `oa:Motivation` | Superseded by `tap:executing` (2026-04-23). Never reached a stored `.tap.json`; retained for namespace stability. |

See [`index.jsonld`](./index.jsonld) for the full context document and
normative definitions.

## Example: a compiled Tap program

```json
{
  "@context": [
    "http://www.w3.org/ns/anno.jsonld",
    "https://taprun.dev/ns/tap-v1"
  ],
  "id": "https://taprun.dev/taps/github/trending",
  "type": "Annotation",
  "motivation": "tap:executing",
  "target": "https://taprun.dev/taps/github/trending",
  "body": {
    "type": "tap:ExecutionPlan",
    "site": "github",
    "name": "trending",
    "intent": "read",
    "description": "Trending GitHub repositories",
    "health": { "min_rows": 5, "non_empty": ["repo"] },
    "args": { "limit": { "type": "int", "default": 20 } },
    "ops": [
      { "op": "nav", "url": "https://github.com/trending" },
      { "op": "wait", "selector": "article.Box-row" },
      {
        "op": "exec",
        "fn": "async (handle) => handle.eval(() => Array.from(document.querySelectorAll('article.Box-row')).map(el => ({ repo: el.querySelector('h2 a')?.textContent?.trim() })))"
      }
    ]
  },
  "generator": {
    "id": "https://taprun.dev/migrate",
    "type": "SoftwareAgent",
    "version": "1"
  },
  "created": "2026-04-23T00:00:00Z"
}
```

A consumer that only understands W3C Web Annotation sees a valid
`Annotation` with a motivation, a target IRI, and a body. A Tap-aware
consumer additionally reads the `tap:ExecutionPlan` body and can replay
the program against the declared target.

## Example: a doctor assessment

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
  "created": "2026-04-23T00:00:00Z"
}
```

## Stability

- The namespace URI `https://taprun.dev/ns/tap-v1` is **stable
  forever**. Once `tap:JsonPathSelector` means what it means in this
  document, it means that permanently.
- Backward-incompatible changes ship under a new namespace (`tap-v2/`).
- Additive, non-breaking refinements may update this document in place
  (e.g. adding a new property, or marking a term deprecated). The
  version identifier stays `tap-v1`.
- Deprecated terms are kept in the document (marked
  `owl:deprecated: true`) rather than removed, so external data that
  referenced them remains valid.

## License

This namespace document is released under
[CC0 1.0 Universal](https://creativecommons.org/publicdomain/zero/1.0/) —
vocabulary infrastructure should never carry usage restrictions. You can
freely reference, mirror, or redistribute this document.

## Serving note (for operators)

The file at `./index.jsonld` should be served with
`Content-Type: application/ld+json` when dereferenced. GitHub Pages'
default MIME for `.jsonld` is `application/octet-stream`, which most
strict JSON-LD processors accept as long as they can parse the body —
Tap's own consumers never fetch this context — but external validators
may warn. A future move to a host with configurable MIME types (or a
Cloudflare Worker in front of Pages) can fix this without changing the
URI. See `./SERVING.md` if present.

## References

- [W3C Web Annotation Data Model](https://www.w3.org/TR/annotation-model/)
- [W3C Web Annotation Vocabulary](https://www.w3.org/TR/annotation-vocab/)
- [W3C Selectors and States](https://www.w3.org/TR/selectors-states/)
- [RFC 9535 — JSONPath](https://www.rfc-editor.org/rfc/rfc9535)
- [Tap homepage](https://taprun.dev/)
- [Tap `/ns/` root namespace](../) — Schema.org-layered vocabulary (separate from tap-v1, used by pre-migration `.jsonld` manifests)
