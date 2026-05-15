/**
 * @taprun/spec — public type subset of Tap's v2 plan schema.
 *
 * This file is a STRICT PUBLIC SUBSET re-vendored from the upstream
 * `core/types.ts` in the proprietary Tap engine. Per ADR
 * `2026-05-04-ecosystem-v2-launch.md` §2.4, only the types needed to
 * CONSTRUCT or DISPLAY a Plan are exposed; engine-internal types
 * (Run, IntentRecord, Transition, TransitionKind, Fingerprint,
 * DoctorOutcome, Substrate, OpContext) are intentionally absent.
 *
 * Drift between this file and the upstream is enforced by an
 * architecture test in tap-core (`spec_public_subset_test.ts`) that
 * runs in CI before any release.
 *
 * Schema version: v2 (see ADR `2026-05-03-unified-tap-primitive.md`).
 *
 * No imports allowed in this file — it is a leaf in the import graph.
 */

// ═══════════════════════════════════════════════════════════════════════════
// L1 — Identity and primitives
// ═══════════════════════════════════════════════════════════════════════════

/** Pure identity for a tap. Two TapIds equal iff site AND name match. */
export interface TapId {
  site: string;
  name: string;
}

/** A CEL expression source string. Validated by the engine's CEL
 *  Environment at lint time; here it's a transparent string alias. */
export type CelExpr = string;

/** Generic JSON value — used for opaque substrate I/O. */
// deno-lint-ignore no-explicit-any
export type Json = any;

/** Argument schema declaration on a Plan. */
export interface ArgSpec {
  type: "string" | "int" | "number" | "boolean" | "object" | "array";
  default?: Json;
  required?: true;
  description?: string;
}

// ═══════════════════════════════════════════════════════════════════════════
// L2 — Op closure (11 ops, closed union)
// ═══════════════════════════════════════════════════════════════════════════

/** Substrate ops (7) — cross runtime RPC boundary. */

export interface FetchOp {
  op: "fetch";
  url: string;
  method?: "GET" | "POST" | "PUT" | "DELETE" | "PATCH";
  headers?: Record<string, string>;
  body?: Json;
  format?: "json" | "text" | "arrayBuffer";
  /** Credential source. Same-origin only when "page-session". */
  credentials?: "deno-host" | "page-session";
  save?: string;
}

/** Per ADR `2026-05-14-op-nav-attach.md` — closed 3-arm match mode for
 *  the `op:nav.attach` directive. Growth requires ADR amendment + arch
 *  test NA1 fail. PUBLIC mirror of core/types.ts:NAV_ATTACH_MATCH_MODES. */
export const NAV_ATTACH_MATCH_MODES = [
  "url-prefix",
  "origin",
  "exact",
] as const;
export type NavAttachMatchMode = typeof NAV_ATTACH_MATCH_MODES[number];

/** Tab-attach directive on `op:nav`. PUBLIC mirror of NavAttach.
 *  - `true` shorthand → `{ match: "url-prefix" }` (the dominant case)
 *  - explicit object → caller-chosen match mode
 *  Semantics: when set, peer queries Chrome tabs under the match mode;
 *  on match, binds sessionId → existing tabId (preserving sessionStorage
 *  for same-origin navigations) before running the standard nav path. */
export type NavAttach =
  | true
  | { match: NavAttachMatchMode };

export interface NavOp {
  op: "nav";
  url: string;
  /** Optional attach directive. Absent = always-create (today's default).
   *  Present = find-or-create. See ADR `2026-05-14-op-nav-attach.md`. */
  attach?: NavAttach;
  save?: string;
}

export interface WaitOp {
  op: "wait";
  ms?: number;
  selector?: string;
  timeout_ms?: number;
  save?: string;
}

export interface InputOp {
  op: "input";
  kind: "click" | "type" | "fill" | "press" | "upload";
  target?: string;
  value?: string;
  save?: string;
}

export interface ExtractSpec {
  attr?: string;
  text?: string;
  innerText?: string;
  html?: string;
  exists?: string;
  selector?: string;
}

export interface ExtractOp {
  op: "extract";
  root: string;
  per_item: Record<string, ExtractSpec>;
  save?: string;
}

export interface CookiesOp {
  op: "cookies";
  domain?: string;
  name?: string;
  save?: string;
}

export interface TapOp {
  op: "tap";
  site: string;
  name: string;
  args?: Record<string, Json>;
  save?: string;
}

/** Control flow (3). */

export interface IfOp {
  op: "if";
  cond: CelExpr;
  then: Op[];
  else?: Op[];
  save?: string;
}

export interface ForeachOp {
  op: "foreach";
  over?: CelExpr;
  count?: number;
  body: Op[];
  until?: CelExpr;
  save?: string;
}

export interface ParallelOp {
  op: "parallel";
  branches: Op[][];
  save?: string;
}

/** Escape (1) — value-only; lint forbids side effects in `fn`.
 *  `returns.type` is MANDATORY (runtime schema-validates output). */
export interface EvalOp {
  op: "eval";
  fn: string;
  returns: { type: "string" | "number" | "boolean" | "object" | "array" };
  args?: Json[];
  save?: string;
}

/** The closed Op union — exactly 11 members. */
export type Op =
  | FetchOp | NavOp | WaitOp | InputOp | ExtractOp | CookiesOp | TapOp
  | IfOp | ForeachOp | ParallelOp
  | EvalOp;

/** Runtime constant for the 11-op closure. */
export const OP_NAMES_V2 = [
  "fetch", "nav", "wait", "input", "extract", "cookies", "tap",
  "if", "foreach", "parallel",
  "eval",
] as const;

export type OpName = typeof OP_NAMES_V2[number];

// ═══════════════════════════════════════════════════════════════════════════
// L3 — Plan
// ═══════════════════════════════════════════════════════════════════════════

// ─── Plan lifecycle (per ADR 2026-05-10-plan-lifecycle-scoped-tabs) ─────
//
// Closed union: a plan declares its tab lifetime intent. Mirror of
// `PLAN_LIFECYCLES` / `PlanLifecycle` / `resolveLifecycle` in
// core/types.ts. Growing past 2 values requires ADR amendment + arch
// test PL1 update on the engine side.

/** Tab lifetime policy values. */
export const PLAN_LIFECYCLES = ["scoped", "interactive"] as const;
export type PlanLifecycle = typeof PLAN_LIFECYCLES[number];

/** Resolution helper: explicit field wins; absent defaults to "scoped"
 *  (RAII-safe default per the ADR's Decision Standard 1). */
export function resolveLifecycle(plan: { lifecycle?: PlanLifecycle }): PlanLifecycle {
  return plan.lifecycle ?? "scoped";
}

/** Common Plan fields (shared by read and write variants). */
interface PlanCommon {
  id: TapId;
  description?: string;
  args?: Record<string, ArgSpec>;
  /** CEL constraints over args. Each must return bool. */
  arg_constraints?: CelExpr[];
  requires?: { runtime?: "extension" | "playwright" };
  /** Pure read of current state. */
  observe?: Op[];
  /** What the tap returns. CEL over $args + phase outputs. */
  return: CelExpr;
  /** Substrate equivalence predicate for doctor. */
  fingerprint_equivalent?: CelExpr;
  /** Optional MCP exposure mode. */
  expose_as_mcp_tool?: boolean;
  /** Tab lifetime policy (per ADR 2026-05-10-plan-lifecycle-scoped-tabs.md).
   *  Absent ⇒ resolveLifecycle returns "scoped" (RAII-safe default). */
  lifecycle?: PlanLifecycle;
}

/** Discriminated union: act non-empty ⇒ key required at type level.
 *  `never` (not `undefined`) makes absence a hard type-level invariant. */
export type Plan =
  | (PlanCommon & {
      // Pure read variant — write fields unrepresentable
      act?: never;
      key?: never;
      precondition?: never;
      postcondition?: never;
      return_when_skipped?: never;
      dedup_ttl_seconds?: never;
      confirm?: never;
    })
  | (PlanCommon & {
      // Write variant — act + key both required
      act: Op[];
      key: CelExpr;
      confirm?: Op[];
      precondition?: CelExpr;
      postcondition?: CelExpr;
      return_when_skipped?: CelExpr;
      dedup_ttl_seconds?: number;
    });

// ═══════════════════════════════════════════════════════════════════════════
// L5 — Intent state enum (PUBLIC; full IntentRecord is INTERNAL)
// ═══════════════════════════════════════════════════════════════════════════

export const INTENT_STATES = [
  "preflight", "in_flight", "committed", "aborted", "uncertain",
] as const;
export type IntentState = typeof INTENT_STATES[number];

// ═══════════════════════════════════════════════════════════════════════════
// L7 — Doctor verdict enum (PUBLIC; full DoctorOutcome is INTERNAL)
// ═══════════════════════════════════════════════════════════════════════════

export const VERDICT_VALUES = [
  "equivalent", "drifted", "baseline-set", "unreachable",
] as const;
export type Verdict = typeof VERDICT_VALUES[number];
