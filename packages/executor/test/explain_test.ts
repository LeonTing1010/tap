/**
 * Constraint: tap.explain is a pure, non-throwing, static analyzer of Pipe
 * shape. Given a pipe, it returns a complete ExecutionFlow without running
 * any sub-tap, and reports problems (cycles, missing taps, dangling refs,
 * missing required args) as flow fields — never by throwing.
 *
 * Why this matters: every downstream feature in the Tier 1.5 proposal
 * (AI pre-validation, doctor integration, visualization, cost estimation)
 * reduces to walking an ExecutionPlan. If explain() is unreliable, every
 * consumer becomes unreliable. These tests lock in the invariants so
 * future refactors don't silently break the contract.
 *
 * Run: deno test --no-check --allow-all packages/executor/test/explain_test.ts
 */

import {
  assert,
  assertEquals,
  assertRejects,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import { explain, type Pipe } from "../mod.ts";

Deno.env.set("TAP_TEST", "1");

// ============================================================================
// Fixture: write a small set of sub-taps to disk so explain can load their
// manifests (capabilities + args schema). All tests that need tapDirs reuse
// this helper — no individual file-setup boilerplate.
// ============================================================================

async function withFixtureDir(
  body: (tapDir: string) => Promise<void>,
): Promise<void> {
  const tmp = await Deno.makeTempDir();
  try {
    await Deno.mkdir(`${tmp}/reddit`, { recursive: true });
    await Deno.mkdir(`${tmp}/transform`, { recursive: true });

    // reddit/hot — has one required arg (subreddit), fetches an API
    await Deno.writeTextFile(
      `${tmp}/reddit/hot.tap.js`,
      `export default {
        site: "reddit", name: "hot",
        description: "Fetch hot posts from a subreddit",
        capabilities: ["fetch"],
        args: {
          subreddit: { type: "string", required: true },
          limit: { type: "number", default: 25 }
        },
        async tap(handle, args) {
          return await handle.fetch("https://reddit.com/r/" + args.subreddit);
        }
      }`,
    );

    // reddit/comments — required arg 'postId', needs a browser handle
    await Deno.writeTextFile(
      `${tmp}/reddit/comments.tap.js`,
      `export default {
        site: "reddit", name: "comments",
        description: "Fetch comments for a post",
        capabilities: ["nav", "eval"],
        args: {
          postId: { type: "string", required: true }
        },
        async tap(handle, args) {
          await handle.nav("https://reddit.com/comments/" + args.postId);
          return await handle.eval(() => []);
        }
      }`,
    );

    // transform/top — pure transform, takes implicit 'rows' + 'n'
    await Deno.writeTextFile(
      `${tmp}/transform/top.tap.js`,
      `export default {
        site: "transform", name: "top",
        description: "Return top N rows by score",
        capabilities: [],
        args: {
          n: { type: "number", required: true }
        },
        async tap(handle, args) {
          return (args.rows || []).slice(0, args.n);
        }
      }`,
    );

    await body(tmp);
  } finally {
    await Deno.remove(tmp, { recursive: true });
  }
}

// ============================================================================
// Test 1 — explain returns a full flow for a 3-step pipe WITHOUT executing
// ============================================================================

Deno.test("[safety/what] explain returns full flow for a 3-step pipe without executing", async () => {
  await withFixtureDir(async (tapDir) => {
    const pipe: Pipe = {
      steps: [
        { id: "hot", run: ["reddit", "hot"], args: { subreddit: "sysadmin" } },
        {
          id: "comments",
          run: ["reddit", "comments"],
          args: { postId: "$args.post" },
        },
        {
          id: "top",
          run: ["transform", "top"],
          args: { rows: "$hot.rows", n: 5 },
        },
      ],
      return: "$top.rows",
    };

    const flow = await explain(pipe, { post: "abc123" }, { tapDirs: [tapDir] });

    // Every step becomes a node in input order.
    assertEquals(plan.nodes.length, 3);
    assertEquals(plan.nodes.map((n) => n.id), ["hot", "comments", "top"]);

    // requires bill-of-materials is flat + deduped.
    assertEquals(flow.requires.sort(), [
      "reddit/comments",
      "reddit/hot",
      "transform/top",
    ]);

    // Every sub-tap was resolved to an on-disk path.
    for (const node of plan.nodes) {
      assert(
        node.path && node.path.endsWith(".tap.js"),
        `expected path for ${node.id}, got ${node.path}`,
      );
    }

    // No errors surfaced — this pipe is well-formed.
    assertEquals(plan.cycleDetected, false);
    assertEquals(plan.unresolvedRefs, []);
    assertEquals(
      plan.schemaWarnings,
      [],
      `expected no warnings, got: ${plan.schemaWarnings.join(" | ")}`,
    );
  });
});

// ============================================================================
// Test 2 — explain detects cycles without throwing
// ============================================================================

Deno.test("[safety/what] explain detects cycles without throwing", async () => {
  // Why: runPipe throws on cycles by design (it's about to execute).
  // explain is the forgiving dual — a flow with cycleDetected=true is a
  // valid output, because the caller (AI validator, linter, visualizer)
  // must be able to *report* the cycle without blowing up.
  const pipe: Pipe = {
    steps: [
      { id: "a", run: ["t", "a"], args: { rows: "$b.rows" } },
      { id: "b", run: ["t", "b"], args: { rows: "$a.rows" } },
    ],
  };

  const flow = await explain(pipe, {}, {});
  assertEquals(plan.cycleDetected, true);
  // Nothing can enter any round — the entire graph is blocked.
  assertEquals(plan.rounds, []);
  // But edges still describe the dataflow — visualizers need them to
  // draw the arrow that closes the cycle.
  assertEquals(plan.edges.length, 2);
});

// ============================================================================
// Test 3 — explain lists every sub-tap in requires[]
// ============================================================================

Deno.test("[safety/what] explain collects flat bill-of-materials via requires[]", async () => {
  // Why: requires[] is what doctor will walk when T7 (doctor-for-pipes)
  // lands. If explain drops a sub-tap or double-counts, doctor's
  // recursion is broken from day one.
  const pipe: Pipe = {
    steps: [
      { id: "a", run: ["github", "trending"], args: {} },
      { id: "b", run: ["github", "trending"], args: {} }, // duplicate ref
      { id: "c", run: ["hn", "top"], args: {} },
    ],
  };

  const flow = await explain(pipe, {}, {});
  // Duplicate (github/trending) appears once — this is a SET, not a log.
  assertEquals(flow.requires.sort(), ["github/trending", "hn/top"]);
});

// ============================================================================
// Test 4 — capabilities union across sub-taps
// ============================================================================

Deno.test("[safety/what] explain collects capabilities union across all sub-taps", async () => {
  await withFixtureDir(async (tapDir) => {
    const pipe: Pipe = {
      steps: [
        { id: "hot", run: ["reddit", "hot"], args: { subreddit: "rails" } },
        {
          id: "comments",
          run: ["reddit", "comments"],
          args: { postId: "xyz" },
        },
      ],
    };

    const flow = await explain(pipe, {}, { tapDirs: [tapDir] });
    // reddit/hot declares ["fetch"], reddit/comments declares ["nav","eval"].
    // Union sorted alphabetically.
    assertEquals(plan.capabilities, ["eval", "fetch", "nav"]);
  });
});

// ============================================================================
// Test 5 — missing required args → schemaWarnings
// ============================================================================

Deno.test("[safety/what] explain flags missing required args as schemaWarnings", async () => {
  await withFixtureDir(async (tapDir) => {
    const pipe: Pipe = {
      steps: [
        // Missing 'subreddit' — required by reddit/hot
        { id: "hot", run: ["reddit", "hot"], args: {} },
      ],
    };

    const flow = await explain(pipe, {}, { tapDirs: [tapDir] });
    assertEquals(plan.nodes[0].required, ["subreddit"]);
    assert(
      plan.schemaWarnings.some((w) => w.includes("subreddit")),
      `expected subreddit warning, got: ${plan.schemaWarnings.join(" | ")}`,
    );
  });
});

// ============================================================================
// Test 6 — unresolved $refs are collected, not thrown
// ============================================================================

Deno.test("[safety/what] explain flags unresolved $refs instead of throwing", async () => {
  // Why: runPipe throws "unknown step" — fine for execution. For explain,
  // the whole point is "surface problems for the linter / visualizer to
  // report ALL AT ONCE". A broken ref must become a flow field.
  const pipe: Pipe = {
    steps: [
      // $nonexistent is neither a step id nor $args
      { id: "a", run: ["t", "a"], args: { rows: "$nonexistent.rows" } },
    ],
  };

  const flow = await explain(pipe, {}, {});
  assertEquals(plan.unresolvedRefs.length, 1);
  assert(
    plan.unresolvedRefs[0].includes("nonexistent"),
    `expected 'nonexistent' in ${plan.unresolvedRefs[0]}`,
  );
  // The step still makes it into a round — an unresolved ref doesn't
  // block layering, because there's nothing real to wait on.
  assertEquals(plan.rounds, [["a"]]);
});

// ============================================================================
// Test 7 — rounds identify parallelizable steps correctly
// ============================================================================

Deno.test("[safety/what] explain rounds correctly identify parallel steps", async () => {
  // a and b are independent, c depends on both. Expected layering:
  //   round 0: [a, b]   (can run in parallel)
  //   round 1: [c]      (needs both a and b)
  const pipe: Pipe = {
    steps: [
      { id: "a", run: ["t", "a"], args: {} },
      { id: "b", run: ["t", "b"], args: {} },
      {
        id: "c",
        run: ["t", "c"],
        args: { x: "$a.rows", y: "$b.rows" },
      },
    ],
  };

  const flow = await explain(pipe, {}, {});
  assertEquals(plan.rounds.length, 2);
  assertEquals(plan.rounds[0], ["a", "b"]); // parallel pair
  assertEquals(plan.rounds[1], ["c"]);
  // Edges: two incoming to c, one from each of a,b
  assertEquals(plan.edges.length, 2);
  const toC = plan.edges.filter((e) => e.to === "c");
  assertEquals(toC.length, 2);
  assertEquals(toC.map((e) => e.from).sort(), ["a", "b"]);
});

// ============================================================================
// Test 8 — purity: same input, same output, no side effects
// ============================================================================

Deno.test("[principle/why] explain is a pure function — same input, same output", async () => {
  // Why: this is the whole value proposition of the dual. If explain
  // caches state, mutates args, or produces different plans on successive
  // calls, every downstream consumer (lint, doctor, AI validator) becomes
  // unreliable. Snapshot-equality of two separate calls locks in purity.
  await withFixtureDir(async (tapDir) => {
    const pipe: Pipe = {
      steps: [
        { id: "hot", run: ["reddit", "hot"], args: { subreddit: "python" } },
        { id: "top", run: ["transform", "top"], args: { rows: "$hot.rows", n: 3 } },
      ],
      return: "$top.rows",
    };
    const args = { dummy: "value" };

    const plan1 = await explain(pipe, args, { tapDirs: [tapDir] });
    const plan2 = await explain(pipe, args, { tapDirs: [tapDir] });

    // JSON equality — plain-data output, deterministic ordering.
    assertEquals(JSON.stringify(plan1), JSON.stringify(plan2));

    // And the inputs were not mutated.
    assertEquals(args, { dummy: "value" });
    assertEquals(pipe.steps.length, 2);
  });
});

// ============================================================================
// Test 9 — missing sub-tap on disk → schemaWarning, path=null, no throw
// ============================================================================

Deno.test("[safety/what] explain reports missing sub-taps without throwing", async () => {
  // Why: a partially-migrated repo may reference taps that don't exist
  // yet. explain must still return a complete flow for the parts that
  // DO exist, with the missing ones flagged for the author to fix.
  await withFixtureDir(async (tapDir) => {
    const pipe: Pipe = {
      steps: [
        { id: "hot", run: ["reddit", "hot"], args: { subreddit: "rails" } },
        { id: "missing", run: ["nonexistent", "tap"], args: {} },
      ],
    };

    const flow = await explain(pipe, {}, { tapDirs: [tapDir] });
    // The valid node resolved.
    assertEquals(plan.nodes[0].path !== null, true);
    // The missing node's path is null.
    assertEquals(plan.nodes[1].path, null);
    assertEquals(plan.nodes[1].capabilities, []);
    // A warning was recorded.
    assert(
      plan.schemaWarnings.some((w) =>
        w.includes("nonexistent/tap") && w.includes("not found")
      ),
      `expected 'not found' warning, got: ${plan.schemaWarnings.join(" | ")}`,
    );
  });
});

// ============================================================================
// Test 10 — argsResolved substitutes $args.* but preserves $step.* symbolically
// ============================================================================

Deno.test("[safety/what] explain resolves $args.* refs but leaves $step.* symbolic", async () => {
  // Why: $args.* can be resolved statically (we have the values in hand).
  // $step.field cannot — we'd need to run the upstream step. Keeping the
  // symbolic form in argsResolved is intentional: it tells visualizers
  // "this is a dataflow hook", not "this is undefined".
  const pipe: Pipe = {
    steps: [
      { id: "a", run: ["t", "a"], args: { subreddit: "$args.sub", limit: 10 } },
      {
        id: "b",
        run: ["t", "b"],
        args: { rows: "$a.rows", threshold: "$args.min" },
      },
    ],
  };

  const flow = await explain(pipe, { sub: "python", min: 5 }, {});
  // Step a: $args.sub → "python", literal 10 preserved
  assertEquals(plan.nodes[0].argsResolved.subreddit, "python");
  assertEquals(plan.nodes[0].argsResolved.limit, 10);
  // Step b: $a.rows stays symbolic, $args.min resolves to 5
  assertEquals(plan.nodes[1].argsResolved.rows, "$a.rows");
  assertEquals(plan.nodes[1].argsResolved.threshold, 5);
});

// ============================================================================
// Test 11 — explain() on a malformed pipe throws (fail-fast guard)
// ============================================================================

Deno.test("[safety/what] explain throws on pipes without a steps array", async () => {
  // Why: explain is forgiving on SEMANTIC issues (cycles, refs, missing
  // taps) because those are legitimate authoring states a linter must
  // report. But a missing 'steps' field isn't an authoring state — it's
  // an invalid input. Fail fast with a clear message.
  await assertRejects(
    () => explain({} as Pipe, {}, {}),
    Error,
    "steps",
  );
});
