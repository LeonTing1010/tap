/**
 * tap-v1 namespace vocabulary — the cross-consumer protocol contract.
 *
 * Source-of-truth for the term set defined at
 * https://taprun.dev/ns/tap-v1/. Downstream consumers (the proprietary
 * Tap CLI, third-party annotation stores, validators) import from here
 * to keep emit sites aligned with the namespace doc.
 *
 * Three-way drift guard (enforced by `.github/workflows/packages.yml ::
 * ns-cross-consumer-only`):
 *   1. THIS FILE — the canonical TS term set, type-checked at compile
 *      time so typos / case errors fail at build, not at validation.
 *   2. `docs/ns/tap-v1/index.jsonld` — JSON-LD `@id` set MUST equal
 *      `TAP_V1_NS_TERMS`.
 *   3. `docs/ns/tap-v1/README.md` — `## What it defines` tables MUST
 *      list exactly `TAP_V1_NS_TERMS`.
 *
 * Adding a term: edit this file AND index.jsonld AND README.md
 * together. Removing a term: mark `owl:deprecated` in jsonld + README,
 * keep the entry here with a `// deprecated` comment.
 *
 * Scope rule (from the namespace README): the vocabulary defines ONLY
 * terms that ship across a consumer boundary in a stored `.tap.json`
 * envelope. Internal implementation types (forge-time fingerprints,
 * intermediate selector candidates) are TypeScript-only and
 * intentionally excluded.
 */

/** Stable IRI of the namespace itself (the document at the URL). */
export const TAP_V1_NS_IRI = "https://taprun.dev/ns/tap-v1" as const;

/**
 * Terms that live in a stored compiled-Tap-program annotation
 * (motivation `tap:executing`, body `tap:ExecutionPlan`).
 */
export const TAP_V1_PLAN_TERMS = [
  "tap:ExecutionPlan",
  "tap:args",
  "tap:executing",
  "tap:health",
  "tap:intent",
  "tap:name",
  "tap:site",
] as const;

/**
 * Terms that live in a doctor `assessing` annotation
 * (motivation `oa:assessing`, body carries `tap:verdict` + diagnostics).
 */
export const TAP_V1_ASSESSMENT_TERMS = [
  "tap:compiledFromLayer",
  "tap:crossValidation",
  "tap:recommendedLayer",
  "tap:suggestAuthoritative",
  "tap:suggestions",
  "tap:verdict",
] as const;

/**
 * Full `tap-v1` term set. Equals
 * `TAP_V1_PLAN_TERMS ∪ TAP_V1_ASSESSMENT_TERMS`. Iteration order is
 * sorted so byte-equivalence with the JSON-LD context @id list and the
 * README contract tables is checkable with `LC_ALL=C sort`.
 */
export const TAP_V1_NS_TERMS = [
  ...TAP_V1_PLAN_TERMS,
  ...TAP_V1_ASSESSMENT_TERMS,
].sort() as readonly TapV1Term[];

/** Union of every CURIE defined by the namespace. */
export type TapV1Term =
  | (typeof TAP_V1_PLAN_TERMS)[number]
  | (typeof TAP_V1_ASSESSMENT_TERMS)[number];
