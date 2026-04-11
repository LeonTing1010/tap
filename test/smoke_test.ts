/**
 * Smoke test — verifies the @taprun/executor package is self-contained
 * and usable without any tap-core imports.
 *
 * Every import below comes through mod.ts (the public entry). If this
 * test passes, the package is embeddable.
 *
 * Run: deno test --no-check --allow-all packages/executor/test/smoke_test.ts
 */

import {
  assert,
  assertEquals,
  assertExists,
  assertRejects,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  columnNames,
  createRunCache,
  createTapHandle,
  loadTap,
  normalizeColumns,
  runPipe,
  runTap,
  type ColumnSchema,
  type Pipe,
  type TapRun,
} from "../mod.ts";

Deno.env.set("TAP_TEST", "1");

// ============================================================================
// Shape: the package surface exports the expected symbols
// ============================================================================

Deno.test("[smoke] mod.ts exports runPipe as a function", () => {
  assertEquals(typeof runPipe, "function");
});

Deno.test("[smoke] mod.ts exports runTap as a function", () => {
  assertEquals(typeof runTap, "function");
});

Deno.test("[smoke] mod.ts exports loadTap as a function", () => {
  assertEquals(typeof loadTap, "function");
});

Deno.test("[smoke] mod.ts exports createTapHandle as a function", () => {
  assertEquals(typeof createTapHandle, "function");
});

Deno.test("[smoke] mod.ts exports ColumnSchema helpers", () => {
  const normalized = normalizeColumns(["a", { name: "b", type: "number" }]);
  assertEquals(normalized.length, 2);
  assertEquals(columnNames(normalized), ["a", "b"]);
});

// ============================================================================
// Behavior: runPipe works with a pure in-memory tapRun — no disk, no network
// ============================================================================

Deno.test("[smoke] runPipe executes a 2-step DAG with in-memory tapRun", async () => {
  // Why: this is the killer use case — an embedding product provides its
  // own tapRun (could be subprocess, HTTP, in-process — executor doesn't care)
  // and drives the pipe DSL end to end. If this fails, the package is broken.
  let callLog: string[] = [];
  const mockRun: TapRun = async (site, name, args) => {
    callLog.push(`${site}/${name}`);
    if (site === "test" && name === "source") {
      return { rows: [{ n: 1 }, { n: 2 }, { n: 3 }] };
    }
    if (site === "test" && name === "double") {
      const rows = args.rows as Array<{ n: number }>;
      return { rows: rows.map((r) => ({ n: r.n * 2 })) };
    }
    throw new Error(`unknown tap ${site}/${name}`);
  };

  const pipe: Pipe = {
    steps: [
      { id: "src", run: ["test", "source"], args: {} },
      { id: "doubled", run: ["test", "double"], args: { rows: "$src.rows" } },
    ],
    return: "$doubled.rows",
  };

  const result = await runPipe(pipe, {}, mockRun);
  assertEquals(result, [{ n: 2 }, { n: 4 }, { n: 6 }]);
  assertEquals(callLog, ["test/source", "test/double"]);
});

Deno.test("[smoke] runPipe parallelizes independent steps without waiting", async () => {
  // Why: the DAG scheduler is the whole reason to use pipe vs manual
  // await chains. Verify two independent steps run simultaneously.
  const started: Record<string, number> = {};
  const finished: Record<string, number> = {};
  const run: TapRun = async (_site, name) => {
    started[name] = Date.now();
    await new Promise((r) => setTimeout(r, 40));
    finished[name] = Date.now();
    return { rows: [] };
  };

  const t0 = Date.now();
  await runPipe(
    {
      steps: [
        { id: "a", run: ["test", "a"], args: {} },
        { id: "b", run: ["test", "b"], args: {} },
      ],
    },
    {},
    run,
  );
  const elapsed = Date.now() - t0;

  // Sequential would be ~80ms. Parallel should be ~40-60ms.
  assert(elapsed < 75, `expected parallel (<75ms), got ${elapsed}ms`);
  // b must start before a finishes
  assert(started.b < finished.a, "b must start before a finishes");
});

Deno.test("[smoke] runPipe dedupes identical sub-tap calls via run cache", async () => {
  // Why: the run-scoped cache is a key correctness property — two step ids
  // calling the same (site, name, args) only produce one real call.
  let calls = 0;
  const run: TapRun = async () => {
    calls++;
    return { rows: [{ v: 1 }] };
  };

  await runPipe(
    {
      steps: [
        { id: "x", run: ["test", "src"], args: { k: 1 } },
        { id: "y", run: ["test", "src"], args: { k: 1 } },
      ],
    },
    {},
    run,
  );
  assertEquals(calls, 1, "identical calls must dedupe");
});

Deno.test("[smoke] runPipe rejects cycles at plan time", async () => {
  const run: TapRun = async () => ({ rows: [] });
  await assertRejects(
    () =>
      runPipe(
        {
          steps: [
            { id: "a", run: ["t", "a"], args: { rows: "$b.rows" } },
            { id: "b", run: ["t", "b"], args: { rows: "$a.rows" } },
          ],
        },
        {},
        run,
      ),
    Error,
    "cycle",
  );
});

// ============================================================================
// Behavior: end-to-end — loadTap + runTap against a .tap.js file on disk
// ============================================================================

Deno.test("[smoke] loadTap + runTap execute a real .tap.js file", async () => {
  // Why: this is the alternative embedding path — products that want to
  // load user-authored .tap.js files directly, not just hand-crafted pipes.
  const tmp = await Deno.makeTempDir();
  try {
    await Deno.mkdir(`${tmp}/test`, { recursive: true });
    await Deno.writeTextFile(
      `${tmp}/test/hello.tap.js`,
      `export default {
         site: "test", name: "hello",
         description: "smoke test tap",
         async tap(handle, args) {
           return [{ greeting: \`hello \${args.name || "world"}\` }];
         }
       }`,
    );
    const mod = await loadTap(`${tmp}/test/hello.tap.js`);
    assertEquals(mod.site, "test");
    assertEquals(mod.name, "hello");
    assertExists(mod.tap);

    const result = await runTap(
      mod,
      { name: "taprun" },
      () => Promise.resolve({}),
      [tmp],
      { sandbox: false },
    );
    assertEquals(result.rows.length, 1);
    assertEquals(result.rows[0].greeting, "hello taprun");
  } finally {
    await Deno.remove(tmp, { recursive: true });
  }
});

// ============================================================================
// Behavior: createRunCache stands alone without runPipe
// ============================================================================

Deno.test("[smoke] createRunCache dedupes identical producer calls", async () => {
  const cache = createRunCache();
  let calls = 0;
  const producer = async () => ({ value: ++calls });

  const a = await cache.get("site/name", { k: 1 }, producer);
  const b = await cache.get("site/name", { k: 1 }, producer);
  assertEquals(calls, 1, "second call must hit cache");
  assertEquals(a, b);
});

// ============================================================================
// Package boundary: mod.ts does NOT depend on tap-core/src/
// ============================================================================

Deno.test("[smoke/boundary] package imports resolve within packages/executor/", async () => {
  // Why: the whole point of the package is self-containment. If mod.ts
  // or anything it re-exports secretly reaches into tap-core/src/ via a
  // relative path, publishing breaks. Grep for escape hatches.
  const modContent = await Deno.readTextFile(new URL("../mod.ts", import.meta.url).pathname);
  const escapePaths = modContent.match(/\.\.\/\.\.\/src\/|tap-core\/src\//g);
  assertEquals(escapePaths, null, "mod.ts must not import from tap-core/src/");

  for (const file of ["executor.ts", "pipe.ts", "page.ts", "sandbox.ts"]) {
    const src = await Deno.readTextFile(
      new URL(`../src/${file}`, import.meta.url).pathname,
    );
    const externalImport = src.match(/from ['"]\.\.\/\.\.\//g);
    assertEquals(
      externalImport,
      null,
      `packages/executor/src/${file} must not import outside the package`,
    );
  }
});
