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

/** Parse a $ref string into { source, path }. Returns null if not a ref. */
function parseRef(s: string): { source: string; path: string[] } | null {
  if (typeof s !== "string" || !s.startsWith("$")) return null;
  // $foo     → source=foo, path=[]
  // $foo.bar → source=foo, path=[bar]
  // $foo.bar.baz → source=foo, path=[bar, baz]
  const body = s.slice(1);
  const parts = body.split(".");
  return { source: parts[0], path: parts.slice(1) };
}

/** Walk a value and collect every $ref string, with its source id. */
function collectRefs(value: unknown, out: Set<string>): void {
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

/** Recursively resolve $refs in an arg structure against a context. */
function resolveRefs(
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

/**
 * Execute a pipeline. Returns the value specified by `pipe.return`, or the
 * last step's `.rows` if `return` is unset.
 *
 * Scheduling model: in each round, run every step whose dependencies are
 * all satisfied, in parallel. Repeat until every step has completed.
 */
export async function runPipe(
  pipe: Pipe,
  pipeArgs: Record<string, unknown>,
  tapRun: TapRun,
): Promise<unknown> {
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

    // Run the ready set in parallel. Every sub-tap call routes through
    // the run cache, so two steps with identical (site, name, args) share
    // one underlying invocation.
    const runs = ready.map(async (id) => {
      const step = stepById.get(id)!;
      const resolvedArgs = resolveRefs(step.args ?? {}, {
        args: pipeArgs,
        steps: completed,
      }) as Record<string, unknown>;
      try {
        const tapKey = `${step.run[0]}/${step.run[1]}`;
        const out = await cache.get(tapKey, resolvedArgs, () =>
          tapRun(step.run[0], step.run[1], resolvedArgs),
        );
        return { id, out };
      } catch (e) {
        const orig = e instanceof Error ? e.message : String(e);
        const wrapped = new Error(`pipe: step '${id}' failed — ${orig}`);
        if (e instanceof Error && e.stack) wrapped.stack = e.stack;
        throw wrapped;
      }
    });

    const results = await Promise.all(runs);
    for (const { id, out } of results) {
      completed[id] = out;
      pending.delete(id);
    }
  }

  // Resolve return clause.
  if (pipe.return !== undefined) {
    return resolveRefs(pipe.return, { args: pipeArgs, steps: completed });
  }
  // Convention: no return → last step's .rows
  const lastId = pipe.steps[pipe.steps.length - 1].id;
  const last = completed[lastId] as { rows?: unknown } | undefined;
  return last?.rows;
}
