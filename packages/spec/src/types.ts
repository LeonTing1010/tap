/**
 * @taprun/spec — public type subset of Tap's v2 flow schema.
 *
 * This file is a STRICT PUBLIC SUBSET re-vendored from the upstream
 * `core/types.ts` in the proprietary Tap engine. Per ADR
 * `2026-05-04-ecosystem-v2-launch.md` §2.4, only the types needed to
 * CONSTRUCT or DISPLAY a Flow are exposed; engine-internal types
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
  | {
    match: NavAttachMatchMode;
    /** `false` ⇒ when a tab MATCHED, bind WITHOUT navigating (no
     *  `tabs.update`, no reload) — preserves live page state (form
     *  drafts) in the user's tab; the author accepts acting wherever
     *  the matched tab currently is. 0 matches still falls through to
     *  create + navigate. Absent/`true` ⇒ navigate-always. */
    reload?: boolean;
  };

export interface NavOp {
  op: "nav";
  url: string;
  /** Optional attach directive. Absent = always-create (today's default).
   *  Present = find-or-create. See ADR `2026-05-14-op-nav-attach.md`. */
  attach?: NavAttach;
  save?: string;
}

/** Resolver for a tab-bound element target (ADR
 *  `2026-07-08-target-resolver.md`). Widens the historic bare-`string`
 *  selector — "first `querySelectorAll` match, hidden or not" — into an
 *  explicit predicate over the match set, so the "first match is a hidden
 *  template/duplicate" footgun is authorable rather than memory-dependent.
 *  A bare `string` is still accepted and is sugar for `{ selector, visible:
 *  true }`. Selection: deepQueryAll(selector) → filter `visible` → filter
 *  `text` → filter `inViewport` → index `nth` (0-based; negatives from the
 *  end, `-1` = last). PUBLIC mirror of core/types.ts:TargetResolver. */
export interface TargetResolver {
  /** CSS selector. The ` >>> ` piercing combinator crosses BOTH shadow-root
   *  AND iframe boundaries: `iframeSel >>> innerSel` targets an element inside
   *  an iframe (same- or cross-origin). A bare selector searches only the top
   *  document and will NOT match inside an iframe. Optional when `role` is
   *  given. At least one of `selector` / `role` is required. */
  selector?: string;
  /** ARIA role (explicit `role=` or implicit from tag) — selector-free
   *  semantic targeting that survives React class/DOM churn. A pragmatic
   *  in-page getByRole, not the full CDP AX tree. */
  role?: string;
  /** Accessible-name substring (aria-label → aria-labelledby → <label> →
   *  alt/title → textContent), trimmed + case-insensitive. Pairs with `role`. */
  name?: string;
  /** Keep only rendered matches. Default true for a resolver object. */
  visible?: boolean;
  /** 0-based index into the filtered set; negatives from the end (-1 = last). */
  nth?: number;
  /** Keep only matches whose `textContent` includes this substring. */
  text?: string;
  /** Keep only matches intersecting the viewport (trusted-click precondition). */
  inViewport?: boolean;
}

/** A tab-bound element target: bare selector string (sugar for
 *  `{ selector, visible: true }`) or an explicit {@link TargetResolver}.
 *  PUBLIC mirror of core/types.ts:Target. */
export type Target = string | TargetResolver;

export interface WaitOp {
  op: "wait";
  ms?: number;
  /** Element to wait for: bare selector, or a {@link TargetResolver} that
   *  waits until the *resolved* (e.g. visible) match exists. */
  selector?: Target;
  /** Wait until `location.href` includes this substring — deterministic SPA
   *  route-change wait (ADR 2026-07-08-op-capabilities). Tab-bound. */
  url?: string;
  timeout_ms?: number;
  save?: string;
}

export interface InputOp {
  op: "input";
  kind:
    | "click"
    | "type"
    | "fill"
    | "press"
    | "upload"
    | "setHtml"
    | "hover"
    | "keytype"
    | "blur";
  /** Bare selector string or a {@link TargetResolver} (ADR
   *  `2026-07-08-target-resolver.md`). PUBLIC mirror of
   *  core/types.ts:InputOp.target. */
  target?: Target;
  /** kind=type/fill → text written to `.value`; kind=setHtml → HTML assigned
   *  to `target.innerHTML` (rich-text / contenteditable editors). Receives
   *  `{{$args}}` substitution as DATA (unlike `eval.fn`), so large per-run
   *  HTML flows in as an arg without baking. PUBLIC mirror of
   *  core/types.ts:InputOp.value. */
  value?: string;
  /** Substrate-tier hint. Absent/false → L1 (JS-injection click; default;
   *  no DevTools warning bar). true → L2 (CDP trusted click at element
   *  coordinates; emits isTrusted:true events). Set by `capture` when
   *  forge detects L1 fails the `expect` predicate. PUBLIC mirror of
   *  core/types.ts:InputOp.trusted per ADR
   *  `2026-05-19-forge-tier-discovery.md` §2A. */
  trusted?: boolean;
  /** Per-op postcondition predicate. Truthy → ok; falsy → tap_drifted.
   *  PUBLIC mirror of core/types.ts:InputOp.expect per ADR
   *  `2026-05-08-failure-detection-phase-2.md` §2B (extended to InputOp
   *  by `2026-05-19-forge-tier-discovery.md`). */
  expect?: CelExpr;
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
  /** JSONata expression resolving to the source HTML string; defaults to
   *  `_phase_last` (the prior op's value, e.g. a preceding op:fetch's HTML).
   *  Engine-inline, parsed server-side; no peer involvement. */
  from?: string;
  /** `true` = extract from the LIVE page DOM via the extension peer (tab-bound):
   *  `root` runs through the shared resolver (open-shadow + same-origin-iframe
   *  piercing); per_item applies the same ExtractSpec semantics. Omitted =
   *  engine-inline over `from`/`_phase_last` HTML (ADR 2026-07-22-op-extract-live). */
  live?: boolean;
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
 *  `returns.type` is OPTIONAL — when present the runtime schema-validates the
 *  output before binding; when omitted the value is bound as-is (ADR
 *  2026-07-14-op-eval-returns-optional-infer). */
export interface EvalOp {
  op: "eval";
  fn: string;
  returns?: { type: "string" | "number" | "boolean" | "object" | "array" };
  args?: Json[];
  save?: string;
}

/** Host op (1) — browser-harness management (tabs / tab-groups). Acts on
 *  the user's own browser chrome, not a foreign substrate; tab-free,
 *  peer-routed to the extension. Per ADR 2026-06-11-op-tab-host-op.md. */
export interface TabOp {
  op: "tab";
  action: TabAction;
  /** number[] literal OR a template string resolving to number[].
   *  Required for group/ungroup/close/pin/unpin; omit for list. */
  tabIds?: (number | string)[] | string;
  title?: string;
  color?: TabGroupColor;
  save?: string;
}

/** Closed list of op:tab actions. Growth requires ADR amendment. */
export const TAB_ACTIONS = [
  "list", "group", "ungroup", "close", "pin", "unpin",
] as const;
export type TabAction = typeof TAB_ACTIONS[number];

/** Closed tab-group color set — mirrors chrome.tabGroups.Color. */
export const TAB_GROUP_COLORS = [
  "grey", "blue", "red", "yellow", "green", "pink", "purple", "cyan", "orange",
] as const;
export type TabGroupColor = typeof TAB_GROUP_COLORS[number];

/** Host op (1) — bookmark-tree management. Same tier as TabOp: acts on
 *  the user's own browser chrome (chrome.bookmarks), not a foreign
 *  substrate; tab-free, peer-routed to the extension. Per ADR
 *  2026-06-11-op-bookmark-host-op.md. */
export interface BookmarkOp {
  op: "bookmark";
  action: BookmarkAction;
  /** Target node id (move/update/remove/removeTree). */
  id?: string;
  /** Destination parent folder id (create/move). */
  parentId?: string;
  /** Position within the parent (create/move). */
  index?: number;
  /** Title (create folder/bookmark; update). */
  title?: string;
  /** URL (create/update a bookmark; omit for folder). */
  url?: string;
  save?: string;
}

/** Closed list of op:bookmark actions. Growth requires ADR amendment. */
export const BOOKMARK_ACTIONS = [
  "tree", "create", "move", "update", "remove", "removeTree",
] as const;
export type BookmarkAction = typeof BOOKMARK_ACTIONS[number];

/** The closed Op union — exactly 13 members. */
/** Stamp/annotation overlay for `op:pdf` `mode:"stamp"` (ADR
 *  2026-07-15-op-pdf-stamp-mode). Local signature image overlaid at declared
 *  coordinates. `image` is a local `$file` ref. `imageBytes` is the peer-transport
 *  form, expanded from `image` at the dispatch boundary; not authored in plans.
 *  PUBLIC mirror of core/types.ts:PdfStamp. */
export interface PdfStamp {
  image: string;
  page: number;
  x: number;
  y: number;
  width?: number;
  opacity?: number;
  imageBytes?: string;
}

/** Host op: PDF output. `mode:"export"` (default) = CDP Page.printToPDF of the
 *  bound tab. `mode:"stamp"` = overlay `stamp` onto input PDF `pdf` (tab-free,
 *  deterministic — ADR 2026-07-15). `pdfBytes` is the peer-transport form of
 *  `pdf`, expanded from the `$file` ref at the dispatch boundary; not authored.
 *  PUBLIC mirror of core/types.ts:PdfOp (ADR 2026-07-08-op-capabilities). */
export interface PdfOp {
  op: "pdf";
  mode?: "export" | "stamp";
  landscape?: boolean;
  printBackground?: boolean;
  paperWidth?: number;
  paperHeight?: number;
  pdf?: string;
  stamp?: PdfStamp;
  pdfBytes?: string;
  save?: string;
}

/** Host op: push a `message` to the Tap side panel (plan→human output).
 *  PUBLIC mirror of core/types.ts:NotifyOp. */
export interface NotifyOp {
  op: "notify";
  message: string;
  save?: string;
}

/** Output op: CDP Page.captureScreenshot of the bound tab (or a clipped
 *  element) → base64 PNG/JPEG bytes. The raster analogue of op:pdf.
 *  PUBLIC mirror of core/types.ts:ScreenshotOp (ADR 2026-07-19-op-screenshot). */
export interface ScreenshotOp {
  op: "screenshot";
  format?: "png" | "jpeg";
  quality?: number;
  target?: string;
  save?: string;
}

/** Host-observation op: CDP accessibility-tree survey of the bound tab —
 *  role + accessible name for every rendered node, including closed
 *  shadow roots page JS cannot reach. PUBLIC mirror of
 *  core/types.ts:AxOp (ADR 2026-07-12-op-ax-observation). */
export interface AxOp {
  op: "ax";
  /** Exact AX role, case-insensitive (e.g. "button"). */
  role?: string;
  /** Accessible-name substring, case-insensitive. */
  name?: string;
  /** Max items returned. Default 120; peer hard-caps candidates at 400. */
  limit?: number;
  save?: string;
}

/** Host op: invoke a thin host capability from the host-caps registry.
 *  `cap` names a registry entry mapped to a chrome.<namespace>.<method>(...)
 *  call; adding a capability is a registry entry (data), not new op code.
 *  PUBLIC mirror of core/types.ts:HostOp (ADR
 *  2026-07-16-primitive-set-narrow-waist-and-thin-host-capability-registry). */
export interface HostOp {
  op: "host";
  cap: string;
  args?: Record<string, unknown>;
  save?: string;
}

export type Op =
  | FetchOp | NavOp | WaitOp | InputOp | ExtractOp | CookiesOp | TapOp
  | IfOp | ForeachOp | ParallelOp
  | EvalOp | TabOp | BookmarkOp
  | PdfOp
  | NotifyOp
  | ScreenshotOp
  | AxOp
  | HostOp;

/** Runtime constant for the 18-op closure (op:screenshot added per ADR
 *  2026-07-19-op-screenshot; op:host added per ADR
 *  2026-07-16-primitive-set-narrow-waist; highlight/screencast/point retired
 *  per ADR 2026-07-13-op-union-minimization). */
export const OP_NAMES_V2 = [
  "fetch", "nav", "wait", "input", "extract", "cookies", "tap",
  "if", "foreach", "parallel",
  "eval", "tab", "bookmark",
  "pdf",
  "notify",
  "screenshot",
  "ax",
  "host",
] as const;

export type OpName = typeof OP_NAMES_V2[number];

// ═══════════════════════════════════════════════════════════════════════════
// L3 — Plan
// ═══════════════════════════════════════════════════════════════════════════

// ─── Flow lifecycle (per ADR 2026-05-10-plan-lifecycle-scoped-tabs) ─────
//
// Closed union: a flow declares its tab lifetime intent. Mirror of
// `FLOW_LIFECYCLES` / `FlowLifecycle` / `resolveLifecycle` in
// core/types.ts. Growing past 2 values requires ADR amendment + arch
// test PL1 update on the engine side.

/** Tab lifetime policy values. */
export const FLOW_LIFECYCLES = ["scoped", "interactive"] as const;
export type FlowLifecycle = typeof FLOW_LIFECYCLES[number];

/** Resolution helper: explicit field wins; absent defaults to "scoped"
 *  (RAII-safe default per the ADR's Decision Standard 1). */
export function resolveLifecycle(plan: { lifecycle?: FlowLifecycle }): FlowLifecycle {
  return plan.lifecycle ?? "scoped";
}

/** The DURABLE half of a Flow — the verifiable intent that survives when the
 *  ops are re-crystallized (per ADR `2026-07-14-intent-first-class.md`).
 *
 *  `observe`/`act`/`confirm` are a CACHE: a compiled realization of this intent
 *  against the substrate's current shape. When the substrate drifts and that
 *  cache goes stale, THIS is the regeneration target:
 *    - `goal`       — what the tap is FOR (what to re-author toward)
 *    - `oracle`     — the effect predicate that DEFINES success, independent of
 *                     the ops that achieve it (a healed flow must re-establish
 *                     `oracle`, not merely re-run stale ops)
 *    - `source_url` — where the substrate lives (regeneration entry point)
 *
 *  The flat `source_intent` / `source_url` / write-`postcondition` fields are
 *  the GRANDFATHERED projection of this object. Read via `resolveIntent(plan)`
 *  / `effectiveOracle(plan)`, never the flat fields directly. */
export interface FlowIntent {
  /** The user's intent in natural language. Supersedes flat `source_intent`. */
  goal: string;
  /** The effect claim that defines success, independent of the ops that
   *  achieve it. Honored at run time via `effectiveOracle(plan)`. */
  oracle?: CelExpr;
  /** Where the substrate lives — regeneration entry point. Supersedes flat
   *  `source_url`. */
  source_url?: string;
}

/** Common Flow fields (shared by read and write variants). */
interface FlowCommon {
  /** Self-declared schema URL for forward-compatibility (per ADR
   *  `2026-05-09-userspace-via-standards.md` INV-2). When absent,
   *  the engine backward-fills to the current schema reader. When
   *  present and known, dispatch is exact. */
  $schema?: string;
  id: TapId;
  description?: string;
  args?: Record<string, ArgSpec>;
  requires?: { runtime?: "extension" | "playwright" };
  /** Tab lifetime policy (per ADR 2026-05-10-plan-lifecycle-scoped-tabs.md).
   *  Absent ⇒ resolveLifecycle returns "scoped" (RAII-safe default). */
  lifecycle?: FlowLifecycle;
  /** Pure read of current state. */
  observe?: Op[];
  /** What the tap returns. CEL over $args + phase outputs. */
  return: CelExpr;
  /** The source URL the tap was originally captured from. Set by
   *  `capture` so subsequent calls (heal-by-recapture, drift diagnosis)
   *  know where the substrate lives without manual passing. */
  source_url?: string;
  /** The user's intent expressed in natural language at capture time.
   *  GRANDFATHERED — new plans carry `intent.goal`; read via
   *  `resolveIntent(plan)`, never this field directly. */
  source_intent?: string;
  /** The DURABLE verifiable intent (goal + oracle + source_url). First-class
   *  as of ADR `2026-07-14-intent-first-class.md`: the ops are a regenerable
   *  cache OF this. Optional for backward compatibility — pre-migration plans
   *  project their flat fields via `resolveIntent(plan)`. */
  intent?: FlowIntent;
}

/** Discriminated union: act non-empty ⇒ key required at type level.
 *  `never` (not `undefined`) makes absence a hard type-level invariant. */
export type Flow =
  | (FlowCommon & {
      // Pure read variant — write fields unrepresentable
      act?: never;
      key?: never;
      postcondition?: never;
      dedup_ttl_seconds?: never;
      confirm?: never;
    })
  | (FlowCommon & {
      // Write variant — act + key both required
      act: Op[];
      key: CelExpr;
      confirm?: Op[];
      postcondition?: CelExpr;
      dedup_ttl_seconds?: number;
    });

/** Resolve the DURABLE intent of a Flow, unifying the first-class `intent`
 *  object with the grandfathered flat fields (per ADR
 *  `2026-07-14-intent-first-class.md`). THE single read path — callers never
 *  read `flow.intent` / `plan.source_intent` directly, so a flow authored
 *  first-class and a grandfathered flat flow project identically. Mirrors
 *  `resolveLifecycle`. */
export function resolveIntent(
  plan: { intent?: FlowIntent; source_intent?: string; source_url?: string },
): { goal?: string; oracle?: CelExpr; source_url?: string } {
  const it = plan.intent;
  const post = (plan as { postcondition?: CelExpr }).postcondition;
  return {
    goal: it?.goal ?? plan.source_intent,
    oracle: it?.oracle ?? post,
    source_url: it?.source_url ?? plan.source_url,
  };
}

/** The EFFECTIVE effect-oracle a Flow verifies — first-class `intent.oracle`
 *  when present, else the grandfathered write `postcondition`. THE read site
 *  for "what predicate defines this write's success". */
export function effectiveOracle(
  plan: { intent?: FlowIntent; postcondition?: CelExpr },
): CelExpr | undefined {
  const o = plan.intent?.oracle;
  if (typeof o === "string" && o.trim() !== "") return o;
  const post = plan.postcondition;
  return typeof post === "string" && post.trim() !== "" ? post : undefined;
}

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

/** 3-arm closed enum returned by `verify`.
 *  - live: every observe op succeeded; any op.expect predicate truthy
 *  - drifted: 4xx/5xx, op.expect → falsy, JSON parse fail, or unimplemented op
 *  - unreachable: network failure / timeout / DNS / connection refused
 *
 *  Per ADR `2026-05-10-snapshot-dissolved.md` — the v0.x 4-arm
 *  (equivalent/drifted/baseline-set/unreachable) retired with the
 *  snapshot subsystem. */
export const VERDICT_VALUES = [
  "live", "drifted", "unreachable",
] as const;
export type Verdict = typeof VERDICT_VALUES[number];
