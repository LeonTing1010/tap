/**
 * @taprun/executor — the composition engine that powers Tap.
 *
 * Extracted from tap-core on 2026-04-11 so that products embedding Tap
 * (like Reddit Demand Kit) can run compiled pipes in-process instead of
 * spawning `tap` subprocesses. Self-contained: zero dependencies beyond
 * Deno std.
 *
 * Core exports:
 *   - runPipe(pipe, args, tapRun)     — execute a declarative DAG pipeline
 *   - runTap(mod, args, send, dirs?)  — load + execute a .tap.js module
 *   - loadTap(path)                    — import a .tap.js from disk
 *   - createTapHandle(send)            — build the Tap runtime handle
 *
 * Type exports:
 *   - Pipe, PipeStep, TapRun, RunCache
 *   - TapModule, TapArgSpec, TapHealthContract, TapFingerprint
 *   - ColumnSchema, ColumnDecl, TapResult, TraceStep
 *   - Tap (handle interface), RpcSend
 *
 * Helpers:
 *   - normalizeColumns, columnNames   — schema shape utilities
 *   - createRunCache, validateRequires — pipe plumbing
 *   - resolveIntent, checkHealth      — tap contract helpers
 *
 * Intentionally NOT exported:
 *   - sandbox runner (requires --unstable-worker-options + Deno Worker)
 *     → available as "./sandbox.ts" subpath import for sandboxed use
 *
 * Usage — run a pre-built pipe in-process, no subprocess:
 *
 *     import { runPipe, type Pipe } from "@taprun/executor";
 *
 *     const pipe: Pipe = {
 *       steps: [
 *         { id: "hot", run: ["reddit", "hot"], args: { subreddit: "sysadmin" } },
 *         { id: "top", run: ["tap", "limit"],  args: { rows: "$hot.rows", n: 5 } },
 *       ],
 *       return: "$top.rows",
 *     };
 *
 *     const tapRun = async (site, name, args) => {
 *       // Your implementation — subprocess, daemon RPC, whatever.
 *       return await mySubtapExecutor(site, name, args);
 *     };
 *
 *     const rows = await runPipe(pipe, {}, tapRun);
 */

// Pipe engine — the headline export. Most embedding consumers only need this.
export {
  createRunCache,
  runPipe,
  validateRequires,
} from "./src/pipe.ts";
export type {
  Pipe,
  PipeStep,
  RunCache,
  TapRun,
} from "./src/pipe.ts";

// Tap execution — load and run .tap.js files from disk.
export {
  appendLog,
  checkHealth,
  columnNames,
  detectCapabilities,
  listTaps,
  loadTap,
  normalizeColumns,
  resolveIntent,
  runTap,
} from "./src/executor.ts";
export type {
  ColumnDecl,
  ColumnSchema,
  TapArgSpec,
  TapFingerprint,
  TapHealthContract,
  TapModule,
  TapResult,
  TraceStep,
} from "./src/executor.ts";

// Runtime handle — for consumers that need to build a custom tap.* RPC bridge.
export { createTapHandle, SEMANTIC_ROLE_SNIPPET } from "./src/page.ts";
export type { RpcSend, Tap } from "./src/page.ts";
