/**
 * Plan — tap:ExecutionPlan types (Phase 1, Wave R).
 *
 * Why: replaces runtime JS interpretation of `.tap.js` with a declarative
 * structured plan that is the sole shipped artifact. See
 * docs/adr/2026-04-plan-only.md (landing in Phase 3).
 *
 * Rules:
 *   - Zero runtime dependencies.
 *   - Types only (no behavior).
 *   - Op union is closed — adding a new op requires editing this file.
 *   - Op surface derived from real tap corpus (313 taps, 11 distinct
 *     handle.* methods) — see test/fixtures/baseline-2026-04-19/summary.json.
 */

import type { Target } from "./annotation.ts";

// ---------------------------------------------------------------------------
// Expression strings (JSONata) — opaque to the type system; validated at
// plan-load time by the JSONata parser.
// ---------------------------------------------------------------------------

/** A JSONata expression string. Evaluated against the current plan scope. */
export type JsonataExpr = string;

/** Tap intent — `read` runs under doctor automatically, `write` is skipped
 *  unless `--all` because it has side effects. Listed in CLAUDE.md
 *  Classification Axes (Gating). 5 inline duplicates collapsed
 *  2026-04-27 (Slice B.2). */
export type Intent = "read" | "write";

/** Either a literal value or a `{{expr}}` template string. */
export type Templated<T> = T | string;

// ---------------------------------------------------------------------------
// Ops — discriminated union on `op`
// ---------------------------------------------------------------------------

export interface BaseOp {
  /** Bind the result of this op to a named local under `locals.<save>`. */
  save?: string;
}

// --- Interface ops (RPC to runtime) ---------------------------------------

export interface FetchOp extends BaseOp {
  op: "fetch";
  url: Templated<string>;
  method?: "GET" | "POST" | "PUT" | "DELETE" | "PATCH";
  headers?: Record<string, Templated<string>>;
  body?: unknown;
  format?: "json" | "text" | "arrayBuffer";
  /** Credential source. Default `deno-host` preserves the existing
   *  behaviour (request goes through the Deno fetch — no browser
   *  cookies). Set `page-session` to dispatch via the runtime's
   *  active browser session — the runtime resolves cookies for the
   *  URL's origin from the browser profile and attaches them as
   *  `Cookie:` headers. Same-origin only; lint rejects cross-origin
   *  uses. See ADR docs/adr/2026-05-01-op-fetch-page-session.md (S1). */
  credentials?: "deno-host" | "page-session";
}

export interface NavOp extends BaseOp {
  op: "nav";
  url: Templated<string>;
}

/** Pause execution. Two shapes:
 *   - Time-based: `{ op: "wait", ms: 1000 }` — sleep N milliseconds.
 *   - DOM-based:  `{ op: "wait", selector: ".result", timeout_ms: 5000 }` —
 *     resolve when selector appears (or timeout). Was the separate `waitFor`
 *     op until 2026-04-22 — collapsed into one op because the split was a
 *     siblings-instead-of-generalization smell. See plan-op governance in
 *     CLAUDE.md. Migration: legacy `{op:"waitFor",selector,timeout_ms}` →
 *     `{op:"wait",selector,timeout_ms}` (handled in migrate.ts). */
export interface WaitOp extends BaseOp {
  op: "wait";
  ms?: Templated<number>;
  selector?: string;
  timeout_ms?: number;
}

export interface InputOp extends BaseOp {
  op: "input";
  kind: "click" | "type" | "fill" | "press" | "upload";
  target?: string;
  value?: Templated<string>;
}

export interface ExtractOp extends BaseOp {
  op: "extract";
  /** CSS selector scoping each item. */
  root: string;
  /** Per-item field extraction. Value is one of: { attr, text, innerText, html }. */
  per_item: Record<string, ExtractSpec>;
}

export type ExtractSpec =
  | { attr: string; selector?: string }
  | { text: string } /** CSS selector; omit for self */
  | { innerText: string }
  | { html: string }
  | { exists: string };

export interface EvalOp extends BaseOp {
  op: "eval";
  /** Function source. Executed in runtime's page context (browser-native sandbox). */
  fn: string;
  args?: unknown[];
  requires_page_context?: true;
}

/**
 * Executes a JavaScript function in the DENO host context with the full
 * PlanHandle (or the bridged legacy `Tap`) in scope — **not** in the
 * browser page context that `eval` uses.
 *
 * Emitted by `migrate()` as the whole-body wrapper for taps whose logic
 * hasn't been structurally migrated yet. The runtime dispatch lives in
 * plan-dispatch.ts (via `handle.doExec`) so `new Function` stays out of
 * plan-runtime.ts and the INV-P3 static checks remain clean.
 *
 * Signature: the fn source is `async function(handle, args) { ... }`.
 * Binds `handle` = the active PlanHandle (legacy Tap methods available),
 * `args` = plan-scope args object.
 */
export interface ExecOp extends BaseOp {
  op: "exec";
  fn: string;
}

export interface ParseXmlOp extends BaseOp {
  op: "parseXML";
  /** JSONata ref to the XML string to parse. */
  source: JsonataExpr;
  itemTags: string[];
  fields: Record<string, string | { tag: string | string[]; attr?: string }>;
}

export interface CookiesOp extends BaseOp {
  op: "cookies";
  domain?: string;
  name?: string;
}

export interface ScreenshotOp extends BaseOp {
  op: "screenshot";
  target?: string;
}

export interface ScrollOp extends BaseOp {
  op: "scroll";
  /** Selector of element to scroll, or omit to scroll document. */
  target?: string;
  /** "bottom" | "top" | a pixel Y value. */
  to?: Templated<string | number>;
}

// --- Data ops (pure, JSONata-evaluated) -----------------------------------
//
// Note: a `scroll_until` op shipped briefly in #37 (lazy-feed pagination
// primitive). Removed 2026-04-22 — failed the necessity bar from #38:
// the use case decomposes into `foreach { scroll, wait, eval-count }`
// with the `until` predicate added to ForeachOp in this same change, and
// the op shipped with zero callers. Perf justification (1 RPC vs N×4) is
// real but speculative; revisit when a real lazy-feed scraper proves the
// latency matters.

export interface ComputeOp extends BaseOp {
  op: "compute";
  expr: JsonataExpr;
}

/**
 * Structural filter (delegates to PIPE_BUILTINS.filter) OR JSONata predicate.
 * Discriminated at runtime by presence of `expr`.
 */
export type FilterOp = BaseOp & { op: "filter"; on?: JsonataExpr } & (
  | { expr: JsonataExpr }
  | { field: string; gt?: Templated<number>; lt?: Templated<number>; eq?: Templated<unknown>; contains?: Templated<string> }
);

/** Shape map: each output field = a JSONata expression evaluated in row scope. */
export interface ProjectOp extends BaseOp {
  op: "project";
  shape: Record<string, JsonataExpr>;
  on?: JsonataExpr;
}

/** Sort by field or JSONata key. */
export type SortOp = BaseOp & { op: "sort"; order?: "asc" | "desc"; on?: JsonataExpr } & (
  | { by: JsonataExpr }
  | { field: string }
);

/** Dedupe by field or JSONata key. */
export type DedupeOp = BaseOp & { op: "dedupe"; on?: JsonataExpr } & (
  | { key: JsonataExpr }
  | { field: string }
);

export interface PickOp extends BaseOp {
  op: "pick";
  fields: string[] | string;
  on?: JsonataExpr;
}

export interface LimitOp extends BaseOp {
  op: "limit";
  n: Templated<number>;
  offset?: Templated<number>;
  on?: JsonataExpr;
}

export interface ConcatOp extends BaseOp {
  op: "concat";
  sources: JsonataExpr[];
}

// --- Control flow --------------------------------------------------------

export interface PipeOp extends BaseOp {
  op: "pipe";
  steps: Op[];
}

export interface IfOp extends BaseOp {
  op: "if";
  cond: JsonataExpr;
  then: Op[];
  else?: Op[];
}

export interface ForeachOp extends BaseOp {
  op: "foreach";
  /** Iterate over an array OR a count. */
  over?: JsonataExpr;
  count?: Templated<number>;
  as?: string; // scope variable name; default "item"
  body: Op[];
  /** Optional break predicate evaluated AFTER each iteration. The expression
   *  has access to all scope bindings, with `last` (or `rows`) referring to
   *  the iteration's last value. When the predicate evaluates truthy, the
   *  loop exits early. Useful for lazy-load pagination — e.g.
   *  `until: "$count(last) >= 50"` in a scroll loop, or `until: "last = null"`
   *  for "fetch pages until empty." */
  until?: JsonataExpr;
}

export interface ParallelOp extends BaseOp {
  op: "parallel";
  branches: Op[][];
  /** Disallow side effects in branches unless explicitly opted in. */
  allow_effect?: true;
}

// --- Composition ---------------------------------------------------------

export interface TapOp extends BaseOp {
  op: "tap";
  site: string;
  name: string;
  args?: Record<string, Templated<unknown>>;
}

// --- The closed union ----------------------------------------------------

export type Op =
  | FetchOp | NavOp | WaitOp | InputOp | ExtractOp | EvalOp | ExecOp
  | ParseXmlOp | CookiesOp | ScreenshotOp | ScrollOp
  | ComputeOp | FilterOp | ProjectOp | SortOp | DedupeOp | PickOp | LimitOp | ConcatOp
  | PipeOp | IfOp | ForeachOp | ParallelOp
  | TapOp;

export const OP_NAMES = [
  "fetch", "nav", "wait", "input", "extract", "eval", "exec",
  "parseXML", "cookies", "screenshot", "scroll",
  "compute", "filter", "project", "sort", "dedupe", "pick", "limit", "concat",
  "pipe", "if", "foreach", "parallel",
  "tap",
] as const;
export type OpName = typeof OP_NAMES[number];

// ---------------------------------------------------------------------------
// ExecutionPlan body — embedded in a W3C Annotation's `body` field.
// ---------------------------------------------------------------------------

export interface ArgSpec {
  type: "string" | "int" | "number" | "boolean" | "object" | "array";
  default?: unknown;
  required?: true;
  description?: string;
}

export interface HealthContract {
  min_rows?: number;
  non_empty?: string[];
}

/** Per-field comparator used by the V verifier.
 *  Shape-compatible with verify.ts's FieldComparator. Declared here so plan.ts
 *  remains the single source of truth for declarative .tap.json schema. */
export type FieldComparator =
  | { type: "exact" }
  | { type: "tolerance"; delta: number }
  | { type: "normalize-ws" }
  | { type: "set-eq"; split?: string }
  | { type: "skip" };

/** Shared fields across AuthoritativeSpec variants. */
interface AuthoritativeSpecCommon {
  headers?: Record<string, string>;
  /** For each auth row, extract target fields by dotted path. */
  row_mapping: Record<string, string>;
  match_key: string;
  comparators: Record<string, FieldComparator>;
  critical_fields?: string[];
}

/** Single-step JSON fetch. Suitable when the authoritative endpoint returns
 *  rows with all needed fields in one response. */
export interface AuthoritativeFetchJson extends AuthoritativeSpecCommon {
  source: "fetch-json";
  /** URL template; `{arg}` placeholders are substituted from tap args. */
  url: string;
  /** Dotted path into the JSON body to the rows array. Empty string = body is already an array. */
  rows_path?: string;
}

/** Two-step fetch: first get a list (of IDs or objects), then fetch detail
 *  for each via a templated URL. Closes id-only V blind spots on sites like
 *  HN where the top-level endpoint returns bare IDs and value-level fields
 *  live under /item/<id>. */
export interface AuthoritativeFetchJsonTwoStep extends AuthoritativeSpecCommon {
  source: "fetch-json-2step";
  /** URL template for the list fetch; returns either bare IDs or rows. */
  list_url: string;
  /** True when the list response is a bare array of IDs (e.g. HN topstories). */
  list_is_ids?: boolean;
  /** When list_is_ids is false, dotted path to the ID within each list row.
   *  Defaults to the common match_key. */
  list_id_path?: string;
  /** Per-item detail URL template. `{id}` is substituted from the list. */
  detail_url_template: string;
  /** Maximum items to fetch details for (HN topstories has 500+). */
  limit?: number;
}

/** Atom / RSS feed fetch. Each <entry> becomes a normalized row with
 *  the fixed keys {id, title, link, author, published, updated}; `row_mapping`
 *  values MUST refer to these. HTML entities are decoded (&amp; → &, etc).
 *  Needed for Reddit (whose .json is OAuth-gated but RSS serves unauth). */
export interface AuthoritativeFetchAtom extends AuthoritativeSpecCommon {
  source: "fetch-atom";
  url: string;
}

/** Declarative authoritative-source contract. When a tap embeds this in its
 *  plan, doctor runs V (src/verify.ts) against the output instead of the
 *  weak shape-only health check. Taps without `authoritative` are reported
 *  as `verdict: unverified` — no silent pass. */
export type AuthoritativeSpec =
  | AuthoritativeFetchJson
  | AuthoritativeFetchJsonTwoStep
  | AuthoritativeFetchAtom;

/**
 * ExecutionPlan — body of a `.tap.json` annotation envelope.
 *
 * Field categorization (Slice 0 of spec-as-artifact, ADR
 * `docs/adr/2026-05-01-spec-as-artifact.md`):
 *
 *   SPEC fields    — authoritative, user-authored source-of-truth.
 *                    Stable across site drift; forge reads these as input.
 *                    `site`, `name`, `intent`, `description`,
 *                    `args`, `examples`, `health`, `authoritative`.
 *
 *   DERIVED fields — compilation output produced by forge from the spec
 *                    plus observed site state. Regenerable; heal/refresh
 *                    rewrites these when V detects drift.
 *                    `ops`, `locals`, `return`, `columns`.
 *
 *   META fields    — flags / drainage markers / runtime concerns.
 *                    `allowUnverifiable`, `legacy`, `session`.
 *
 * This categorization is documentation only in Slice 0. Runtime behavior
 * is unchanged; the labels exist to give future slices a stable target
 * (e.g. forge.refresh regenerates only DERIVED fields from SPEC fields).
 */
export interface ExecutionPlan {
  type: "tap:ExecutionPlan";
  /** SPEC — site identifier (origin scope for the plan). */
  site: string;
  /** SPEC — tap name within the site. */
  name: string;
  /** SPEC — side-effect contract; gates doctor auto-run + refresh safety. */
  intent: Intent;
  /** SPEC — user-authored semantics; surfaced in `tap list`. */
  description?: string;
  /** DERIVED — output schema; forge can infer from the first run.
   *  Strict contract callers should attach `health.required_fields`. */
  columns?: string[];
  /** SPEC — input surface declared by the author. */
  args?: Record<string, ArgSpec>;
  /** SPEC — example invocations used by doctor to pick exemplar args
   *  and by forge/heal/refresh to smoke-run the tap with realistic input. */
  examples?: Array<Record<string, unknown>>;
  /** SPEC — invariants the output must satisfy (min_rows, required_fields). */
  health?: HealthContract;
  /** SPEC — declarative cross-validation source. When present, `tap doctor`
   *  runs V (src/verify.ts) against the output instead of relying on shape
   *  checks. Taps without this field are reported as `verdict: unverified`. */
  authoritative?: AuthoritativeSpec;
  /** DERIVED — plan-scope variables computed before ops run or during ops
   *  via `save`. Forge regenerates these alongside `ops`. */
  locals?: Record<string, JsonataExpr>;
  /** DERIVED — the compiled op pipeline. Heal/refresh's primary regeneration
   *  target when V detects drift. */
  ops: Op[];
  /** DERIVED — JSONata expression returning the tap's output rows; default = last save. */
  return?: JsonataExpr;
  /** Opt-in flag for plans that contain unverifiable ops (eval/exec).
   *  By default doctor cannot verify arbitrary JS against world changes;
   *  setting this to true makes the trade-off explicit and auditable.
   *  See plan-lint.ts verifiability contract. */
  allowUnverifiable?: boolean;
  /** Grandfather marker for the pre-2026-05-01 single-`exec` corpus.
   *  Set by `wrapDeclaredSourceAsAnnotation` (legacy code-only path) and by
   *  the corpus migration script. T2 will tighten plan-lint to require this
   *  marker on any single-exec plan; new compileFromX paths must emit
   *  composable pipes and never set `legacy`. See plan:
   *  docs/composability-drainage-2026-05-01.md. */
  legacy?: true;
  /** Session management for multi-step browser workflows.
   *   - "auto": Create session on first browser op, reuse for all ops, destroy after completion
   *   - string: Use explicit session ID (advanced use case)
   *   - undefined: Each op manages its own session (default, backward compatible)
   * 
   * Why: Multi-step workflows (nav → click → star) need state persistence.
   * Audit: 2026-Q4 (session management review)
   */
  session?: "auto" | string;
}

// ---------------------------------------------------------------------------
// Tap — the full W3C-Annotation envelope containing an ExecutionPlan body.
// ---------------------------------------------------------------------------

export interface TapAnnotation {
  "@context": [string, string] | string[];
  id?: string;
  type: "Annotation";
  motivation: "tap:executing" | string;
  target: Target;
  body: ExecutionPlan;
  generator?: {
    id?: string;
    type?: "SoftwareAgent";
    version?: string;
  };
  created?: string;
  "prov:wasDerivedFrom"?: string | string[];
}
