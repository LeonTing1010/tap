/**
 * @taprun/spec lint — public surface stub.
 *
 * Only the rule-name vocabulary and `LintError` shape are exposed here.
 * The actual rule implementation lives in the proprietary engine
 * (`core/lint.ts`); third-party tools that consume lint output use
 * this module to type their result handling.
 *
 * Rule names track the upstream implementation. Adding a name here is
 * a signal-only change — the publishable contract is "if Tap reports
 * rule X, here is the slug." The engine remains the only producer.
 */

/** Discriminated severity for a lint finding. */
export type LintSeverity = "error" | "warn";

/** A single lint finding. Shape matches the engine's emit format. */
export interface LintError {
  severity: LintSeverity;
  /** Stable rule slug (see `LINT_RULE_NAMES`). */
  rule: string;
  /** Dot/bracket path to the offending node, e.g. "act[0].body[2].fn". */
  path: string;
  message: string;
}

/** Closed enumeration of lint rule slugs the engine may emit. Consumers
 *  can type-narrow on this union; new rules require a minor version bump. */
export const LINT_RULE_NAMES = [
  // op:eval forbidden patterns (one slug per pattern class).
  // RESERVED: fetch/xhr are NOT currently emitted — the engine deliberately
  // permits page-native HTTP in op:eval (it reflects page capability, and
  // there is no non-eval page-HTTP op). Kept in the union for back-compat;
  // op:eval is value-only w.r.t. DOM mutation / UI driving, not network.
  "eval-forbidden-fetch",
  "eval-forbidden-xhr",
  "eval-forbidden-click",
  "eval-forbidden-dispatchEvent",
  "eval-forbidden-execcommand",
  "eval-forbidden-requestsubmit",
  "eval-forbidden-submit",
  "eval-forbidden-chrome",
  "eval-forbidden-deno",
  "eval-forbidden-dynamic-import",
  "eval-forbidden-new-function",
  "eval-forbidden-other",
  // structural pairings
  "missing-confirm",
  "precondition-bad-scope",
  // op:tap hygiene
  "tap-empty-id",
  // cross-origin coherence
  "cross-origin-page-session",
  // composite-plan scope hygiene
  "parallel-save-leak",
  "eval-arithmetic-suggest",
] as const;

export type LintRuleName = typeof LINT_RULE_NAMES[number];
