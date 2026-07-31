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

Deno.test("[smoke] runPipe rejects cycles at flow time", async () => {
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

// ============================================================================
// Regression: imperative-with-pipe taps run through the sandbox
// ============================================================================

Deno.test("[regression] imperative tap that calls handle.pipe() inside works under sandbox", async () => {
  // Why: before 2026-04-11, tap files with shape
  //
  //   export default {
  //     async tap(handle, args) {
  //       return handle.pipe({ steps: [...], return: "$x.rows" });
  //     }
  //   }
  //
  // compiled into the sandbox Worker as a Proxy where `handle.pipe` sent
  // "pipe" via postMessage like any other tap.* RPC. The main-thread
  // handler forwarded it to `send("tool", "tap.pipe", ...)` which had no
  // daemon handler, so it bubbled back as
  //
  //   operation 'pipe' is restricted in this context
  //
  // blocking every imperative-with-pipe tap on the CLI subprocess path —
  // including rdk/market-scan, rdk/demo-transform, bounty/match. The fix
  // is the localPipe parameter on runInSandbox: handle.pipe() is still
  // whitelisted in the Worker, but on the main thread it's intercepted
  // and routed to the real tap.pipe closure instead of being forwarded
  // as RPC. This test exercises the full path.
  const tmp = await Deno.makeTempDir();
  try {
    // A sub-tap that just returns literal rows — no network, no sandbox
    // escape hatches. The pipe DSL will fan this out and reassemble.
    await Deno.mkdir(`${tmp}/t`, { recursive: true });
    await Deno.writeTextFile(
      `${tmp}/t/src.tap.js`,
      `export default {
         site: "t", name: "src",
         async tap(_handle, _args) {
           return [{ n: 1 }, { n: 2 }, { n: 3 }];
         }
       }`,
    );
    // An imperative parent that composes src via handle.pipe(). This is
    // the exact pattern rdk/market-scan uses. Under the old code, this
    // tap would be sandboxed (sandbox: true default), hit the worker's
    // "pipe" Proxy, and error out. Under the fix, localPipe routes it
    // to the real executor closure.
    await Deno.writeTextFile(
      `${tmp}/t/parent.tap.js`,
      `export default {
         site: "t", name: "parent",
         async tap(handle, _args) {
           return handle.pipe({
             steps: [{ id: "x", run: ["t", "src"], args: {} }],
             return: "$x.rows",
           });
         }
       }`,
    );

    const mod = await loadTap(`${tmp}/t/parent.tap.js`);
    const result = await runTap(
      mod,
      {},
      () => Promise.resolve({}),
      [tmp], // tapDirs — needed for tap.pipe to resolve sub-taps
      { tapPath: `${tmp}/t/parent.tap.js`, sandbox: true }, // SANDBOX ON
    );

    // The load-bearing claim is "pipe composition actually executed
    // and produced the right number of rows with the right data" — not
    // what their storage type is. Pipe DSL $x.rows is the column-
    // normalized view, which stringifies numeric columns; the pipe then
    // returns that view into rawRows. Compare stringified values.
    assertEquals(result.rawRows.length, 3);
    const rawRows = result.rawRows as Array<Record<string, unknown>>;
    assertEquals(String(rawRows[0].n), "1");
    assertEquals(String(rawRows[1].n), "2");
    assertEquals(String(rawRows[2].n), "3");
  } finally {
    await Deno.remove(tmp, { recursive: true });
  }
});

Deno.test("[regression] imperative handle.pipe() without tapDirs still gives a clear error under sandbox", async () => {
  // Why: when an embedder enables the sandbox but doesn't provide tapDirs,
  // tap.pipe has nothing to resolve against. The executor passes
  // localPipe:undefined in that case, so the sandbox's main-thread
  // handler rejects pipe() with a helpful message pointing at the fix
  // ("author as pipe-only OR run with sandbox:false"). This prevents
  // a silent runtime crash deep inside runPipeWithTrace.
  const tmp = await Deno.makeTempDir();
  try {
    await Deno.mkdir(`${tmp}/t`, { recursive: true });
    await Deno.writeTextFile(
      `${tmp}/t/lonely.tap.js`,
      `export default {
         site: "t", name: "lonely",
         async tap(handle, _args) {
           return handle.pipe({ steps: [], return: "$nothing" });
         }
       }`,
    );

    const mod = await loadTap(`${tmp}/t/lonely.tap.js`);
    // Intentionally pass NO tapDirs and NO explicit sandbox:false.
    await assertRejects(
      () =>
        runTap(
          mod,
          {},
          () => Promise.resolve({}),
          undefined, // no tapDirs → localPipe will be undefined
          { tapPath: `${tmp}/t/lonely.tap.js`, sandbox: true },
        ),
      Error,
      "pipe",
    );
  } finally {
    await Deno.remove(tmp, { recursive: true });
  }
});
