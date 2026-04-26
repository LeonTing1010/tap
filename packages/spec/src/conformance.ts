/**
 * @taprun/spec — Plan-v1 conformance suite.
 *
 * Why: adapter authors (tap-from-playwright, tap-from-puppeteer,
 * tap-from-stagehand, …) need a single function call to verify their
 * output is plan-v1 compliant. validateAnnotation() handles the W3C
 * envelope; the JSON Schema handles structural shape; this module is
 * the human-friendly wrapper that combines both layers and reports
 * failures categorized by what part of the format failed.
 *
 * Surface (intentionally tiny):
 *
 *   runConformance(value) → { pass, failures[], warnings[] }
 *   CONFORMANCE_FIXTURES → 7+ named (input, expectFail?) pairs covering
 *                          the closed enumeration of failure classes
 *
 * Failure classes (the "six" from the addendum-B plan, expanded):
 *   1. envelope     — missing/malformed top-level @context, type, target, body
 *   2. body         — body.type wrong, body missing site/name/intent/ops
 *   3. intent       — intent ∉ {read, write}
 *   4. ops          — empty array, or op missing required `op` field
 *   5. op-name      — ops[i].op ∉ OP_NAMES closed union
 *   6. authoritative — auth.source ∉ {fetch-json, fetch-json-2step, fetch-atom}
 */

import type {
  ExecutionPlan as _ExecutionPlan,
  TapAnnotation as _TapAnnotation,
} from "./plan.ts";
import { OP_NAMES } from "./plan.ts";
import {
  validateAnnotation,
  type ValidationError as _ValidationError,
} from "./annotation_validator.ts";

export type ConformanceCategory =
  | "envelope"
  | "body"
  | "intent"
  | "ops"
  | "op-name"
  | "authoritative";

export interface ConformanceFailure {
  /** Stable wire identifier — adapter test suites assert against this. */
  code: string;
  /** Human-readable message suitable for CLI output. */
  message: string;
  /** JSON-Pointer-like path into the input. */
  path: string;
  /** Failure class for high-level categorization. */
  category: ConformanceCategory;
}

export interface ConformanceResult {
  pass: boolean;
  failures: ConformanceFailure[];
  warnings: ConformanceFailure[];
}

const AUTH_SOURCES: ReadonlySet<string> = new Set([
  "fetch-json",
  "fetch-json-2step",
  "fetch-atom",
]);

function isObject(x: unknown): x is Record<string, unknown> {
  return typeof x === "object" && x !== null && !Array.isArray(x);
}

/**
 * Verify a value conforms to the plan-v1 format.
 *
 * Composes validateAnnotation() (W3C envelope) with plan-v1 body-level
 * checks. Returns a single result object so adapters can report a flat
 * list of issues instead of running two passes themselves.
 */
export function runConformance(value: unknown): ConformanceResult {
  const failures: ConformanceFailure[] = [];
  const warnings: ConformanceFailure[] = [];

  // -- Layer 1: W3C Annotation envelope ----------------------------------
  const w3c = validateAnnotation(value);
  for (const e of w3c.errors) {
    failures.push({
      code: e.code,
      message: e.message,
      path: e.path,
      category: "envelope",
    });
  }
  for (const w of w3c.warnings) {
    warnings.push({
      code: w.code,
      message: w.message,
      path: w.path,
      category: "envelope",
    });
  }

  // -- Layer 2: plan-v1 body checks --------------------------------------
  if (!isObject(value)) {
    return { pass: failures.length === 0, failures, warnings };
  }

  if (!("body" in value)) {
    // envelope check already reported missing body if any
    return { pass: failures.length === 0, failures, warnings };
  }

  const body = value.body;
  if (!isObject(body)) {
    failures.push({
      code: "body-not-object",
      message: "body MUST be an object containing a tap:ExecutionPlan.",
      path: "$/body",
      category: "body",
    });
    return { pass: false, failures, warnings };
  }

  if (body.type !== "tap:ExecutionPlan") {
    failures.push({
      code: "body-not-execution-plan",
      message:
        `body.type MUST be "tap:ExecutionPlan" (got ${JSON.stringify(body.type)}).`,
      path: "$/body/type",
      category: "body",
    });
  }

  for (const key of ["site", "name", "intent", "ops"] as const) {
    if (!(key in body)) {
      failures.push({
        code: "body-missing-field",
        message: `body MUST have "${key}".`,
        path: `$/body/${key}`,
        category: "body",
      });
    }
  }

  if (
    "intent" in body &&
    body.intent !== "read" &&
    body.intent !== "write"
  ) {
    failures.push({
      code: "intent-invalid",
      message:
        `body.intent MUST be "read" or "write" (got ${JSON.stringify(body.intent)}).`,
      path: "$/body/intent",
      category: "intent",
    });
  }

  if ("ops" in body) {
    if (!Array.isArray(body.ops)) {
      failures.push({
        code: "ops-not-array",
        message: "body.ops MUST be an array.",
        path: "$/body/ops",
        category: "ops",
      });
    } else {
      if (body.ops.length === 0) {
        failures.push({
          code: "ops-empty",
          message: "body.ops MUST contain at least one op.",
          path: "$/body/ops",
          category: "ops",
        });
      }
      for (let i = 0; i < body.ops.length; i++) {
        const op = body.ops[i];
        const path = `$/body/ops[${i}]`;
        if (!isObject(op)) {
          failures.push({
            code: "op-not-object",
            message: `body.ops[${i}] MUST be an object.`,
            path,
            category: "ops",
          });
          continue;
        }
        if (!("op" in op) || typeof op.op !== "string") {
          failures.push({
            code: "op-missing-name",
            message: `body.ops[${i}] MUST have a string "op" field.`,
            path: `${path}/op`,
            category: "ops",
          });
          continue;
        }
        if (!(OP_NAMES as readonly string[]).includes(op.op)) {
          failures.push({
            code: "op-unknown",
            message:
              `body.ops[${i}].op = "${op.op}" is not in the closed union OP_NAMES (${OP_NAMES.length} members).`,
            path: `${path}/op`,
            category: "op-name",
          });
        }
      }
    }
  }

  if ("authoritative" in body && body.authoritative !== undefined) {
    if (!isObject(body.authoritative)) {
      failures.push({
        code: "authoritative-not-object",
        message: "body.authoritative MUST be an object when present.",
        path: "$/body/authoritative",
        category: "authoritative",
      });
    } else {
      const src = body.authoritative.source;
      if (typeof src !== "string" || !AUTH_SOURCES.has(src)) {
        failures.push({
          code: "authoritative-source-invalid",
          message:
            `body.authoritative.source MUST be one of ${
              [...AUTH_SOURCES].join(", ")
            } (got ${JSON.stringify(src)}).`,
          path: "$/body/authoritative/source",
          category: "authoritative",
        });
      }
    }
  }

  return { pass: failures.length === 0, failures, warnings };
}

// ---------------------------------------------------------------------------
// CONFORMANCE_FIXTURES — exhaustive, named, exported.
//
// Adapter test suites can iterate this list and assert runConformance
// produces the expected verdict for each. Adding a new failure class
// requires adding a fixture here AND a branch above.
// ---------------------------------------------------------------------------

const ANNO_CONTEXT = [
  "http://www.w3.org/ns/anno.jsonld",
  "https://taprun.dev/ns/tap-v1",
];

const MIN_GOOD_PLAN = {
  "@context": ANNO_CONTEXT,
  type: "Annotation",
  motivation: "tap:executing",
  target: "https://example.test/",
  body: {
    type: "tap:ExecutionPlan",
    site: "example",
    name: "minimal",
    intent: "read",
    ops: [{ op: "fetch", url: "https://example.test/" }],
  },
};

export interface ConformanceFixture {
  /** Stable name — adapter tests reference these in their reports. */
  name: string;
  /** Brief human description. */
  description: string;
  /** Input to feed to runConformance. */
  input: unknown;
  /** When set, the test expects a failure with this code at this path
   *  (path is matched as a prefix). */
  expectFail?: {
    code: string;
    pathPrefix?: string;
    category?: ConformanceCategory;
  };
}

export const CONFORMANCE_FIXTURES: ConformanceFixture[] = [
  {
    name: "good/minimal",
    description: "Smallest legal plan: 1 fetch op, read intent.",
    input: MIN_GOOD_PLAN,
  },
  {
    name: "good/with-health-and-args",
    description: "Plan with HealthContract and ArgSpec — also legal.",
    input: {
      ...MIN_GOOD_PLAN,
      body: {
        ...MIN_GOOD_PLAN.body,
        args: {
          q: { type: "string", default: "", description: "search term" },
        },
        health: { min_rows: 1, non_empty: ["title"] },
      },
    },
  },
  {
    name: "bad/missing-context",
    description: "Envelope class — @context missing.",
    input: { ...MIN_GOOD_PLAN, "@context": undefined },
    expectFail: { code: "context-missing", category: "envelope" },
  },
  {
    name: "bad/wrong-body-type",
    description: "Body class — body.type ≠ tap:ExecutionPlan.",
    input: {
      ...MIN_GOOD_PLAN,
      body: { ...MIN_GOOD_PLAN.body, type: "tap:NotAPlan" },
    },
    expectFail: { code: "body-not-execution-plan", category: "body" },
  },
  {
    name: "bad/missing-body-site",
    description: "Body class — body.site missing.",
    input: {
      ...MIN_GOOD_PLAN,
      body: (() => {
        const b: Record<string, unknown> = { ...MIN_GOOD_PLAN.body };
        delete b.site;
        return b;
      })(),
    },
    expectFail: { code: "body-missing-field", pathPrefix: "$/body/site" },
  },
  {
    name: "bad/intent-not-read-write",
    description: "Intent class — intent ∉ {read, write}.",
    input: {
      ...MIN_GOOD_PLAN,
      body: { ...MIN_GOOD_PLAN.body, intent: "execute" },
    },
    expectFail: { code: "intent-invalid", category: "intent" },
  },
  {
    name: "bad/ops-empty",
    description: "Ops class — ops array empty.",
    input: { ...MIN_GOOD_PLAN, body: { ...MIN_GOOD_PLAN.body, ops: [] } },
    expectFail: { code: "ops-empty", category: "ops" },
  },
  {
    name: "bad/op-name-unknown",
    description: "Op-name class — closed union violation.",
    input: {
      ...MIN_GOOD_PLAN,
      body: { ...MIN_GOOD_PLAN.body, ops: [{ op: "fly" }] },
    },
    expectFail: { code: "op-unknown", category: "op-name" },
  },
  {
    name: "bad/op-missing-name",
    description: "Ops class — ops[i] missing op field entirely.",
    input: {
      ...MIN_GOOD_PLAN,
      body: { ...MIN_GOOD_PLAN.body, ops: [{ url: "https://x" }] },
    },
    expectFail: { code: "op-missing-name", category: "ops" },
  },
  {
    name: "bad/authoritative-bad-source",
    description: "Authoritative class — unknown source.",
    input: {
      ...MIN_GOOD_PLAN,
      body: {
        ...MIN_GOOD_PLAN.body,
        authoritative: {
          source: "fetch-yaml",
          url: "https://x",
          row_mapping: {},
          match_key: "id",
          comparators: {},
        },
      },
    },
    expectFail: {
      code: "authoritative-source-invalid",
      category: "authoritative",
    },
  },
];
