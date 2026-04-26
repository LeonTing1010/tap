/**
 * tap-v1 namespace — cross-consumer protocol contract terms.
 *
 * The exact term set defined at https://taprun.dev/ns/tap-v1/ — every
 * `tap:*` CURIE that ships across a consumer boundary in a stored
 * `.tap.json` envelope or a doctor `assessing` annotation body.
 *
 * Internal implementation types (forge-time fingerprints, intermediate
 * selector candidates) are intentionally excluded — they are
 * TypeScript-only and have no external consumers. See:
 * https://taprun.dev/ns/tap-v1/  (rationale: §"Scope rule")
 *
 * Naming follows JSON-LD / RDF convention:
 *   - Classes:     PascalCase  (tap:ExecutionPlan)
 *   - Properties:  camelCase   (tap:compiledFromLayer, tap:suggestAuthoritative)
 *   - Motivations: lowercase verb (tap:executing) — matches W3C anno
 *
 * Adding a term: add it here, in docs/ns/tap-v1/index.jsonld, and in
 * docs/ns/tap-v1/README.md. The CI guard
 * (.github/workflows/packages.yml :: ns-cross-consumer-only) imports
 * this constant and fails the build if any of the three drift apart.
 */

/** Live in a stored `.tap.json` (motivation + ExecutionPlan body). */
export const TAP_V1_PLAN_TERMS = [
  "tap:executing", // motivation
  "tap:ExecutionPlan", // body class
  "tap:site",
  "tap:name",
  "tap:intent",
  "tap:health",
  "tap:args",
] as const;

/** Live in a doctor `assessing` annotation body. */
export const TAP_V1_ASSESSMENT_TERMS = [
  "tap:verdict",
  "tap:compiledFromLayer",
  "tap:recommendedLayer",
  "tap:crossValidation",
  "tap:suggestions",
  "tap:suggestAuthoritative",
] as const;

/** All terms defined by the tap-v1 namespace. Exhaustive — see file
 *  header for the scope rule and adding-a-term workflow. */
export const TAP_V1_NS_TERMS = [
  ...TAP_V1_PLAN_TERMS,
  ...TAP_V1_ASSESSMENT_TERMS,
] as const;

export type TapV1PlanTerm = typeof TAP_V1_PLAN_TERMS[number];
export type TapV1AssessmentTerm = typeof TAP_V1_ASSESSMENT_TERMS[number];
export type TapV1NsTerm = typeof TAP_V1_NS_TERMS[number];

/** Canonical IRI for the namespace. */
export const TAP_V1_NS_IRI = "https://taprun.dev/ns/tap-v1" as const;
