/**
 * @taprun/spec — Tap plan-v1 format spec.
 *
 * Public TypeScript types + W3C Web Annotation MUST-level validator for
 * compiled `.tap.json` plans. Use this package to typecheck or validate
 * Tap plans without depending on the closed Tap CLI.
 *
 * Spec doc:    https://taprun.dev/spec/plan-v1/
 * Vocabulary:  https://taprun.dev/ns/tap-v1/
 *
 * Source-of-truth: vendored byte-equivalent from core/compose/plan.ts,
 * core/compose/annotation.ts, core/compose/annotation_validator.ts in
 * the closed tap-core repo. Drift guarded by spec_extraction_test.ts.
 *
 * What's in scope (PUBLIC):
 *   - ExecutionPlan        body of a .tap.json envelope
 *   - TapAnnotation        W3C Annotation envelope wrapping ExecutionPlan
 *   - OP_NAMES, OpName     closed union of plan ops
 *   - All op interfaces (FetchOp, NavOp, WaitOp, ExtractOp, ...)
 *   - HealthContract, AuthoritativeSpec, ArgSpec
 *   - validateAnnotation() zero-runtime-dep W3C MUST-level validator
 *   - W3C Annotation types (Selector, State, Target, Annotation)
 *   - Pure helpers (selectorLayer, isSelector, isAnnotation)
 *   - Constants (W3C_ANNO, TAP_NS)
 *
 * What's NOT in scope (lives in the proprietary Tap CLI):
 *   - forge: compiling URLs / natural language into plans
 *   - doctor: semantic 4-layer cross-validation against authoritative sources
 *   - heal: AI-driven plan repair
 *   - identity, auth, runtime execution
 */

// Plan types — ExecutionPlan body, op closed-union, AuthoritativeSpec.
export type {
  // Envelope / plan body
  ExecutionPlan,
  TapAnnotation,
  // Op interfaces
  BaseOp,
  FetchOp,
  NavOp,
  WaitOp,
  InputOp,
  ExtractOp,
  ExtractSpec,
  EvalOp,
  ExecOp,
  ParseXmlOp,
  CookiesOp,
  ScreenshotOp,
  ScrollOp,
  ComputeOp,
  FilterOp,
  ProjectOp,
  SortOp,
  DedupeOp,
  PickOp,
  LimitOp,
  ConcatOp,
  PipeOp,
  IfOp,
  ForeachOp,
  ParallelOp,
  TapOp,
  // Op union + name token type
  Op,
  OpName,
  // Plan body sub-shapes
  ArgSpec,
  HealthContract,
  FieldComparator,
  AuthoritativeSpec,
  AuthoritativeFetchJson,
  AuthoritativeFetchJsonTwoStep,
  AuthoritativeFetchAtom,
  // Expression aliases
  JsonataExpr,
  Templated,
} from "./plan.ts";

// Op name closed union — runtime value, used by validators and serializers.
export { OP_NAMES } from "./plan.ts";

// W3C Web Annotation Data Model — types + pure helpers.
export type {
  Motivation,
  SelectorType,
  FragmentSelector,
  CssSelector,
  XPathSelector,
  TextQuoteSelector,
  TextPositionSelector,
  DataPositionSelector,
  SvgSelector,
  RangeSelector,
  JsonPathSelector,
  Selector,
  TimeState,
  HttpRequestState,
  SemanticHashState,
  State,
  SpecificResource,
  Target,
  Annotation,
  AnnotationCollection,
} from "./annotation.ts";

export {
  // Context constants
  W3C_ANNO,
  TAP_NS,
  // Pure helpers
  selectorLayer,
  isSelector,
  isAnnotation,
} from "./annotation.ts";

// W3C MUST-level validator — zero runtime dependencies.
export { validateAnnotation } from "./annotation_validator.ts";

export type {
  ValidationError,
  ValidationWarning,
  ValidationResult,
} from "./annotation_validator.ts";

// Plan-v1 conformance — combines W3C envelope + plan-level checks +
// fixture corpus for adapter authors.
export {
  runConformance,
  CONFORMANCE_FIXTURES,
} from "./conformance.ts";

export type {
  ConformanceCategory,
  ConformanceFailure,
  ConformanceResult,
  ConformanceFixture,
} from "./conformance.ts";

// tap-v1 namespace — exact cross-consumer protocol contract term set.
// CI guards consume these constants; downstream consumers (incl. the
// proprietary Tap CLI) can `import { TAP_V1_NS_TERMS } from "@taprun/spec"`
// to keep emit sites aligned with the namespace doc.
export {
  TAP_V1_PLAN_TERMS,
  TAP_V1_ASSESSMENT_TERMS,
  TAP_V1_NS_TERMS,
  TAP_V1_NS_IRI,
} from "./ns-vocabulary.ts";

export type {
  TapV1PlanTerm,
  TapV1AssessmentTerm,
  TapV1NsTerm,
} from "./ns-vocabulary.ts";
