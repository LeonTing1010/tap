# @taprun/spec — Changelog

## 0.3.1 — 2026-04-26

- README: add "Part of the Tap ecosystem" footer with UTM-tagged links to taprun.dev (homepage, Chrome extension, comparison page) plus cross-links to sibling JSR packages.

## 0.3.0 — 2026-04-26

Initial release as a publishable surface. Three independent layers shipped together:

- **TypeScript types** vendored byte-equivalent from private `tap-core/core/compose/{plan,annotation,annotation_validator}.ts`. Drift-guarded by `core/src/test/spec_extraction_test.ts`.
  - `ExecutionPlan`, `TapAnnotation`, `OP_NAMES` (24-member closed union), all op interfaces, `HealthContract`, `AuthoritativeSpec` (3 source variants), `ArgSpec`.
- **W3C Annotation validator** — `validateAnnotation(value)`. Zero runtime dependencies. Implements MUST-level checks from W3C 2017 Recommendation §3.1, §3.3.5, §4.
- **JSON Schema 2020-12** at `schemas/plan-v1.schema.json` (also exported via `@taprun/spec/schema`). Drift-guarded against `OP_NAMES`.
- **Conformance suite** — `runConformance(value)` + `CONFORMANCE_FIXTURES` (2 good + 8 bad covering all six failure categories: envelope / body / intent / ops / op-name / authoritative).

Versioning commitment from this point:
- `0.x` is pre-1.0; field additions allowed, removals require minor bump
- Op-union additions require an ADR in private tap-core docs and minor bump
- Format reference doc lives at <https://taprun.dev/spec/plan-v1/>
