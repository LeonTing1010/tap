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
A Tap program (`.tap.js`) is represented as a W3C `Annotation`. Everything
Tap adds on top of the standard shape — the JSONPath selector, the
semantic-hash state, the `extracting` motivation, the health/args metadata
— lives under this namespace.

## Why it exists

The W3C Web Annotation context (`http://www.w3.org/ns/anno.jsonld`) does
not define tokens for JSONPath navigation, structural-hash fingerprints,
or program-level extraction. Without a published tap-v1 context, every
`tap:*` CURIE in a Tap annotation would fail strict JSON-LD validation.
This document is the hard prerequisite for Phase 1 of the Tap Web
Annotation migration — publishing it is what allows external tooling
(Hypothes.is importers, EPUB readers, annotation stores) to consume Tap
annotations without a custom profile.

Tap itself parses `tap:*` fields by literal key and does not require
runtime context resolution, so the runtime cost of this document is zero
— it exists purely as a stable identifier and as documentation for
external consumers.

## What it defines

| Term | Kind | Purpose |
|---|---|---|
| `tap:JsonPathSelector` | `rdfs:Class`, subclass of `oa:Selector` | JSONPath expression per RFC 9535 — Layer 1/2 structural navigation |
| `tap:SemanticHashState` | `rdfs:Class`, subclass of `oa:State` | Structural fingerprint for drift detection |
| `tap:extracting` | `oa:Motivation` instance | Program-level extraction (distinct from `oa:identifying`) |
| `tap:rootHash` | property | FNV-1a Merkle root over sub-hashes |
| `tap:selectors` | property | Captured selector population summary |
| `tap:endpoints` | property | Observed network endpoints + shape hashes |
| `tap:jsonLdValues` | property | Layer-1 `@type` list observed at authoring time (drift signal) |
| `tap:health` | property | Tap health contract (JSON) |
| `tap:args` | property | Tap argument schema (JSON) |
| `tap:site`, `tap:name`, `tap:intent` | properties | Tap identity/direction |
| `tap:verdict`, `tap:compiledFromLayer`, `tap:recommendedLayer`, `tap:crossValidation`, `tap:suggestions` | properties | Doctor `assessing` annotation body |

See [`index.jsonld`](./index.jsonld) for the full context document and
normative definitions.

## Example: a Tap annotation using `tap:*`

```json
{
  "@context": [
    "http://www.w3.org/ns/anno.jsonld",
    "https://taprun.dev/ns/tap-v1"
  ],
  "@type": "Annotation",
  "id": "tap:github/trending",
  "motivation": "identifying",
  "tap:site": "github",
  "tap:name": "trending",
  "tap:intent": "read",
  "target": {
    "source": "https://github.com/trending",
    "selector": [
      {
        "type": ["FragmentSelector", "tap:JsonPathSelector"],
        "value": "jsonld",
        "refinedBy": {
          "type": "tap:JsonPathSelector",
          "value": "$.itemListElement[*]",
          "conformsTo": "https://www.rfc-editor.org/rfc/rfc9535"
        }
      },
      { "type": "CssSelector", "value": "article.Box-row" }
    ],
    "state": {
      "type": ["TimeState", "tap:SemanticHashState"],
      "sourceDate": "2026-04-15T00:00:00Z",
      "tap:rootHash": "fnv1a:abc123",
      "tap:jsonLdValues": ["ItemList"]
    }
  },
  "body": {
    "purpose": "tap:extracting",
    "format": "application/tap+javascript",
    "tap:health": { "min_rows": 5, "non_empty": ["repo"] },
    "tap:args": { "limit": { "type": "int", "default": 20 } }
  }
}
```

A consumer that only understands W3C Web Annotation sees a valid
`Annotation` with a selector chain, a state, and a target. A Tap-aware
consumer additionally reads the `tap:*` fields and can replay the
program against the declared structural address.

## Stability

- The namespace URI `https://taprun.dev/ns/tap-v1` is **stable
  forever**. Once `tap:JsonPathSelector` means what it means in this
  document, it means that permanently.
- Backward-incompatible changes ship under a new namespace (`tap-v2/`).
- Additive, non-breaking refinements may update this document in place
  (e.g. adding a new property). The version identifier stays `tap-v1`.

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
