/**
 * Pure helpers — no I/O, no process exits. Tested via node --test.
 *
 * Emits Tap v2 Flow documents per ADR 2026-05-03 (unified-tap-primitive)
 * and ADR 2026-05-04 (ecosystem-v2-launch §2.4 + §2.5).
 *
 * v2 vs v1 changes (relevant here):
 *   - Output file extension is `.flow.json` (NOT `.tap.json`).
 *   - Output is a BARE Flow object (NOT a W3C Annotation envelope).
 *   - No `intent: "read" | "write"` field — Flow is a TS discriminated
 *     union; presence of `act` + `key` denotes the write variant.
 *   - No `op:exec`, no `legacy:true`, no `generator` field.
 *   - 11-op closed union (fetch / nav / wait / input / extract / cookies /
 *     tap / if / foreach / parallel / eval).
 */
import process from "node:process";

export type Variant = "read" | "write";

export interface ParsedArgs {
  site: string;
  name: string;
  description: string;
  variant: Variant;
  outDir: string;
  force: boolean;
  help: boolean;
}

export interface StarterOptions {
  site: string;
  name: string;
  description: string;
  variant: Variant;
}

/**
 * Parse argv into a ParsedArgs. Throws Error with a human-readable
 * message on user-fixable problems (so cli.ts can render usage).
 *
 * Positional form: <site>/<name> "<description>"
 * The description is now a first-class positional (was inferred from URL
 * in v1) — v2 plans do not carry a single target URL; they carry an
 * arbitrary CEL `return` expression and templated op URLs.
 */
export function parseArgs(argv: string[]): ParsedArgs {
  let site = "";
  let name = "";
  let description = "";
  let variant: Variant = "read";
  let outDir = process.cwd();
  let force = false;
  let help = false;

  const positional: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--help" || a === "-h") {
      help = true;
    } else if (a === "--force") {
      force = true;
    } else if (a === "--write") {
      variant = "write";
    } else if (a === "--variant") {
      const v = argv[++i];
      if (v !== "read" && v !== "write") {
        throw new Error(
          `--variant must be "read" or "write" (got "${v}")`,
        );
      }
      variant = v;
    } else if (a === "--out") {
      const v = argv[++i];
      if (!v) throw new Error("--out requires a directory argument");
      outDir = v;
    } else if (a.startsWith("--")) {
      throw new Error(`unknown option: ${a}`);
    } else {
      positional.push(a);
    }
  }

  if (help) {
    return { site, name, description, variant, outDir, force, help };
  }

  if (positional.length < 1) {
    throw new Error(
      `expected at least 1 positional argument (<site>/<name> ["description"]), got ${positional.length}`,
    );
  }

  const id = positional[0];
  if (!/^[a-z0-9][a-z0-9_-]*\/[a-z0-9][a-z0-9_-]*$/.test(id)) {
    throw new Error(
      `invalid identifier "${id}" — must match <site>/<name> with lowercase alnum / dash / underscore`,
    );
  }
  [site, name] = id.split("/");
  description = positional[1] ??
    `Tap flow for ${site}/${name}. Customize the ops and return expression.`;

  return { site, name, description, variant, outDir, force, help };
}

/**
 * Build a minimal but real Tap v2 Flow as a starting point.
 *
 * Returns an unknown so callers serialize via JSON.stringify; we do not
 * import @taprun/spec types here to keep this package's runtime
 * dependency footprint at zero (devDep only).
 *
 * The shape is hand-mirrored from `core/types.ts` (PUBLIC subset per
 * ADR 2026-05-04 §2.4).
 */
export function buildStarterFlow(opts: StarterOptions): unknown {
  const { site, name, description, variant } = opts;
  const exampleUrl =
    `https://api.${site}.example.com/{{$args.someArg}}`;

  // Read variant — the default, no act/key. The op:fetch uses
  // page-session credentials so it reuses the user's authenticated
  // browser session at runtime.
  const readFlow = {
    id: { site, name },
    description,
    args: {
      someArg: {
        type: "string",
        required: true,
        description:
          "Example argument referenced by the templated fetch URL. Rename and add more under `args` as needed.",
      },
    },
    requires: { runtime: "extension" as const },
    observe: [
      {
        op: "fetch",
        url: exampleUrl,
        method: "GET",
        format: "json",
        // page-session: reuses the user's authenticated browser cookies.
        // Per core/types.ts FetchOp, must be same-origin with
        // a target reachable from the page context. Use "deno-host" for
        // unauthenticated public APIs called from the runtime host.
        credentials: "page-session",
      },
    ],
    // JSONata expression (v2 phase 1.x; CEL swap planned per parent ADR §12.6)
    // — `$observe` is the last observe-op return value. For a single op:fetch,
    // it is the parsed JSON body itself.
    return: "$observe",
  };

  if (variant === "read") {
    return readFlow;
  }

  // Write variant — adds act + key. Includes a comment-friendly
  // structure showing how a write tap composes observe (read current
  // state) with act (mutate) and a CEL key for intent dedup.
  return {
    ...readFlow,
    // The act phase performs the mutation. Replace this stub with the
    // real op sequence (input, fetch POST, etc.).
    act: [
      {
        op: "fetch",
        url: exampleUrl,
        method: "POST",
        format: "json",
        credentials: "page-session",
        body: { example: "{{$args.someArg}}" },
      },
    ],
    // Intent dedup key — same key + ttl ⇒ skipped re-execution.
    // JSONata expression: `&` is string concat; `$args.x` accesses an arg.
    key: "'someArg:' & $args.someArg",
    dedup_ttl_seconds: 86400,
    // Optional precondition — gate act on observed state.
    // precondition: "$exists($observe) and $observe.deleted = false",
    return: "$act",
  };
}

/**
 * Structural validator for the starter Flow shape — used by tests in
 * the absence of a published @taprun/spec@1.0. Mirrors core/types.ts
 * shape rules at a basic level: id present, ops use the closed 11-op
 * union, no forbidden v1 fields.
 */
const V2_OPS = new Set([
  "fetch", "nav", "wait", "input", "extract", "cookies", "tap",
  "if", "foreach", "parallel",
  "eval",
]);

const FORBIDDEN_FIELDS = [
  "@context", "type", "motivation", "body", "generator",
  "intent", "legacy", "allowUnverifiable",
];

const FORBIDDEN_OPS = new Set(["exec", "pipe", "parseXML", "screenshot", "scroll"]);

export interface ValidationResult {
  ok: boolean;
  failures: string[];
}

export function validateV2Flow(plan: unknown): ValidationResult {
  const failures: string[] = [];
  if (!plan || typeof flow !== "object" || Array.isArray(plan)) {
    return { ok: false, failures: ["plan must be a non-array object"] };
  }
  const p = flow as Record<string, unknown>;
  for (const f of FORBIDDEN_FIELDS) {
    if (f in p) {
      failures.push(`forbidden v1 field present: ${f}`);
    }
  }
  if (
    !p.id ||
    typeof p.id !== "object" ||
    typeof (p.id as Record<string, unknown>).site !== "string" ||
    typeof (p.id as Record<string, unknown>).name !== "string"
  ) {
    failures.push("flow.id must be { site: string, name: string }");
  }
  if (typeof p.return !== "string") {
    failures.push("plan.return must be a CEL expression string");
  }
  // Discriminated union check: act presence implies key presence.
  if ("act" in p) {
    if (!Array.isArray(p.act)) failures.push("plan.act must be an Op[]");
    if (typeof p.key !== "string") {
      failures.push("write variant: plan.key (CEL string) is required when act is present");
    }
  } else {
    if ("key" in p) {
      failures.push("read variant: plan.key must not be present without act");
    }
  }
  // Walk ops in observe + act + control-flow children.
  const ops: unknown[] = [];
  if (Array.isArray(p.observe)) ops.push(...p.observe);
  if (Array.isArray(p.act)) ops.push(...p.act);
  for (const o of ops) {
    if (!o || typeof o !== "object") {
      failures.push("op must be an object");
      continue;
    }
    const op = (o as Record<string, unknown>).op;
    if (typeof op !== "string") {
      failures.push("op.op must be a string");
      continue;
    }
    if (FORBIDDEN_OPS.has(op)) {
      failures.push(`forbidden v1 op present: ${op}`);
    } else if (!V2_OPS.has(op)) {
      failures.push(`unknown op: ${op}`);
    }
  }
  return { ok: failures.length === 0, failures };
}
