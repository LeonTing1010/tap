/**
 * @taprun/spec — Tap plan-v1 format spec.
 *
 * STATE: Iteration 1 RED stub. The actual exports land in Iteration 2 of
 * the distribution flywheel reconstruction (Addendum B, Slice 1).
 *
 * Once GREEN, this module exports:
 *
 *   - ExecutionPlan        (the body of a .tap.json envelope)
 *   - TapAnnotation        (the W3C Annotation envelope wrapping ExecutionPlan)
 *   - OP_NAMES, OpName     (closed union of plan ops)
 *   - validateAnnotation() (zero-import W3C MUST-level validator)
 *   - All op interfaces (FetchOp, NavOp, WaitOp, ...)
 *   - HealthContract, AuthoritativeSpec, ArgSpec
 *
 * Source of truth: core/core/compose/plan.ts +
 *                  core/core/compose/annotation_validator.ts
 * Public spec doc: https://taprun.dev/spec/plan-v1/
 * Vocabulary IRI:  https://taprun.dev/ns/tap-v1/
 *
 * Why this package exists: third-party tools (Playwright→Tap adapters,
 * Stagehand→Tap adapters, alternative runtimes, governance layers like
 * APS) need to consume the .tap.json format without depending on private
 * tap-core. This package is the public surface.
 *
 * Closed/open boundary (CLAUDE.md):
 *   PUBLIC — types, envelope shape, validator, op union
 *   PRIVATE — forge AI compile, doctor semantic verifier, heal pipeline
 */

// TODO(iter-2): re-export from the type source-of-truth in core/compose/plan.ts
//
// The Iteration 2 plan:
//   1. Run a build script that copies core/compose/plan.ts → src/plan.ts
//      with all `import type { Target } from "./annotation.ts"` rewires.
//   2. Copy core/compose/annotation.ts (Target type only) → src/annotation.ts
//   3. Copy core/compose/annotation_validator.ts → src/annotation_validator.ts
//      (already zero-import — this is a clean copy)
//   4. Re-export from this index.ts.
//   5. The build script lives at scripts/sync-from-core.ts and runs in CI
//      before publish. It also runs the source equality check that the
//      RED test in core/src/test/spec_extraction_test.ts asserts.
//
// We do not vendor `core/compose/plan.ts` by hand-copy because that would
// drift. The sync script is the single source of truth.

export {};
