/**
 * tap.explain — the **execution dual** of tap.pipe.
 *
 * Composition is "submit pipe, then run it". Explain is "submit pipe, then
 * analyze it without running it". Pure function, zero side effects, takes
 * `Pipe → ExecutionPlan`.
 *
 * Why this exists (Tier 1.5 in docs/composition-retrospective.md):
 *   - After an author writes a pipe there's no tool that says "here's what
 *     it will do" without actually executing it. explain() fills that gap.
 *   - Downstream features that build on top: AI pre-validation (before
 *     spending tokens on a pipe), doctor integration, pipe visualization,
 *     cost estimation, IDE hover info, static lint in tap save. All of
 *     those reduce to walking an ExecutionPlan.
 *   - Category-theoretic symmetry: runPipe turns `Pipe → Result`; explain
 *     turns `Pipe → Plan`. One does the work, one describes the work.
 *
 * Invariants:
 *   1. Pure: same (pipe, args, tapDirs) always yields the same plan. No
 *      file writes, no sub-tap execution, no handle.* calls.
 *   2. Robust: unknown step refs, missing sub-taps, cycles — explain()
 *      reports them via plan fields, never throws. (runPipe throws by
 *      design at the same errors; explain is the forgiving dual.)
 *   3. Best-effort: when a sub-tap module is missing from disk, its node
 *      still appears with path=null and empty capabilities/required. AI
 *      callers can decide whether to warn or ignore.
 *
 * See also: runPipe for the execution counterpart, detectCapabilities for
 * the source-scan helper that populates node.capabilities at forge.save.
 */

import { loadTap, type TapArgSpec, type TapModule } from "./executor.ts";
import {
  collectRefs,
  parseRef,
  type Pipe,
  type PipeStep,
  resolveRefs,
} from "./pipe.ts";

/** A single step in the plan — one sub-tap invocation, statically resolved. */
export interface PlanNode {
  /** Step id from the pipe — same string the user chose. */
  id: string;
  /** Tuple identifying the sub-tap this step calls: [site, name]. */
  run: [site: string, name: string];
  /** Absolute path to the sub-tap .tap.js file on disk, or null if unresolved. */
  path: string | null;
  /**
   * Args with $args.* refs substituted against the top-level pipeArgs.
   * $stepId.field refs are LEFT AS-IS (strings) because their values
   * don't exist until runtime. A consumer inspecting argsResolved can
   * grep for `$` prefixes to find symbolic references.
   */
  argsResolved: Record<string, unknown>;
  /** Capabilities union from the sub-tap's manifest (empty if module missing). */
  capabilities: string[];
  /** Required arg names that aren't supplied by this step's args. Empty → all present. */
  required?: string[];
}

/** A dataflow edge — step A's output feeds step B's args. */
export interface PlanEdge {
  /** Source step id (the one that produces the data). */
  from: string;
  /** Destination step id (the one that consumes the data). */
  to: string;
  /**
   * The specific $ref string that created this edge, e.g. `$hot.rows`.
   * When multiple refs flow from `from` to `to`, only one is reported —
   * this field is for human-readable annotation, not a full bill of materials.
   */
  via: string;
}

/**
 * The analytical output of explain(). Every field is plain data — no
 * functions, no handles — so this value is safe to JSON.stringify for
 * logging, snapshotting in tests, or shipping to an AI as context.
 */
export interface ExecutionPlan {
  /** One PlanNode per step in input order. */
  nodes: PlanNode[];
  /** Dataflow edges derived from $refs in step args. */
  edges: PlanEdge[];
  /**
   * Topologically layered step ids. Each inner array is a "round" — every
   * step inside a round has its deps satisfied by earlier rounds and can
   * run in parallel. rounds.length = critical path length of the DAG.
   * Empty when the graph has a cycle spanning every step.
   */
  rounds: string[][];
  /** Unique "site/name" list — flat bill of materials for the whole pipe. */
  requires: string[];
  /** Union of every sub-tap's capabilities. Sorted, deduped. */
  capabilities: string[];
  /**
   * Arg-contract issues discovered via static check:
   *  - missing required args
   *  - sub-tap module not found on disk
   *  - (future) type mismatches against the sub-tap's declared args schema
   */
  schemaWarnings: string[];
  /**
   * $refs that point at neither a known step id nor `args`. These are
   * always bugs — typos in step ids, dangling references after a refactor,
   * or missed migrations. runPipe would throw at plan time; explain
   * collects them so the caller can report all of them at once.
   */
  unresolvedRefs: string[];
  /**
   * True when the DAG contains at least one cycle. rounds still reflects
   * as much as could be laid out before the blockage.
   */
  cycleDetected: boolean;
}

export interface ExplainOptions {
  /**
   * Tap search directories, searched in order (first-match-wins). When
   * omitted, no sub-tap module is loaded — nodes get empty capabilities
   * and no required-arg check runs. This mode is useful when the caller
   * only cares about DAG shape / rounds / edges.
   */
  tapDirs?: string[];
}

/** Args that transform taps accept implicitly — whitelisted from "unknown arg" checks. */
const IMPLICIT_ARG_KEYS = new Set(["rows", "limit"]);

/**
 * Analyze a pipe without running it. See ExecutionPlan for the output shape.
 *
 * @param pipe      the pipe to analyze
 * @param pipeArgs  top-level args bound to `$args.*` refs; use {} if none
 * @param opts      optional tapDirs for sub-tap manifest loading
 */
export async function explain(
  pipe: Pipe,
  pipeArgs: Record<string, unknown> = {},
  opts: ExplainOptions = {},
): Promise<ExecutionPlan> {
  // Guard the empty case here — runPipe throws for the same reason, and
  // there's no meaningful plan for zero steps.
  if (!pipe || !Array.isArray(pipe.steps)) {
    throw new Error("explain: pipe.steps must be an array");
  }

  const knownIds = new Set(pipe.steps.map((s) => s.id));
  const stepById = new Map(pipe.steps.map((s) => [s.id, s]));
  const schemaWarnings: string[] = [];
  const unresolvedRefs = new Set<string>();

  // 1. Build deps map — soft version. buildDependencyMap in pipe.ts throws
  //    on unknown refs; explain collects them instead.
  const deps = new Map<string, Set<string>>();
  for (const step of pipe.steps) {
    const refs = new Set<string>();
    collectRefs(step.args ?? {}, refs);
    const realDeps = new Set<string>();
    for (const ref of refs) {
      if (knownIds.has(ref)) {
        realDeps.add(ref);
      } else {
        // Not a known step id and not `args` (collectRefs already filtered
        // $args.*). This is a dangling reference — emit as unresolved.
        unresolvedRefs.add(`$${ref} in step '${step.id}'`);
      }
    }
    deps.set(step.id, realDeps);
  }

  // 2. Topological layering via Kahn-style rounds. Partial progress is
  //    preserved when a cycle is detected so the caller still sees the
  //    healthy prefix of the DAG.
  const rounds: string[][] = [];
  const done = new Set<string>();
  const remaining = new Set(pipe.steps.map((s) => s.id));
  let cycleDetected = false;

  while (remaining.size > 0) {
    const round: string[] = [];
    for (const id of remaining) {
      const stepDeps = deps.get(id) ?? new Set();
      let ready = true;
      for (const dep of stepDeps) {
        if (!done.has(dep)) { ready = false; break; }
      }
      if (ready) round.push(id);
    }
    if (round.length === 0) {
      // No progress possible — every remaining node's deps include at
      // least one other remaining node. That's a cycle by definition.
      cycleDetected = true;
      break;
    }
    // Stable order within a round — preserve pipe authoring order for
    // deterministic snapshots. Kahn's algorithm leaves this unspecified.
    round.sort((a, b) =>
      pipe.steps.findIndex((s) => s.id === a) -
      pipe.steps.findIndex((s) => s.id === b)
    );
    rounds.push(round);
    for (const id of round) {
      done.add(id);
      remaining.delete(id);
    }
  }

  // 3. Build edges from deps. For `via`, find the *first* $ref in step.args
  //    whose source is the dep. One edge per (from, to) pair keeps the
  //    graph simple — multi-input flows become one annotated edge.
  const edges: PlanEdge[] = [];
  for (const step of pipe.steps) {
    const stepDeps = deps.get(step.id) ?? new Set();
    for (const depId of stepDeps) {
      const via = findRefStringToSource(step.args ?? {}, depId) ?? `$${depId}`;
      edges.push({ from: depId, to: step.id, via });
    }
  }

  // 4. For each step, load the sub-tap module (if tapDirs provided) so we
  //    can populate capabilities and detect missing required args.
  const nodes: PlanNode[] = [];
  const capabilities = new Set<string>();
  const requires: string[] = [];

  for (const step of pipe.steps) {
    const [site, name] = step.run;
    const key = `${site}/${name}`;
    if (!requires.includes(key)) requires.push(key);

    // argsResolved substitutes $args.* against pipeArgs but leaves
    // $stepId.field refs alone — those only exist at runtime.
    const argsResolved = partialResolveArgs(step.args ?? {}, pipeArgs);

    let path: string | null = null;
    let subMod: TapModule | null = null;
    if (opts.tapDirs && opts.tapDirs.length > 0) {
      path = await findTapPath(site, name, opts.tapDirs);
      if (path) {
        try {
          subMod = await loadTap(path);
        } catch (e) {
          // Module exists but failed to load — treat as "found but broken".
          // path stays set, capabilities stay empty, warning emitted.
          schemaWarnings.push(
            `step '${step.id}' → ${key}: module failed to load (${
              (e as Error).message
            })`,
          );
        }
      } else {
        schemaWarnings.push(
          `step '${step.id}' → ${key}: sub-tap not found in tapDirs`,
        );
      }
    }

    const nodeCaps = subMod?.capabilities ?? [];
    for (const c of nodeCaps) capabilities.add(c);

    // Check required args. A required arg counts as "supplied" if the
    // step's args contain that key — even if the value is a $ref whose
    // runtime target is unknown. That matches runPipe's behavior: a $ref
    // that resolves to undefined at launch time is a DIFFERENT failure
    // class (bad upstream output) than a missing key (author error).
    const missing: string[] = [];
    if (subMod?.args) {
      const stepArgKeys = new Set(Object.keys(step.args ?? {}));
      for (const [argName, spec] of Object.entries(subMod.args)) {
        if ((spec as TapArgSpec).required && !stepArgKeys.has(argName)) {
          // Check if satisfied by $args.* — if the parent pipe's args
          // happen to carry the same key name and explain was called with
          // a concrete pipeArgs, treat as supplied via implicit forwarding.
          // We keep this narrow: no automatic $args.name threading, just
          // the literal key check.
          missing.push(argName);
        }
      }
      if (missing.length > 0) {
        schemaWarnings.push(
          `step '${step.id}' → ${key}: missing required args: ${
            missing.join(", ")
          }`,
        );
      }

      // Also surface unknown args — the step passed a key the sub-tap
      // doesn't declare, and it isn't an implicit-transform key.
      const declaredKeys = new Set(Object.keys(subMod.args));
      for (const stepKey of stepArgKeys) {
        if (!declaredKeys.has(stepKey) && !IMPLICIT_ARG_KEYS.has(stepKey)) {
          schemaWarnings.push(
            `step '${step.id}' → ${key}: unknown arg '${stepKey}' (sub-tap declares: ${
              [...declaredKeys].join(", ") || "(none)"
            })`,
          );
        }
      }
    }

    nodes.push({
      id: step.id,
      run: [site, name],
      path,
      argsResolved,
      capabilities: nodeCaps,
      ...(missing.length > 0 ? { required: missing } : {}),
    });
  }

  return {
    nodes,
    edges,
    rounds,
    requires,
    capabilities: [...capabilities].sort(),
    schemaWarnings,
    unresolvedRefs: [...unresolvedRefs].sort(),
    cycleDetected,
  };
}

/**
 * Walk tapDirs in order, returning the first path where
 * `{dir}/{site}/{name}.tap.js` exists. Null if nothing found.
 */
async function findTapPath(
  site: string,
  name: string,
  dirs: string[],
): Promise<string | null> {
  for (const dir of dirs) {
    const p = `${dir}/${site}/${name}.tap.js`;
    try {
      await Deno.stat(p);
      return p;
    } catch {
      /* next dir */
    }
  }
  return null;
}

/**
 * Partial ref resolution: substitute $args.* against pipeArgs, leave
 * $stepId.field refs as literal strings. Used for argsResolved — gives
 * consumers concrete values where possible and symbolic placeholders
 * where the actual data would require running upstream steps.
 */
function partialResolveArgs(
  value: unknown,
  pipeArgs: Record<string, unknown>,
): Record<string, unknown> {
  return walk(value) as Record<string, unknown>;

  function walk(v: unknown): unknown {
    if (typeof v === "string") {
      const ref = parseRef(v);
      if (!ref) return v;
      if (ref.source === "args") {
        // Reuse the shared resolveRefs helper — only the args-rooted path
        // matters here, so we pass empty steps.
        return resolveRefs(v, { args: pipeArgs, steps: {} });
      }
      // $stepId.field — leave as literal for visualization.
      return v;
    }
    if (Array.isArray(v)) return v.map(walk);
    if (v && typeof v === "object") {
      const out: Record<string, unknown> = {};
      for (const [k, vv] of Object.entries(v as Record<string, unknown>)) {
        out[k] = walk(vv);
      }
      return out;
    }
    return v;
  }
}

/**
 * Find the FIRST $ref string in `args` whose source is `sourceId`. Used
 * to annotate edges with a human-readable "via" field. Returns null if
 * not found (shouldn't happen given deps were built from the same args).
 */
function findRefStringToSource(
  args: Record<string, unknown>,
  sourceId: string,
): string | null {
  let found: string | null = null;
  walk(args);
  return found;

  function walk(v: unknown): void {
    if (found) return;
    if (typeof v === "string") {
      const ref = parseRef(v);
      if (ref && ref.source === sourceId) found = v;
      return;
    }
    if (Array.isArray(v)) {
      for (const item of v) walk(item);
      return;
    }
    if (v && typeof v === "object") {
      for (const item of Object.values(v as Record<string, unknown>)) {
        walk(item);
      }
    }
  }
}

// Silence unused-import lint if PipeStep ever needs to be referenced
// externally for augmentation. Keeps the explicit import at the top so
// the file's dependencies stay discoverable.
export type { PipeStep };
