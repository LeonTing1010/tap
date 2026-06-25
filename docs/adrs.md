---
title: "ADR-driven design — every v2 decision in writing"
description: "Every load-bearing decision behind Tap v2 was written down before code shipped. This page lists the user-relevant ADRs, with one-line summaries."
permalink: /adrs/
layout: default
---

# ADR-driven design

Most projects don't expose their design records. We do. Every decision that shapes the user-facing surface — what an op is, how doctor verdicts are decided, where plugins live, how packages get versioned — was written down as an Architecture Decision Record before a line of code shipped. The records that gate the v2 release are listed here.

The ADRs themselves live alongside the engine source (which is closed) and are mirrored here in summary form. The goal is not transparency for its own sake — it is so that when you ask "why does Tap v2 work this way," the answer is one clickthrough deep, not a slack DM to a maintainer.

---

## The v2 anchor — read this first

### [Unified tap primitive](#) — `2026-05-03-unified-tap-primitive.md`

The single load-bearing ADR. Defines the v2 schema (5 storage entities — `TapId`, `Plan`, `Run`, `Intent`, `Fingerprint`), the 13-op closure, the read/write discriminated union, the 4-arm verdict enum, the 5-arm intent state machine. Source-of-truth file is `core/types.ts`. Everything else is downstream.

---

## The release coordination — what shipped together

### [Ecosystem v2 launch](#) — `2026-05-04-ecosystem-v2-launch.md`

The cross-repo coordination plan: 5 surfaces flip in one weekend (this docs site, tap-skills repo, plugins, npm packages, brew formula). Decides lockstep release over rolling. Documents the `npm deprecate` policy, the 30/90/180-day deprecation cadence, and the CI grep gate that catches stale marketing copy.

### [Plan versioning](#) — `2026-05-04-plan-versioning.md`

Why the npm packages bumped v0.x → v1.0 and not v0.5. Sequential integer schema versioning at the Plan level; semver-major at the package level. The two are deliberately separate axes.

### [Distribution model](#) — `2026-05-04-distribution-model.md`

Per-author namespace (`@taprun/<site>/<name>` curated; `@<author>/<site>/<name>` community). Trust tiering between the two. Why community plans require an explicit `--trust` flag at install. The CI checks that gate the curated subtree.

---

## The architecture follow-throughs

### [Plugin runtime model](#) — `2026-05-04-plugin-runtime-model.md`

In-process plugin loading is gone. Plugins are MCP sub-servers — `~/.tap/config/plugins/<name>/manifest.json` plus an executable speaking JSON-RPC. Locks the boundary so plugins can't accidentally import private engine code; opens the door to non-Deno plugin authors.

### [Forge AI lifecycle](#) — `2026-05-04-forge-ai-lifecycle.md`

Forge as **inspect + draft**, not "AI generates the whole plan." Deterministic templates (RSS, JSON-LD, OpenAPI, agents.json, ARIA) cover ~80% of real shapes; AI fills the long tail. Each saved plan carries `compiled_by` metadata so consumers can distinguish forge AI runs from hand-edits.

### [Error handling philosophy](#) — `2026-05-04-error-handling-philosophy.md`

The two-arm `RuntimeResult<T>` (`{ kind: "ok" } | { kind: "failed" }`) and the rule against silent capability degradation. Plans declare `requires.runtime`; lint rejects mismatches; runtime pre-flights `matchCapability` before any op fires.

### [Auth + multi-user](#) — `2026-05-04-auth-multi-user.md`

Why license is per-machine, why there is no cloud account, how multi-seat plans avoid a phantom user database. Local-first by architecture means the credential never leaves the machine.

### [Cross-machine intent coordination](#) — `2026-05-04-cross-machine-intent-coord.md`

How write taps deduplicate across machines without a central server. The `key` CEL expression + intent state machine + per-author namespace combine into a content-addressed, server-free dedup contract.

### [Followup plan](#) — `2026-05-04-followup-plan.md`

The seven §16 follow-up ADRs, sequenced by dependency. What's done, what's next, what was deliberately deferred.

---

## Earlier load-bearing records (still authoritative)

### [Spec as artifact](#) — `2026-05-01-spec-as-artifact.md`

Why `@taprun/spec` is a derived artifact of `core/types.ts`, not a separately authored package. The drift-guard test that fires CI on any divergence.

### [No silent capability degradation](#) — `2026-05-02-no-silent-capability-degradation.md`

The earliest ancestor of the v2 error-handling rule. Removed `string warnings`-as-API; replaced ephemeral fallback with explicit `kind: "failed"`. Set the precedent for v2's invariant-first approach.

### [op:fetch page-session credentials](#) — `2026-05-01-op-fetch-page-session.md`

The `credentials: "deno-host" | "page-session"` field on `op:fetch`. Page-session uses the live browser cookies — credentials never cross a trust boundary. The architectural keystone for "browser automation that runs in your browser."

### [Op-grain fingerprint](#) — `2026-05-01-op-grain-fingerprint.md`

`PlanFingerprint.op_hashes` plus the `diffPlanFingerprints` helper. The substrate for op-grain heal targeting (cache hits become possible at the op level, not just the plan level).

### [No new `legacy: true` on save](#) — `2026-05-01-no-new-legacy-on-save.md`

The drainage terminal state. `lintPlan({ isNewSave: true })` rejects plans whose body has `legacy: true`. Existing legacy taps editing-through still pass; new authoring must compose v2 ops.

---

## Not listed here

A handful of ADRs concern engine internals (heal cache layout, K(Δ) accounting, MCP tool surface budget) and are not user-relevant. They live alongside the source and follow the same naming convention; if you need one cited in a discussion, ping <hello@taprun.dev>.

---

## How to read these

ADRs follow a fixed shape: **Context** (what state the world was in) → **Decision** (what we picked) → **Application** (where in the codebase the decision lands) → **Risks + mitigations**. Most are 200–400 lines. The unified-tap-primitive parent is the longest at ~600 lines because it's the schema spec; the release-coordination ADR is similar length because it's a cross-repo plan.

If you find a contradiction between an ADR and the running code, the running code is wrong by definition — file an issue.
