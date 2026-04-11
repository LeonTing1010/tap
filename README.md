# @taprun/executor

The composition engine that powers [Tap](https://taprun.dev). Extracted so that products embedding Tap can run compiled pipelines in-process instead of spawning `tap` subprocesses.

Zero dependencies beyond Deno std. MIT. Self-contained.

## Install

```ts
// Deno (local path while this is pre-publish)
import { runPipe } from "../path/to/packages/executor/mod.ts";

// After JSR publish:
import { runPipe } from "jsr:@taprun/executor";
```

## Three modes of use

### 1. Run a compiled pipe in-process

The core value proposition: zero LLM tokens, zero subprocess fork, zero daemon dependency for pure-data pipelines.

```ts
import { runPipe, type Pipe } from "@taprun/executor";

const pipe: Pipe = {
  steps: [
    { id: "hot", run: ["reddit", "hot"],    args: { subreddit: "sysadmin", limit: 25 } },
    { id: "top", run: ["tap",    "limit"],  args: { rows: "$hot.rows", n: 10 } },
  ],
  return: "$top.rows",
};

// You provide the tapRun — it knows how to execute a sub-tap (via
// subprocess, in-process loadTap, or any other mechanism).
const tapRun = async (site: string, name: string, args: Record<string, unknown>) => {
  // Example: shell out to `tap <site> <name> --json`
  const cmd = new Deno.Command("tap", { args: [site, name, "--json", ...flatArgs(args)], stdout: "piped" });
  const { stdout } = await cmd.output();
  const rows = JSON.parse(new TextDecoder().decode(stdout));
  // runPipe expects { rows, count, ... } shape, not bare array
  return { rows, count: rows.length };
};

const topRows = await runPipe(pipe, {}, tapRun);
```

### 2. Load + run a `.tap.js` file from disk

```ts
import { loadTap, runTap, type RpcSend } from "@taprun/executor";

// RpcSend forwards tap.* primitive ops (nav, eval, click, etc.) to
// wherever your runtime lives — Chrome extension, Playwright, macOS AX.
const send: RpcSend = async (type, method, params) => {
  // Your runtime bridge implementation
  return await myRuntime.dispatch(method, params);
};

const mod = await loadTap("./my-tap.tap.js");
const result = await runTap(mod, { keyword: "foo" }, send, [".", "./skills"]);
console.log(result.rows);
```

### 3. Custom pipe scheduler

If you want the DAG engine but not the tap loader (e.g. for an entirely different execution substrate):

```ts
import { runPipe, createRunCache, validateRequires, type Pipe, type TapRun } from "@taprun/executor";

// Your executor; the engine just orchestrates the DAG.
const myRun: TapRun = async (site, name, args) => { ... };

await runPipe(pipeDefinition, pipeArgs, myRun);
```

## What's in the box

| Export | Purpose |
|---|---|
| `runPipe` | DAG scheduler + `$ref` resolver + run cache + cycle detection |
| `runTap` | Load a `.tap.js`, resolve args, wire `handle.run`/`handle.pipe`, call `mod.tap()` |
| `loadTap` | Dynamic import a `.tap.js` file with module caching |
| `createTapHandle` | Build a Tap proxy that sends every method call through `RpcSend` |
| `createRunCache` | Promise-sharing memo cache for duplicate sub-tap calls within a run |
| `validateRequires` | Check that a tap's `requires: string[]` sub-taps all exist on disk |
| `normalizeColumns` / `columnNames` | Column schema helpers |
| `resolveIntent` / `checkHealth` | Tap contract helpers |
| `appendLog` | Optional JSONL trace writer (no-op if filesystem isn't writable) |

## What's NOT in the box (and why)

- **Forge pipeline** (`forge.inspect`, `forge.verify`, `forge.save`) — that's Tap's compilation layer, not the engine. Stays in `tap-core`.
- **Doctor / heal / quality scoring** — product features, not engine primitives.
- **Daemon / HTTP bridge** — runtime distribution problem, separate concern.
- **Chrome extension runtime** — lives in the public [tap](https://github.com/LeonTing1010/tap) repo.

## Why extract this?

See the [blog post](https://taprun.dev/blog/rdk-compiled-pipes-from-llm-prompts.html) for the full story. Short version: RDK's compile pipeline was paying ~50ms subprocess fork overhead per sub-tap call because it had to shell out to the `tap` binary. Embedding this package directly eliminates that cost without giving up any of Tap's composition semantics.

## License

MIT.
