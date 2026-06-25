---
title: "Tap Plan Format v1 — Reference"
description: "On-disk format for Tap v2 .plan.json. Bare-JSON plan body, 13-op closed union, Plan as discriminated read/write union, expression language, verification surface. The reference for integrators building governance layers, alternative runtimes, MCP hosts, and static analyzers against compiled Tap programs."
permalink: /spec/plan-v1/
---

# Tap Plan Format v1 — Reference

> **Status (2026-05-17)**: v2 launch shipped on 2026-05-03 (upstream
> ADR `2026-05-03-unified-tap-primitive.md`). This document is the
> public reference for the post-v2 on-disk format. The schema URL
> stays `taprun.dev/spec/plan-v1/...` for integrator stability —
> "v1" denotes the public protocol generation; the internal v0.x →
> v2 migration is a one-time engine collapse that closed the
> W3C-Annotation envelope and narrowed the op union.

## 0. Relationship to the existing tap-v1 namespace

`taprun.dev/ns/tap-v1/` already exists (issued 2026-04-15, modified
2026-04-23, CC0 1.0) as the **JSON-LD vocabulary** for `tap:*` CURIEs.
That vocabulary defines tap-related terms (`tap:executing`,
`tap:site`, `tap:name`, etc.) as RDF terms so external annotation
stores / JSON-LD validators can refer to tap concepts in their own
documents without coining new IRIs.

This document is a **different artifact**: a reference for the
on-disk plan format itself — body shape, op union,
read/write classification, auth-layer composition.

| Doc | Audience | URL |
|---|---|---|
| Vocabulary | JSON-LD validators, annotation stores citing tap terms | `taprun.dev/ns/tap-v1/` |
| Plan format reference (this doc) | Integrators building governance / runtime / static-analyzers against `.plan.json` | `taprun.dev/spec/plan-v1/` |
| JSON Schema | Machine validators (VS Code `$schema`, ajv-equivalent libs) | `taprun.dev/spec/plan-v1/schema.json` |

The vocabulary doc remains canonical for term IRIs; this doc remains
canonical for plan body + op shapes + verification rules.

**Versioning commitment**:
- v1 = stable on-disk format. Field removal or semantic change
  requires a major version bump on the schema doc URL.
- Field addition is allowed in v1.x with default-`undefined` behavior
  preserving older plans.
- Op union (`OP_NAMES_V2`) additions require an upstream ADR + minor
  version bump on this doc; removals require a major bump.
- Internal forge / verify / dispatch implementation is NOT versioned
  by this doc — only the file format.

**Audience**: integrators building governance layers (e.g., APS),
MCP hosts with plan-aware permission scoping, alternative runtimes,
or static analyzers.

---

## 1. Plan body

A Tap plan is **bare JSON**, not a W3C Annotation envelope. v0.x
required `@context` / `type: "Annotation"` / `motivation: "tap:executing"`
/ `body: { type: "tap:ExecutionPlan", ... }`; v2 dissolved the
wrapper. The plan file IS the plan body.

```jsonc
{
  "$schema": "https://taprun.dev/spec/plan-v1/schema.json",
  "id": { "site": "github", "name": "trending" },
  "description": "List trending repos with stars",
  "args": {
    "since": {
      "type": "string", "default": "daily",
      "description": "daily | weekly | monthly"
    }
  },
  "requires": { "runtime": "extension" },
  "observe": [
    {
      "op": "fetch",
      "url": "https://github.com/trending?since={{$args.since}}",
      "credentials": "page-session",
      "format": "text"
    }
  ],
  "return": "$observe",
  "source_url": "https://github.com/trending",
  "source_intent": "list trending repos with stars"
}
```

**Hard rules**:
- `id.site` and `id.name` MUST both be present (non-empty strings)
  and form the unique tap identity.
- `return` MUST be present (CEL or JSONata expression source).
- `observe` may be present on either variant.
- Plans are a discriminated union: a plan with no `act` is a **read
  variant**; a plan with `act` MUST also declare `key`. See §2.
- `$schema` is optional but recommended — IDE / validator tooling
  picks up the schema URL from this field.

## 2. Plan discriminated union (read vs write)

The plan body is one of two type-level variants, discriminated by
the presence of `act`:

### Read variant

```ts
{
  $schema?: string;
  id: TapId;
  description?: string;
  args?: Record<string, ArgSpec>;
  arg_constraints?: CelExpr[];
  requires?: { runtime?: "extension" | "playwright" };
  lifecycle?: "scoped" | "interactive";
  observe?: Op[];     // pure read of current state
  return: CelExpr;    // what the tap returns
  expects?: CelExpr;
  source_url?: string;
  source_intent?: string;
  // act, key, confirm, precondition, postcondition,
  // return_when_skipped, dedup_ttl_seconds — FORBIDDEN
}
```

### Write variant

```ts
{
  ...all read variant fields,
  act: Op[];                // REQUIRED, ≥1 op
  key: CelExpr;             // REQUIRED, drives intent_key
  confirm?: Op[];
  precondition?: CelExpr;
  postcondition?: CelExpr;
  return_when_skipped?: CelExpr;
  dedup_ttl_seconds?: number;
}
```

**Why this matters for external verifiers**: read vs write is
unrepresentable-when-wrong at the type level (in upstream TS,
absent fields are typed `never`, not `undefined` — `{ act: [...] }`
without `key` fails compilation). External verifiers can derive the
classification by the same predicate the engine uses: `'act' in plan
? "write" : "read"`. There is no envelope-level `intent` field in v2.

`key` declares the intent identity for at-most-once semantics (P1
in the upstream ADR). Agents retrying the same write must produce the
same `key`; the engine dedupes by it.

## 3. Op closed union

11 ops total. The full union is exported as `OP_NAMES_V2` from
`@taprun/spec` and mirrored in this document. Adding an op requires a
spec amendment, an upstream `OP_NAMES_V2.length === 11` arch test
failure, and a minor version bump here.

### 3.1 Op categories

| Category | Ops | Purpose |
|---|---|---|
| **Substrate (RPC to runtime)** | `fetch`, `nav`, `wait`, `input`, `extract`, `cookies`, `tap` | Cross the runtime boundary (browser, Deno host) |
| **Control flow** | `if`, `foreach`, `parallel` | Compose other ops |
| **Escape** | `eval` | Page-context JS; requires `returns.type` declaration |

The closed list:

```ts
export const OP_NAMES_V2 = [
  "fetch", "nav", "wait", "input", "extract", "cookies", "tap",
  "if", "foreach", "parallel",
  "eval",
] as const;
```

### 3.2 Read/write classification

For external verifiers (governance layers, static analyzers). The
discrimination today is structural — *which array contains the op*.
Plans contain ops in either `observe` (read phase) or `act`/`confirm`
(write phase); the phase determines the security boundary, not the
op identity.

| Phase array | Read/Write | Notes |
|---|---|---|
| `observe[*]` | **read** | Pure read of substrate state |
| `act[*]` | **write** | World-mutating sequence; runtime enforces P1 via `key` |
| `confirm[*]` | **read** | Post-act verification; should not mutate |
| `precondition` / `postcondition` / `expects` (CEL exprs) | **read** | Evaluation, no I/O |

Note: the same op (e.g., `fetch`) can appear in any phase. Read/write
discrimination is by **phase**, not by op identity. This is a
deliberate change from v0.x's per-op method-sniffing
(`fetch + method:POST = write`); v2 makes the boundary structural —
verifiers reading the plan know what they will see by looking at
which array the ops live in.

### 3.3 Op shape stability

Each op shape (`FetchOp`, `NavOp`, etc.) is a TypeScript interface
exported by `@taprun/spec`. Field additions are non-breaking. Field
removals or type changes require a major version bump on the schema
URL.

Op fields are documented inline in the JSON Schema; per-field
discussion is out of scope for this doc — see `schemas/plan-v1.schema.json`.

### 3.4 The `eval` escape hatch

`eval` is the only op that runs page-context JavaScript. It carries
a mandatory `returns.type` declaration, and the runtime
schema-validates the output value's type before binding. Lint rules
in the upstream engine forbid side-effect patterns inside `fn`
(network calls, DOM writes); the rule list is documented in the
upstream lint rule registry. Use `eval` only when no fetch / extract
combination can produce the same value.

## 4. Expression language

v2 supports two embedded expression languages — **CEL** (preferred)
and **JSONata** (legacy) — routed per-expression by a syntactic
discriminator (`$<id>` token outside string literals ⇒ JSONata; CEL
macros like `has` / `size` / `string` / `int` / `matches` ⇒ CEL;
ambiguous ⇒ JSONata for back-compat). Per upstream ADR
`2026-05-14-jsonata-cel-coexistence-drift-triggered-migration.md`.

**Expression sites** (the `CelExpr` type alias in the schema covers
both languages):
- `return`
- `expects`, `precondition`, `postcondition`, `key`
- `arg_constraints[*]`
- `if.cond`, `foreach.over`, `foreach.until`
- `op.expect` (per-op drift predicate, optional)
- Template strings inside string fields: `"{{$args.foo}}"` shorthand

**Migration policy**: new plans emitted by forge are CEL; legacy
JSONata plans are grandfathered via an allowlist that shrinks every
time `capture` overwrites a plan. No flag day. See the upstream ADR
for the drift-triggered migration mechanics.

CEL syntax reference: <https://github.com/google/cel-spec>
JSONata syntax reference: <https://docs.jsonata.org/>

## 5. Composing with authorization layers

Plans declare structure; external layers enforce authorization. The
two are orthogonal:

- **Plan layer (Tap)**: compile-time invariant. The Plan discriminated
  union (`act` present = write) plus the closed 13-op union define
  what a tap can possibly do. Static; verifiable without execution.
- **Authorization layer (external)**: runtime invariant. Signs /
  permits / denies individual tap invocations. Receipts prove what
  was authorized.

A simple composition pattern:

```ts
import { type Plan } from "@taprun/spec";
import { tap } from "tap-mcp-client";
import { governAction } from "some-auth-layer";

const intent: "read" | "write" = "act" in plan ? "write" : "read";

const result = await governAction(
  { type: intent, target: plan.source_url, plan_id: plan.id },
  () => tap.run(`${plan.id.site}/${plan.id.name}`, args),
  { delegation, signer }
);
```

The auth layer reads the plan structure to decide whether the
caller's delegation covers the call. It does NOT need to parse op
arrays — the discriminated union tells it everything.

**Examples of auth layers that compose with v1 plans**:
- APS (Agent Passport System, npm `agent-passport-system`) —
  Ed25519-signed delegations + receipts
- Any MCP host with permission scoping — read-vs-write gating from
  the structural discriminant
- Custom audit middleware — log every plan invocation by
  `(site, name, read|write)`

Tap does not endorse any specific auth layer; the plan format
intentionally does not commit to one.

## 6. Verification surface

Three independent verification layers, all readable from a v1 plan
without execution:

1. **Plan lint** (`@taprun/spec` exports `LintError`, `LintRuleName`,
   `LINT_RULE_NAMES`). Static checks: closed-union conformance, CEL /
   JSONata syntax, type-level discriminated-union shape, intent_key
   non-empty for write plans, page-session cross-origin sanity, etc.
   The rule set is documented per-rule in the upstream lint module.
2. **Per-op drift assertion** (`op.expect`, optional). A predicate
   evaluated at op-execution time against `{$args, $result}`. Surfaces
   substrate drift as `tap_drifted` failure kind; the recovery path is
   re-capture. Replaces v0.x `snapshot_equivalent` per upstream ADR
   `2026-05-10-snapshot-dissolved.md`.
3. **Verify** (`@taprun/spec` exports `Verdict`, `VERDICT_VALUES`).
   Read-only substrate health check; returns one of `live` / `drifted`
   / `unreachable`. Derived from observe-phase op outcomes; no
   baseline diff. The v0.x 4-arm enum
   (`equivalent`/`drifted`/`baseline-set`/`unreachable`) was retired
   with the snapshot subsystem.

External tooling can statically read lint findings and op.expect
predicates from the JSON without running the plan.

## 7. Stability levels per field

| Field | Stability |
|---|---|
| `id.site`, `id.name`, `return`, `act`, `key`, `OP_NAMES_V2` | **Frozen** — change requires v2 schema URL bump |
| `args`, `arg_constraints`, `requires`, `lifecycle`, `observe`, `expects`, `precondition`, `postcondition`, `confirm`, `return_when_skipped`, `dedup_ttl_seconds`, `source_url`, `source_intent`, `$schema` | **Stable** — additions allowed in v1.x |
| Per-op interfaces (`FetchOp`, etc.) | **Stable** — field additions only |
| `op.expect` predicate language (CEL or JSONata) | **Frozen for v1** — co-existence routing rules in §4 |

## 8. References

- TypeScript types and JSON Schema: [`@taprun/spec`](https://www.npmjs.com/package/@taprun/spec) on npm
- Annotation namespace context: served as W3C JSON-LD at <https://taprun.dev/ns/tap-v1/>
- Upstream ADRs (proprietary engine repo, file paths citable):
  - `docs/adr/2026-05-03-unified-tap-primitive.md` — v2 source of truth
  - `docs/adr/2026-05-04-saved-taps-as-resources.md` — saved taps are MCP Resources
  - `docs/adr/2026-05-10-snapshot-dissolved.md` — snapshot subsystem dissolved
  - `docs/adr/2026-05-14-jsonata-cel-coexistence-drift-triggered-migration.md` — expression-language coexistence

## 9. What changed from v0.x

The v0.x doc (in this URL's git history before 2026-05-17) described
a W3C Annotation envelope, a 24-op union, and a per-envelope `intent`
field. v2 made the following changes:

| v0.x | v2 |
|---|---|
| W3C Annotation envelope (`@context`, `type: "Annotation"`, `motivation`, `body: { type: "tap:ExecutionPlan", ... }`) | Bare JSON; no wrapper |
| `body.intent: "read" \| "write"` envelope field | Structural: read = no `act`; write = `act` + `key` required (type-level discriminated union) |
| 24 ops (incl. `exec`, `parseXML`, `screenshot`, `scroll`, `compute`, `filter`, `project`, `sort`, `dedupe`, `pick`, `limit`, `concat`, `pipe`) | 11 ops (substrate 7 + control 3 + escape 1) |
| `allowUnverifiable` flag for `eval`/`exec` | `exec` removed; `eval` requires explicit `returns.type` declaration |
| `body.authoritative` for cross-validation | Per-op `op.expect` predicate (CEL/JSONata) |
| `body.health` minimal shape contract | Subsumed by `op.expect` predicates |
| Verdict 4-arm (`equivalent`/`drifted`/`baseline-set`/`unreachable`) | Verdict 3-arm (`live`/`drifted`/`unreachable`) — snapshot dissolved |
| JSONata only | CEL preferred; JSONata legacy with drift-triggered migration |

If you maintain an integration written against the v0.x doc and need
to upgrade, the schema-validation path is:

1. Bump `@taprun/spec` to 1.2.0 in your `package.json`
2. Re-typecheck against the new TS types (remove `fingerprint_equivalent`,
   `expose_as_mcp_tool`; switch `Verdict == "equivalent"` checks)
3. If you validated `.tap.json` files against the v0.x schema and were
   getting silent failures, those should now pass against the v2 schema

The schema URL is unchanged so external `$schema` references continue
to resolve.

---
