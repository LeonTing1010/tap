---
title: "Tap Plan Format v1 — Reference"
description: "On-disk format for Tap .tap.json plans. Envelope, op closed-union, read/write classification, verifiability rules. The reference for integrators building governance layers, alternative runtimes, and static analyzers against compiled Tap programs."
permalink: /spec/plan-v1/
---

# Tap Plan Format v1 — Reference

## 0. Relationship to the existing tap-v1 namespace

`taprun.dev/ns/tap-v1/` already exists (issued 2026-04-15, modified 2026-04-23, CC0 1.0) as the **JSON-LD vocabulary** for `tap:*` CURIEs — it defines `tap:executing`, `tap:ExecutionPlan`, `tap:site`, `tap:name`, `tap:intent`, `tap:health`, `tap:args`, etc. as RDF terms so external annotation stores / EPUB readers / JSON-LD validators can consume `.tap.json` files without a custom profile.

This document is a **different artifact**: a reference for the on-disk plan format itself — envelope structure, op union, read/write classification, auth-layer composition. Two complementary docs:

| Doc | Audience | URL |
|---|---|---|
| Vocabulary (existing) | JSON-LD validators, annotation stores | `taprun.dev/ns/tap-v1/` |
| Plan format reference (this doc) | Integrators building governance/runtime/static-analyzers against `.tap.json` | `taprun.dev/spec/plan-v1/` |

The vocabulary doc remains canonical for term IRIs; this doc remains canonical for envelope + op shapes + verifiability rules. Cross-link both ways once published.

**Versioning commitment (this doc once published)**:
- v1 = stable on-disk format. Field removal or semantic change requires major version bump.
- Field addition is allowed in v1.x with default-`undefined` behavior preserving older plans.
- Op union (`OP_NAMES`) additions require ADR + minor version bump; removals require major.
- Internal forge.ts / doctor.ts / heal pipeline implementation is NOT versioned by this doc — only the file format.

**Audience**: integrators building governance layers (e.g., APS), MCP hosts with plan-aware permission scoping, alternative runtimes, or static analyzers.

---

## 1. Envelope

A Tap plan is a W3C Web Annotation envelope wrapping an `ExecutionPlan` body.

```jsonc
{
  "@context": [
    "http://www.w3.org/ns/anno.jsonld",
    "https://taprun.dev/ns/tap-v1/"
  ],
  "type": "Annotation",
  "motivation": "tap:executing",
  "target": { /* W3C Annotation Target — the URL/page the plan operates on */ },
  "body": {
    "type": "tap:ExecutionPlan",
    "site": "github",
    "name": "trending",
    "intent": "read",
    "ops": [ /* closed-union ops */ ],
    "...": "..."
  },
  "generator": { "type": "SoftwareAgent", "id": "tap", "version": "0.x" },
  "created": "2026-04-26T...",
  "prov:wasDerivedFrom": "https://github.com/trending"
}
```

**Hard rules**:
- `body.type` MUST be `"tap:ExecutionPlan"` (literal string).
- `body.site` and `body.name` MUST be present and form the unique tap identity.
- `body.intent` MUST be `"read"` or `"write"` (no other values).
- `body.ops` MUST be a non-empty array of ops from the closed union below.
- The `@context` MUST include the W3C anno context AND the tap-v1 namespace.

## 2. ExecutionPlan body

```ts
interface ExecutionPlan {
  type: "tap:ExecutionPlan";
  site: string;
  name: string;
  intent: "read" | "write";
  description?: string;
  columns?: string[];
  args?: Record<string, ArgSpec>;
  examples?: Array<Record<string, unknown>>;
  health?: HealthContract;
  authoritative?: AuthoritativeSpec;
  locals?: Record<string, JsonataExpr>;
  ops: Op[];
  return?: JsonataExpr;
  allowUnverifiable?: boolean;
}
```

### `intent`

The single most-load-bearing field for external verifiers. Declares the plan's effect on the world:

- `"read"` — plan SHOULD NOT mutate world state. Containing any write op (see §3.2) without `allowUnverifiable: true` is a contract violation.
- `"write"` — plan acknowledges side effects. Permitted to contain any op.

External governance layers (auth, permission scoping, audit) gate plans by inspecting `body.intent` without parsing op semantics. This is the field's reason for existing on the envelope rather than being implied by op names.

**Auto-inference** (forge default): if `intent` is omitted, forge classifies as `"write"` if any op in `body.ops` is in §3.2 read/write classification's write set, else `"read"`. Explicit declaration always wins.

### `authoritative`

Declarative cross-validation source. When present, `tap doctor` runs the V verifier (cross-checks tap output against an authoritative endpoint) instead of relying on `health` shape checks alone. Three variants:

- `fetch-json` — single-step JSON fetch
- `fetch-json-2step` — list-then-detail (e.g., HN topstories → /item/<id>)
- `fetch-atom` — Atom/RSS feed (e.g., Reddit)

Plans without `authoritative` report `verdict: unverified` from doctor — no silent pass.

### `allowUnverifiable`

Opt-in flag for plans containing `eval` or `exec` ops (which V cannot statically verify). Default `false`. Setting `true` makes the trade-off explicit and auditable.

## 3. Op closed union

24 ops total. The full union is exported as `OP_NAMES` from `@taprun/spec` and mirrored in this document. Adding an op requires a spec amendment, a `PLAN_OP_CEILING` constraint bump in the upstream reference implementation, and a minor version bump here.

### 3.1 Op categories

| Category | Ops | Purpose |
|---|---|---|
| **Interface (RPC to runtime)** | `fetch`, `nav`, `wait`, `input`, `extract`, `eval`, `exec`, `parseXML`, `cookies`, `screenshot`, `scroll` | Cross the runtime boundary (browser, Deno host) |
| **Data (pure)** | `compute`, `filter`, `project`, `sort`, `dedupe`, `pick`, `limit`, `concat` | JSONata-evaluated; no I/O |
| **Control flow** | `pipe`, `if`, `foreach`, `parallel` | Compose other ops; intent inherited from children |
| **Composition** | `tap` | Invoke another tap by site/name |

### 3.2 Read/write classification

For external verifiers (governance layers, V, static analyzers). When an op's classification depends on its arguments, the rule is given:

| Op | Read/Write | Notes |
|---|---|---|
| `fetch` | **read** if `method` ∈ {`GET`, omitted}; **write** if `method` ∈ {`POST`, `PUT`, `DELETE`, `PATCH`} | Verifier MUST check `method` |
| `nav` | **read** | Browser-state change only; no world mutation |
| `wait` | **read** | Pure pause |
| `input` | **write** | Always (`click`/`type`/`fill`/`press`/`upload` all mutate page DOM and may trigger requests) |
| `extract` | **read** | DOM query |
| `eval` | **unverifiable** | Page-context JS; classification requires `allowUnverifiable: true` to coexist with `intent` |
| `exec` | **unverifiable** | Deno-host JS; classification requires `allowUnverifiable: true` |
| `parseXML` | **read** | Pure parser |
| `cookies` | **read** | Read existing cookies (no setting) |
| `screenshot` | **read** | Capture only |
| `scroll` | **read** | Viewport change, no DOM mutation |
| `compute`, `filter`, `project`, `sort`, `dedupe`, `pick`, `limit`, `concat` | **read (pure)** | JSONata data ops, no I/O |
| `pipe`, `if`, `foreach`, `parallel` | **inherited** | Read/write = OR of nested ops' classifications |
| `tap` | **inherited** | Read/write = the called sub-tap's `intent` |

**Verifier rule**: a plan with `intent: "read"` and `allowUnverifiable !== true` MUST NOT contain any op classified as **write** or **unverifiable**. Forge auto-inference and plan-load validators enforce this.

### 3.3 Op shape stability

Each op shape (`FetchOp`, `NavOp`, etc.) is a TypeScript interface exported by `@taprun/spec`. Field additions are non-breaking. Field removals or type changes require major version bump.

The `OP_NAMES` constant is the canonical authoritative list:

```ts
export const OP_NAMES = [
  "fetch", "nav", "wait", "input", "extract", "eval", "exec",
  "parseXML", "cookies", "screenshot", "scroll",
  "compute", "filter", "project", "sort", "dedupe", "pick", "limit", "concat",
  "pipe", "if", "foreach", "parallel",
  "tap",
] as const;
```

## 4. Expression language

JSONata, embedded as strings.

- **Whole-string** `"{{expr}}"` — evaluates to the raw value type
- **Embedded** `"prefix-{{expr}}-suffix"` — evaluates to a concatenated string
- **Untemplated** strings are passed through as literal values

`Templated<T>` in the type system means "a `T` literal OR a JSONata template string". Resolution happens at op-execution time against the current plan scope (`locals` + `args` + saved `op.save` bindings).

JSONata syntax reference: https://docs.jsonata.org

## 5. Composing with authorization layers

Plans declare scope; external layers enforce authorization. The two are orthogonal:

- **Plan layer (Tap)**: compile-time invariant. The `body.intent` field plus the closed op union define what a tap can possibly do. Static; verifiable without execution.
- **Authorization layer (external)**: runtime invariant. Signs/permits/denies individual op invocations. Receipts prove what was authorized.

A simple composition pattern:

```ts
import { tap } from "tap-mcp-client";
import { governAction } from "some-auth-layer";

const result = await governAction(
  { type: plan.body.intent, target: plan.target, plan_id: plan.id },
  () => tap.run(plan.body.site, plan.body.name, args),
  { delegation, signer }
);
```

The auth layer reads `plan.body.intent` to decide whether the caller's delegation covers the call. It does NOT need to parse `body.ops` — that's the value of intent being on the envelope.

**Examples of auth layers that compose with v1 plans**:
- APS (Agent Passport System, npm `agent-passport-system`) — Ed25519-signed delegations + receipts
- Any MCP host with permission scoping — read-vs-write gating from `intent`
- Custom audit middleware — log every plan invocation by `(site, name, intent)`

Tap does not endorse any specific auth layer; the plan format intentionally does not commit to one.

## 6. Verification surface

Three independent verification layers, all readable from a v1 plan without execution:

1. **Plan lint** — static checks: closed-union conformance, JSONata syntax, `allowUnverifiable` discipline, intent vs op-set consistency. Implemented in the upstream Tap reference implementation; the rule set is documented per-field in this spec.
2. **Health contract** (`body.health`) — minimal post-execution shape: `min_rows`, `non_empty: string[]`. Verifies result shape, not semantics.
3. **Authoritative spec** (`body.authoritative`) — semantic cross-validation against an external source-of-truth endpoint. Closes the gap where shape passes but values are wrong.

External tooling can statically read all three from the JSON without running the plan. This is the structural reason Tap supports drift detection and `tokens-to-recover` heal pricing — static plan + declarative verifier specs = O(changed-subtree) recovery instead of O(full-rewrite).

## 7. Stability levels per field

| Field | Stability |
|---|---|
| `body.type`, `body.site`, `body.name`, `body.intent`, `body.ops`, `OP_NAMES` | **Frozen** — change requires v2 |
| `body.health`, `body.authoritative`, `body.args`, `body.examples`, `body.return`, `body.locals`, `body.allowUnverifiable` | **Stable** — additions allowed in v1.x |
| Per-op interfaces (`FetchOp`, etc.) | **Stable** — field additions only |
| `@context`, `motivation`, `target`, `generator`, `created`, `prov:wasDerivedFrom` | **Inherited from W3C Web Annotation** (frozen by upstream spec) |

## 8. References

- TypeScript types and JSON Schema: [`@taprun/spec`](https://www.npmjs.com/package/@taprun/spec) on npm
- Annotation context: served as W3C JSON-LD at <https://taprun.dev/ns/tap-v1/>
- Plan-only design rationale and verifier specification: this document is the public surface; the upstream design notes live in the proprietary engine repository

## 9. Resolved decisions for v1.0

Six questions resolved 2026-04-26. Commitments below ship with v1.0 publication.

### Q1 — `intent` field on legacy plans without it

**Decision**: plan-load defaults missing `intent` to `"write"` (conservative — write taps skip auto-doctor and require explicit `--all`), emits a deprecation warning, and adds a `tap migrate` hint. No hard-fail. Migration window: 6 months from v1.0 publication.

**Rationale**: Hard-failing on missing field would break every legacy `.tap.json` saved before v0.9 made `intent` required. Defaulting to `"write"` is safer than `"read"` because `"write"` taps require explicit invocation — a misclassification can't accidentally let a write op run under doctor's auto-heal.

### Q2 — `allowUnverifiable` enforcement

**Decision**: forge MUST refuse to save a plan containing `eval` or `exec` ops without explicit `allowUnverifiable: true`.

**Status**: Already enforced by plan-lint in the upstream reference implementation. v1.0 documents the existing behavior; no implementation work needed. The error message gives integrators two options: (1) replace with verifiable ops, or (2) explicitly opt in to unverifiability.

### Q3 — `tap` op intent inheritance

**Decision**: When the called sub-tap is loadable from `tapDirs()` at plan-load time, statically resolve and inherit its intent. When unloadable (sub-tap not present, registry-only reference, or circular), treat the call as inheriting the **caller's declared intent** — caller's `intent` is a contract about the call graph, not about ops in isolation. External governance layers can recursively resolve at runtime if they need stricter guarantees.

**Rationale**: Eager resolution gives static-analysis the strongest guarantee; fallback to caller-intent preserves the contract that "if you said `intent: "read"`, no ops in your call graph should write." A read-tap calling a write-sub-tap violates the caller's declaration and is rejected by plan-lint.

### Q4 — Unknown op forward-compatibility

**Decision**: hard-fail on unknown op names.

**Rationale**: The closed `OP_NAMES` union is Tap's central compile-time invariant — making it lenient defeats the framing in §3.1. New ops require minor version bumps with ADR; readers built for v1.x are guaranteed to know all v1.y (y≤x) ops. v2 will require explicit version detection. This trades forward-compat at the cost of stronger "what could this plan possibly do" guarantees.

### Q5 — Schema artifact format

**Decision**: generate JSON Schema from the upstream TypeScript types via `ts-json-schema-generator` as a release-time CI step. Publish at `taprun.dev/spec/plan-v1/schema.json`. Hand-edit fallback only for cases the generator misses (JSONata-string types, discriminated-union conditionals).

**Rationale**: TypeBox would require rewriting `plan.ts` in TypeBox syntax; hand-writing schemas drifts from the source of truth. Auto-generation keeps schema and source in lockstep at the cost of one CI step. Integrators get a citable schema URL; Tap maintainers don't carry a duplicate definition.

**Implementation note**: A0 reconstruction parked `adapters/openapi/` as a placeholder (CLAUDE.md project structure). The schema-emit script can land there or under `scripts/`.

### Q6 — Zenodo DOI for plan format reference

**Decision**: defer DOI on format documents to post-W3. Publish v1.0 of vocabulary + plan-format reference without DOI; retrofit later if citation surface proves valuable.

**Rationale**: Per `playbook_tool_vs_protocol_2026-04-26.md`, the higher-ROI DOI target is the W1 K(Δ) benchmark dataset (W3 deliverable in `playbook-2026-04-26.md`) — engineers cite numbers more readily than format specs. The benchmark DOI proves the workflow; format-doc DOI is opportunistic add-on.

---
