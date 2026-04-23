/**
 * tap.pipe() — declarative composition DSL for taps.
 *
 * A Pipe is a plain JavaScript data structure describing a DAG of sub-tap
 * calls. The executor:
 *   1. Parses every arg string of shape `$step.field` or `$args.field` as
 *      a dataflow reference, builds the dependency graph, topologically
 *      sorts it, and rejects cycles or dangling references at plan time.
 *   2. Runs independent steps in parallel via Promise.all.
 *   3. Resolves $refs at step-launch time against the parent args + completed
 *      steps' outputs, preserving nested object/array shapes.
 *   4. Surfaces errors with the failing step's id attached, so debugging a
 *      10-step pipeline doesn't devolve into bisecting tap.run() lines.
 *
 * Why this isn't YAML: JS already gives us typed objects, IDE autocomplete,
 * TypeScript checking at the boundary, and 100× more training data for AI
 * generation than any custom YAML DSL. The executor is 200 lines. A YAML
 * variant would be 850+ and buy nothing.
 */

/** One step in a pipe — a sub-tap call keyed by a user-chosen id. */
export interface PipeStep {
  /** Unique identifier for this step within the pipe. Used by $refs. */
  id: string;
  /** Tuple pointing at the sub-tap to invoke: [site, name]. */
  run: [site: string, name: string];
  /**
   * Arguments to pass to the sub-tap. String values of shape `$stepId.field`
   * or `$args.field` are resolved at launch time. Nested objects/arrays are
   * walked recursively.
   */
  args?: Record<string, unknown>;
}

/** A declarative pipeline: ordered list of steps + an optional return clause. */
export interface Pipe {
  steps: PipeStep[];
  /**
   * What the pipe returns when run. Shape:
   *   - "$stepId"       → whole step output (e.g. { rows, meta })
   *   - "$stepId.field" → specific field of step output
   *   - unset           → last step's `.rows` (convention-over-config)
   */
  return?: string;
}

/** Shape of tap.run accepted by runPipe — matches the real tap handle. */
export type TapRun = (
  site: string,
  name: string,
  args: Record<string, unknown>,
) => Promise<unknown>;

/**
 * A run-scoped memoization cache for sub-tap calls.
 *
 * Why it exists: two pipeline steps may legitimately call the same
 * sub-tap with the same args (e.g. step A reads `github/trending` for
 * one purpose, step B reads it for another). Without caching, the
 * underlying site is hit twice. The cache is scoped to a single
 * `runPipe` invocation — nothing leaks across runs, so stale data is
 * impossible.
 *
 * Cache key = `site/name:hash(args)`. Errors are not cached (a
 * transient failure must not poison the rest of the run).
 */
export interface RunCache {
  get(
    tapKey: string,
    args: Record<string, unknown>,
    producer: () => Promise<unknown>,
  ): Promise<unknown>;
}

/** Stable hash of an argument object. JSON.stringify with sorted keys is
 *  sufficient for cache-key purposes — argument objects are small and
 *  deeply nested data (rows arrays) is already the OUTPUT of a previous
 *  step, so two steps feeding each other would have already collapsed via
 *  the DAG-level dedupe. */
function hashArgs(args: Record<string, unknown>): string {
  const keys = Object.keys(args).sort();
  const entries: Array<[string, unknown]> = keys.map(k => [k, args[k]]);
  return JSON.stringify(entries);
}

/** Create a fresh in-memory cache for one runPipe invocation. */
export function createRunCache(): RunCache {
  const store = new Map<string, Promise<unknown>>();
  return {
    async get(tapKey, args, producer) {
      const key = `${tapKey}:${hashArgs(args)}`;
      const cached = store.get(key);
      if (cached) return await cached;
      // Run the producer and cache the PROMISE so concurrent callers
      // awaiting the same key share one execution.
      const promise = producer().catch((e) => {
        // Don't cache errors — remove on failure so next attempt re-runs.
        store.delete(key);
        throw e;
      });
      store.set(key, promise);
      return await promise;
    },
  };
}

/**
 * Validate a tap's `requires: string[]` list against available tap dirs.
 *
 * Why: composite taps declare which sub-taps they depend on. At forge.save
 * time, we check every required sub-tap exists on disk — rejecting broken
 * composites before they reach production. Runtime "tap not found" errors
 * are much harder to diagnose than save-time validation.
 *
 * Returns the list of missing entries (empty array = all satisfied).
 * Throws on malformed entries (anything without a "/").
 */
export async function validateRequires(
  requires: string[],
  tapDirs: string[],
): Promise<string[]> {
  const missing: string[] = [];
  for (const entry of requires) {
    if (!entry.includes("/")) {
      throw new Error(
        `requires: malformed entry '${entry}' — must be 'site/name'`,
      );
    }
    let found = false;
    for (const dir of tapDirs) {
      const path = `${dir}/${entry}.tap.js`;
      try {
        await Deno.stat(path);
        found = true;
        break;
      } catch {
        /* not in this dir, try next */
      }
    }
    if (!found) missing.push(entry);
  }
  return missing;
}

/** Parse a $ref string into { source, path }. Returns null if not a ref.
 *  @internal — shared with explain.ts. Not a public API, no stability guarantee. */
export function parseRef(s: string): { source: string; path: string[] } | null {
  if (typeof s !== "string" || !s.startsWith("$")) return null;
  // $foo     → source=foo, path=[]
  // $foo.bar → source=foo, path=[bar]
  // $foo.bar.baz → source=foo, path=[bar, baz]
  const body = s.slice(1);
  const parts = body.split(".");
  return { source: parts[0], path: parts.slice(1) };
}

/** Walk a value and collect every $ref string, with its source id.
 *  @internal — shared with explain.ts. Not a public API, no stability guarantee. */
export function collectRefs(value: unknown, out: Set<string>): void {
  if (typeof value === "string") {
    const ref = parseRef(value);
    if (ref && ref.source !== "args") out.add(ref.source);
    return;
  }
  if (Array.isArray(value)) {
    for (const v of value) collectRefs(v, out);
    return;
  }
  if (value && typeof value === "object") {
    for (const v of Object.values(value as Record<string, unknown>)) {
      collectRefs(v, out);
    }
  }
}

/** Recursively resolve $refs in an arg structure against a context.
 *  @internal — shared with explain.ts. Not a public API. */
export function resolveRefs(
  value: unknown,
  context: { args: Record<string, unknown>; steps: Record<string, unknown> },
): unknown {
  if (typeof value === "string") {
    const ref = parseRef(value);
    if (!ref) return value;
    const root: unknown = ref.source === "args"
      ? context.args
      : context.steps[ref.source];
    let current = root;
    for (const segment of ref.path) {
      if (current == null || typeof current !== "object") return undefined;
      current = (current as Record<string, unknown>)[segment];
    }
    return current;
  }
  if (Array.isArray(value)) {
    return value.map(v => resolveRefs(v, context));
  }
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = resolveRefs(v, context);
    }
    return out;
  }
  return value;
}

/** Build a map of step id → direct step dependencies for DAG scheduling. */
function buildDependencyMap(pipe: Pipe): Map<string, Set<string>> {
  const deps = new Map<string, Set<string>>();
  const knownIds = new Set(pipe.steps.map(s => s.id));

  for (const step of pipe.steps) {
    const stepDeps = new Set<string>();
    collectRefs(step.args ?? {}, stepDeps);
    // Validate every ref points to an actual step id (or was $args.*, filtered out).
    for (const dep of stepDeps) {
      if (!knownIds.has(dep)) {
        throw new Error(
          `pipe: step '${step.id}' references unknown step '$${dep}'. ` +
            `Known step ids: ${[...knownIds].join(", ") || "(none)"}`,
        );
      }
    }
    deps.set(step.id, stepDeps);
  }
  return deps;
}

/**
 * Detect cycles via DFS coloring. Throws with the cycle path for debugging.
 */
function detectCycles(deps: Map<string, Set<string>>): void {
  const WHITE = 0, GREY = 1, BLACK = 2;
  const color = new Map<string, number>();
  for (const id of deps.keys()) color.set(id, WHITE);

  function visit(id: string, path: string[]): void {
    const c = color.get(id);
    if (c === GREY) {
      const cycleStart = path.indexOf(id);
      const cycle = path.slice(cycleStart).concat(id);
      throw new Error(`pipe: cycle detected in dependency graph: ${cycle.join(" → ")}`);
    }
    if (c === BLACK) return;
    color.set(id, GREY);
    for (const next of deps.get(id) ?? []) {
      visit(next, [...path, id]);
    }
    color.set(id, BLACK);
  }

  for (const id of deps.keys()) {
    if (color.get(id) === WHITE) visit(id, []);
  }
}

// =============================================================================
// Execution trace — the post-run dual of ExecutionPlan (from explain.ts).
//
// Every field here has a counterpart in the static plan, so callers can
// set plan-side-by-side-with-trace and detect drift. Plan says "hot will
// run in round 0"; trace says "hot ran in round 0, took 234ms, returned
// 30 rows, cache_hit=false, error=null". Identical IDs, identical `run`
// tuples, identical args_resolved shape.
// =============================================================================

/** Runtime record of a single pipe step. Mirrors PlanNode + timing data. */
export interface PipeTraceNode {
  /** Step id from the pipe — same string the user chose. */
  id: string;
  /** Tuple identifying the sub-tap that ran: [site, name]. */
  run: [site: string, name: string];
  /**
   * Actual args passed at call time, with every $ref fully resolved.
   * Unlike PlanNode.argsResolved (which keeps $stepId.field symbolic),
   * this is the FINAL post-resolution shape the sub-tap received.
   */
  args_resolved: Record<string, unknown>;
  /** ISO timestamp when the step started. */
  started_at: string;
  /** Wall-clock duration in milliseconds. */
  duration_ms: number;
  /**
   * Number of rows in the step's output, when the output has a `.rows`
   * array. Most tap outputs do; for unusual shapes (raw strings, single
   * values) this stays undefined.
   */
  rows_out?: number;
  /** Column names from the step's output, when present. */
  columns_out?: string[];
  /**
   * True if the step hit the run-scoped cache — another step in the
   * same pipe with the same (site, name, args) ran first, and this
   * step consumed the memoized result. duration_ms is still measured
   * but reflects the cache lookup, not a real execution.
   */
  cache_hit: boolean;
  /** Error message if the step threw. Empty/unset on success. */
  error?: string;
}

/** Trace emitted by runPipeWithTrace — the full execution record. */
export interface PipeTrace {
  /** Per-step records in the order they finished. */
  nodes: PipeTraceNode[];
  /**
   * Actual topological layering — each inner array is one round, listed
   * in the order the scheduler ran them. Compare with ExecutionPlan.rounds
   * to detect drift between the predicted plan and real execution. In a
   * healthy run they're identical; when they diverge, something changed
   * between explain() and runPipe() — a new dependency, a cache change,
   * a race.
   */
  rounds_actual: string[][];
  /** Total wall-clock duration of the entire pipe. */
  total_ms: number;
  /** Number of steps whose producer actually ran (no cache hit). */
  run_cache_misses: number;
  /** Number of steps whose result came from the run-scoped cache. */
  run_cache_hits: number;
}

/**
 * Execute a pipeline AND capture a structured trace. Returns both the
 * value (what runPipe returned) and a PipeTrace describing what actually
 * happened at each step. Safe to call anywhere runPipe is; the trace is
 * pure data, no side effects beyond what the sub-taps themselves do.
 *
 * Use cases:
 *   - Post-mortem debugging after a failed pipe run
 *   - Performance profiling ("which step is slow")
 *   - Cache analysis ("did the run cache save work")
 *   - Drift detection by comparing with explain() output
 *   - AI agent retry loops that need structured failure data
 *
 * Scheduling model is identical to runPipe — trace capture is purely
 * observational, adds zero ordering effects or synchronization.
 */
export async function runPipeWithTrace(
  pipe: Pipe,
  pipeArgs: Record<string, unknown>,
  tapRun: TapRun,
): Promise<{ result: unknown; trace: PipeTrace }> {
  if (!pipe.steps || pipe.steps.length === 0) {
    throw new Error("pipe: steps array is empty");
  }

  // Plan phase: validate references and detect cycles before ANY step runs.
  const deps = buildDependencyMap(pipe);
  detectCycles(deps);

  // Execute phase: run steps in dependency order with maximum parallelism.
  // All sub-tap calls go through a run-scoped cache so identical
  // (site, name, args) triples across different step ids are deduped.
  const cache = createRunCache();
  const stepById = new Map(pipe.steps.map(s => [s.id, s]));
  const completed: Record<string, unknown> = {};
  const pending = new Set(pipe.steps.map(s => s.id));

  // Trace accumulator — grows as the scheduler progresses.
  const trace: PipeTrace = {
    nodes: [],
    rounds_actual: [],
    total_ms: 0,
    run_cache_misses: 0,
    run_cache_hits: 0,
  };
  const pipeStart = performance.now();

  while (pending.size > 0) {
    const ready: string[] = [];
    for (const id of pending) {
      const stepDeps = deps.get(id) ?? new Set();
      let allDone = true;
      for (const dep of stepDeps) {
        if (!(dep in completed)) { allDone = false; break; }
      }
      if (allDone) ready.push(id);
    }

    if (ready.length === 0) {
      // Should be unreachable because detectCycles runs first, but guard anyway.
      throw new Error(
        `pipe: no ready steps but ${pending.size} pending. Pending: ${[...pending].join(", ")}`,
      );
    }

    // Record the round before we kick it off — preserves scheduling
    // order even if some steps error out mid-round.
    trace.rounds_actual.push([...ready]);

    // Run the ready set in parallel. Every sub-tap call routes through
    // the run cache, so two steps with identical (site, name, args) share
    // one underlying invocation.
    const runs = ready.map(async (id) => {
      const step = stepById.get(id)!;
      const resolvedArgs = resolveRefs(step.args ?? {}, {
        args: pipeArgs,
        steps: completed,
      }) as Record<string, unknown>;

      // Trace scaffold — filled in as the step progresses. Pushed to
      // trace.nodes in the finally block so even thrown steps leave a
      // record behind (critical for debugging — you need to see the
      // failed step, not an empty nodes array).
      const stepNode: PipeTraceNode = {
        id,
        run: [step.run[0], step.run[1]],
        args_resolved: resolvedArgs,
        started_at: new Date().toISOString(),
        duration_ms: 0,
        cache_hit: false,
      };
      const stepStart = performance.now();

      // Cache-hit detection: if the producer closure never runs, the
      // result came from cache. Capture via a local flag rather than
      // reaching into RunCache internals — keeps the cache API clean.
      let producerRan = false;

      try {
        const tapKey = `${step.run[0]}/${step.run[1]}`;
        const out = await cache.get(tapKey, resolvedArgs, async () => {
          producerRan = true;
          return await tapRun(step.run[0], step.run[1], resolvedArgs);
        });
        stepNode.cache_hit = !producerRan;
        if (producerRan) trace.run_cache_misses++;
        else trace.run_cache_hits++;

        // Summarize the output for post-mortem inspection. Only look at
        // `.rows` / `.columns` — don't serialize the whole output, which
        // could be megabytes of data.
        if (out && typeof out === "object") {
          const obj = out as Record<string, unknown>;
          if (Array.isArray(obj.rows)) stepNode.rows_out = obj.rows.length;
          if (Array.isArray(obj.columns)) stepNode.columns_out = obj.columns as string[];
        }

        return { id, out };
      } catch (e) {
        stepNode.error = e instanceof Error ? e.message : String(e);
        const orig = e instanceof Error ? e.message : String(e);
        const wrapped = new Error(`pipe: step '${id}' failed — ${orig}`);
        if (e instanceof Error && e.stack) wrapped.stack = e.stack;
        throw wrapped;
      } finally {
        stepNode.duration_ms = Math.round(performance.now() - stepStart);
        trace.nodes.push(stepNode);
      }
    });

    try {
      const results = await Promise.all(runs);
      for (const { id, out } of results) {
        completed[id] = out;
        pending.delete(id);
      }
    } catch (e) {
      // A step threw — abort the pipe, but finalize the trace so the
      // caller still gets a post-mortem. Re-throw so the outer contract
      // (runPipe throws on failure) is preserved.
      trace.total_ms = Math.round(performance.now() - pipeStart);
      throw e;
    }
  }

  trace.total_ms = Math.round(performance.now() - pipeStart);

  // Resolve return clause.
  let result: unknown;
  if (pipe.return !== undefined) {
    result = resolveRefs(pipe.return, { args: pipeArgs, steps: completed });
  } else {
    // Convention: no return → last step's .rows
    const lastId = pipe.steps[pipe.steps.length - 1].id;
    const last = completed[lastId] as { rows?: unknown } | undefined;
    result = last?.rows;
  }

  return { result, trace };
}

/**
 * Execute a pipeline. Returns the value specified by `pipe.return`, or the
 * last step's `.rows` if `return` is unset.
 *
 * Scheduling model: in each round, run every step whose dependencies are
 * all satisfied, in parallel. Repeat until every step has completed.
 *
 * Thin wrapper around runPipeWithTrace — use this when you don't need
 * the trace (e.g. RDK market-scan running compiled pipes in-process).
 * Backwards-compatible with @taprun/executor@0.1.0 callers that consume
 * just the result value.
 */
export async function runPipe(
  pipe: Pipe,
  pipeArgs: Record<string, unknown>,
  tapRun: TapRun,
): Promise<unknown> {
  const { result } = await runPipeWithTrace(pipe, pipeArgs, tapRun);
  return result;
}
