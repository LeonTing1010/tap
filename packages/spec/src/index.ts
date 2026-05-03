/**
 * @taprun/spec — Tap v2 plan format (public TypeScript types).
 *
 * Public contract third-party tools build against to construct, display,
 * or type-narrow Tap v2 plans without depending on the proprietary Tap
 * engine.
 *
 * Spec doc:    https://taprun.dev/spec/plan-v2/
 * Schema break vs v0.x: see ADR
 *   https://github.com/LeonTing1010/tap/blob/main/docs/adr/2026-05-04-ecosystem-v2-launch.md
 *
 * What's in scope (PUBLIC):
 *   - Plan, ArgSpec, TapId
 *   - Op (11-arm closed union) + every member interface
 *   - OP_NAMES_V2, OpName
 *   - Verdict, IntentState (state-machine enums)
 *   - CelExpr, Json (primitive aliases)
 *   - LintError, LintRuleName, LINT_RULE_NAMES (consumer-side typing)
 *
 * What's NOT in scope (proprietary engine — never published):
 *   - forge (compiling URLs / natural language into plans)
 *   - doctor (semantic cross-validation)
 *   - heal (AI-driven plan repair)
 *   - Run, IntentRecord, Transition, Fingerprint, DoctorOutcome
 *   - Substrate, OpContext (runtime dispatch)
 */

export type {
  // Identity + primitives
  TapId,
  CelExpr,
  Json,
  ArgSpec,
  // Op union + members
  Op,
  OpName,
  FetchOp,
  NavOp,
  WaitOp,
  InputOp,
  ExtractOp,
  ExtractSpec,
  CookiesOp,
  TapOp,
  IfOp,
  ForeachOp,
  ParallelOp,
  EvalOp,
  // Plan
  Plan,
  // State-machine enums
  IntentState,
  Verdict,
} from "./types.ts";

export {
  OP_NAMES_V2,
  INTENT_STATES,
  VERDICT_VALUES,
} from "./types.ts";

export type {
  LintError,
  LintSeverity,
  LintRuleName,
} from "./lint.ts";

export {
  LINT_RULE_NAMES,
} from "./lint.ts";
