# @taprun/spec — Changelog

## 1.1.1 — 2026-05-10

- Fix: ship `schemas/plan-v1.schema.json` in the npm tarball. The 0.3.0
  changelog promised this file as the `@taprun/spec/schema` subpath
  export, but neither `files` nor `exports` in `package.json` referenced
  it — the schema only lived in source-tree and on `taprun.dev`. Adds
  `"./schema": "./schemas/plan-v1.schema.json"` to `exports` and
  `schemas/plan-v1.schema.json` (plus `CHANGELOG.md`) to `files`.
  Verified via `npm pack --dry-run`.

## 1.1.0 — 2026-05-05

- Land `TAP_V1_NS_TERMS` (and `TAP_V1_PLAN_TERMS` / `TAP_V1_ASSESSMENT_TERMS` / `TAP_V1_NS_IRI`) for real. The 0.3.2 entry below promised these but the source file (`src/ns-vocabulary.ts`) was never committed; the `packages.yml :: ns-cross-consumer-only` CI gate has been failing since because `m.TAP_V1_NS_TERMS` resolved to undefined. Now ships exactly the 13 terms documented in `docs/ns/tap-v1/{index.jsonld,README.md}`. CI gate green.

## 0.3.2 — 2026-04-26

- Add `TAP_V1_NS_TERMS` (and `TAP_V1_PLAN_TERMS` / `TAP_V1_ASSESSMENT_TERMS` / `TAP_V1_NS_IRI`) — the exact cross-consumer protocol contract term set defined at https://taprun.dev/ns/tap-v1/. Source-of-truth for the namespace; downstream consumers (incl. the proprietary Tap CLI) can import these to keep emit sites aligned with the namespace doc.
- Internal: rename one property `tap:suggest_authoritative` → `tap:suggestAuthoritative` (camelCase per JSON-LD/RDF convention).

## 0.3.1 — 2026-04-26

- README: add "Part of the Tap ecosystem" footer with UTM-tagged links to taprun.dev (homepage, Chrome extension, comparison page) plus cross-links to sibling JSR packages.

## 0.3.0 — 2026-04-26

Initial release as a publishable surface. Three independent layers shipped together:

- **TypeScript types** vendored byte-equivalent from the upstream Tap reference implementation. Drift-guarded by an extraction test in the upstream repo.
  - `ExecutionPlan`, `TapAnnotation`, `OP_NAMES` (24-member closed union), all op interfaces, `HealthContract`, `AuthoritativeSpec` (3 source variants), `ArgSpec`.
- **W3C Annotation validator** — `validateAnnotation(value)`. Zero runtime dependencies. Implements MUST-level checks from W3C 2017 Recommendation §3.1, §3.3.5, §4.
- **JSON Schema 2020-12** at `schemas/plan-v1.schema.json` (also exported via `@taprun/spec/schema`). Drift-guarded against `OP_NAMES`.
- **Conformance suite** — `runConformance(value)` + `CONFORMANCE_FIXTURES` (2 good + 8 bad covering all six failure categories: envelope / body / intent / ops / op-name / authoritative).

Versioning commitment from this point:
- `0.x` is pre-1.0; field additions allowed, removals require minor bump
- Op-union additions require a spec amendment in the upstream reference implementation and a minor bump here
- Format reference doc lives at <https://taprun.dev/spec/plan-v1/>
