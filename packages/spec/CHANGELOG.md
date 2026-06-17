# @taprun/spec — Changelog

## 1.6.0 — 2026-06-16

**Additive (backward-compatible).** Three new `LINT_RULE_NAMES` slugs for the
op:eval value-only escape — DOM-mutation / form-submission verbs that have a
clean `op:input` alternative and so stay blocked (per core ADR
`2026-06-16-write-path-network-first-eval-value-only.md`, Clause A/D):

- `eval-forbidden-execcommand` — `document.execCommand(...)` (contenteditable
  rich-text writes)
- `eval-forbidden-submit` — `form.submit()` (click-free form submission)
- `eval-forbidden-requestsubmit` — `form.requestSubmit()`

These join the existing DOM-mutation blocks (`click`, `dispatchEvent`).
Page-native HTTP (`fetch` / `XMLHttpRequest`) remains intentionally permitted —
op:eval reflects page capability and there is no non-eval page-HTTP op.

## 1.3.0 — 2026-05-30

**Additive (backward-compatible).** New `InputOp.kind` member `"setHtml"`.
See ADR `2026-05-30-op-input-sethtml.md`.

- `src/types.ts` + `schemas/plan-v1.schema.json`: `InputOp.kind` enum widened
  from `["click","type","fill","press","upload"]` to add `"setHtml"`.
- Semantics: `{op:"input", kind:"setHtml", target, value}` assigns `value`
  to `target.innerHTML` (rich-text / contenteditable editors), where `fill`
  sets `.value`. `value` receives `{{$args}}` substitution as DATA, so large
  per-run HTML flows in as an arg instead of being baked into an `op:eval`
  literal.
- `OP_NAMES_V2` closure unchanged (still 11 ops); no op added.

## 1.2.0 — 2026-05-17

**BREAKING (silently — see below)**: schema realigned with Tap v2 plan
format. v0.x users who validated `.tap.json` plans against this package's
shipped `schemas/plan-v1.schema.json` were already getting wrong results
since the v2 launch on 2026-05-03 — the schema enumerated 24 ops
including `exec` / `parseXML` / `screenshot` / `scroll` / `compute` /
`filter` / `project` / `sort` / `dedupe` / `pick` / `limit` / `concat` /
`pipe`, all of which were deleted in v2, and the envelope still required
the W3C Annotation wrapper (`type: "Annotation"`, `motivation:
"tap:executing"`) and the deleted `intent: "read"|"write"` field. This
release replaces the schema with one that matches the live runtime.

- `schemas/plan-v1.schema.json`: complete rewrite.
  - `$id` set to `https://taprun.dev/spec/plan-v1/schema.json` (the
    canonical reference URL; `taprun.dev/spec/plan-v1.schema.json` is
    a byte-identical mirror).
  - `OpName.enum` now has 11 entries matching `OP_NAMES_V2` in
    `src/types.ts` (`fetch`, `nav`, `wait`, `input`, `extract`,
    `cookies`, `tap`, `if`, `foreach`, `parallel`, `eval`).
  - `$defs` now has a per-op variant (FetchOp / NavOp / WaitOp /
    InputOp / ExtractOp / CookiesOp / TapOp / IfOp / ForeachOp /
    ParallelOp / EvalOp) with all fields and `additionalProperties:
    false`.
  - Plan modeled as a discriminated union via `oneOf` of `PlanRead`
    (write fields forbidden via `not`) and `PlanWrite` (`act` + `key`
    both required).
  - No envelope wrapper. Plans are bare JSON per ADR tap-core
    `docs/adr/2026-05-03-unified-tap-primitive.md`.
- `src/types.ts`: align with `core/types.ts` v2 baseline.
  - Add `$schema?`, `expects?`, `source_url?`, `source_intent?` on
    `PlanCommon` (present in core since 2026-05-04 ~ 2026-05-09).
  - Remove `fingerprint_equivalent?` (deleted with snapshot subsystem
    per `2026-05-10-snapshot-dissolved.md`).
  - Remove `expose_as_mcp_tool?` (deleted per
    `2026-05-04-saved-taps-as-resources.md`; saved taps are MCP
    Resources now, not Tools).
  - `VERDICT_VALUES`: 4-arm `equivalent`/`drifted`/`baseline-set`/
    `unreachable` → 3-arm `live`/`drifted`/`unreachable` (snapshot
    dissolution again).
- `test/schema-drift.test.mjs`: new drift-guard. Asserts bidirectional
  parity between `schemas/plan-v1.schema.json` and `src/types.ts`:
  OpName.enum ⊇⊆ OP_NAMES_V2, every TS Op interface has a $defs entry,
  every $defs entry's `op` const is in OP_NAMES_V2, `$id` points at
  taprun.dev, no deleted v0.x ops leak. Runs via `npm test` (Node
  built-in test runner). Closes the silent-drift loophole — prior to
  1.2.0 only `tap-core/src/test/spec_public_subset_test.ts` guarded
  this, and only in one direction (no INTERNAL leak), letting deleted
  fields linger in spec indefinitely.

### Migration for existing consumers

- **TS types**: re-typecheck against 1.2.0. If you used
  `fingerprint_equivalent` / `expose_as_mcp_tool` / `Verdict ==
  "equivalent" | "baseline-set"` — those don't exist in v2 runtime
  either; drop the references.
- **JSON schema validation** (`@taprun/spec/schema` subpath import):
  before 1.2.0, any v2 plan was failing schema validation against
  the v0.x shape; after, it passes. If you had workarounds for
  "schema rejects valid plans," remove them.
- **Published artifact**: `taprun.dev/spec/plan-v1/schema.json` and
  `taprun.dev/spec/plan-v1.schema.json` are updated by the public/
  repo release pipeline to byte-match the npm tarball.

Related: LeonTing1010/tap#8 (this work), tap-core#47 (publish v2
reference), tap-core#46 (closed — envelope `intent` field dissolved),
tap-core#56 (downstream MCP-resource consumer C, blocked on this).

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
