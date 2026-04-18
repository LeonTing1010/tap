/**
 * Trace persistence — the disk side of the post-run dual.
 *
 * `runPipeWithTrace` produces in-memory PipeTrace objects. This module
 * gives them a home on disk at `~/.tap/traces/{run_id}.json` (or
 * `{run_id}.json.gz` when gzipped) so they survive the process that
 * produced them, letting:
 *
 *   - `tap.trace(run_id)` — AI agents read a trace minutes after the
 *     failing run via MCP, for retry-with-context loops
 *   - `tap trace` CLI — users inspect a recent failure without needing
 *     to re-run the pipe
 *   - Future: `tap trace diff run1 run2` for drift detection, and
 *     `tap trace compare explain.json trace.json` for the sandwich
 *
 * Design rules (mirroring appendLog's contract):
 *   1. Best-effort writes. Filesystem failures must never break the
 *      caller's tap.run. Wrap every write in try/catch, silent on error.
 *   2. Respects TAP_HOME env override — same resolution as tapHome() in
 *      cli.ts, so tests can redirect to a tmp dir without monkey-patching.
 *   3. 30-day retention matching tap.jsonl. Pruning runs at most once
 *      per day (check timestamp of last prune inline).
 *   4. JSON-per-file (not JSONL). One file per run means reads are O(1)
 *      given a run_id, and concurrent writes don't need locking.
 *   5. Filename = run_id. Run_id format = base36 timestamp + 6 hex chars.
 *      The timestamp prefix makes `ls -1` chronologically sorted for free.
 *   6. gzip past 50KB serialized. Rows persistence (per #20) can produce
 *      multi-KB payloads; auto-gzip keeps a 100-row reddit search at ~10KB
 *      on disk instead of ~50KB. Filename gains `.gz` suffix on compress.
 *      readTapTrace transparently picks the right one.
 *
 * What's NOT here (deliberately):
 *   - Full RPC-level trace embedding. That's already in TapResult.trace
 *     (via runTap's tracingSend). TapTrace is the pipe-level post-mortem;
 *     the RPC-level detail lives alongside in TapResult and can be
 *     stapled together at read time if both are needed.
 *   - Database / index. Flat files are enough for the volume involved.
 *     If someone ships 10k taps/day and needs query, add a SQLite index then.
 */

import type { PipeTrace } from "./pipe.ts";

/** gzip compression kicks in above this serialized size (in bytes). */
const GZIP_THRESHOLD_BYTES = 50 * 1024;
/** Default `auto` policy: persist all rows when JSON payload is below this. */
const AUTO_PERSIST_BYTES = 100 * 1024;
/** Default `auto` fallback when payload is too large: keep this many rows. */
const AUTO_SAMPLE_FALLBACK = 10;

/** Top-level trace written to disk for every runTap invocation. */
export interface TapTrace {
  /** Unique ID — timestamp-prefixed, see makeRunId(). */
  run_id: string;
  /** The tap that was run. */
  site: string;
  name: string;
  /** ISO timestamp. */
  started_at: string;
  /** ISO timestamp. */
  finished_at: string;
  /** Wall-clock duration from runTap start to end. */
  total_ms: number;
  /** "ok" when runTap returned normally, "error" when it threw. */
  status: "ok" | "error";
  /** Error message when status=error. */
  error?: string;
  /** Number of rows in the final TapResult. */
  rows_out?: number;
  /**
   * Pipe execution trace, present only when the tap was a pipe-only
   * tap (mod.pipe set, mod.tap absent) and runPipeWithTrace fired.
   * Leaf taps don't have a pipe trace — their per-call detail lives in
   * TapResult.trace (RPC-level) instead.
   */
  pipe?: PipeTrace;
  /** Top-level args the tap was called with. */
  args: Record<string, unknown>;
  /**
   * The rows the tap returned, persisted per the module's `persist_rows`
   * policy. May be partial (see `rows_truncated`). Absent when the
   * policy resolved to "never" or the tap had `intent: "write"`.
   */
  rows?: unknown[];
  /**
   * Set when `rows` is a sample rather than the full result. The
   * difference between `rows.length` and `total` tells the reader
   * how many rows were dropped.
   */
  rows_truncated?: { sampled: number; total: number; reason: "size" | "policy" };
}

/**
 * Decide what to persist into TapTrace.rows based on the module's
 * `persist_rows` field. Pure function — no I/O, no module mutation.
 *
 *   intent="write"          → never persist (PII safety)
 *   persist_rows="never"    → never persist
 *   persist_rows="always"   → full rows
 *   persist_rows="sample:N" → first N + total count
 *   persist_rows="auto"|undefined →
 *      full rows if JSON payload < 100KB,
 *      else first 10 rows + count
 */
export function applyPersistRowsPolicy(
  rows: unknown[],
  opts: { persist_rows?: string; intent?: "read" | "write" } = {},
): { rows?: unknown[]; rows_truncated?: { sampled: number; total: number; reason: "size" | "policy" } } {
  if (opts.intent === "write") return {};
  const policy = opts.persist_rows || "auto";
  if (policy === "never") return {};
  if (policy === "always") return { rows };

  const sampleMatch = /^sample:(\d+)$/.exec(policy);
  if (sampleMatch) {
    const n = Math.max(0, parseInt(sampleMatch[1], 10));
    if (rows.length <= n) return { rows };
    return {
      rows: rows.slice(0, n),
      rows_truncated: { sampled: n, total: rows.length, reason: "policy" },
    };
  }

  // policy === "auto" (default)
  let estimatedBytes: number;
  try {
    estimatedBytes = JSON.stringify(rows).length;
  } catch {
    estimatedBytes = Number.MAX_SAFE_INTEGER;
  }
  if (estimatedBytes < AUTO_PERSIST_BYTES) return { rows };
  if (rows.length <= AUTO_SAMPLE_FALLBACK) return { rows };
  return {
    rows: rows.slice(0, AUTO_SAMPLE_FALLBACK),
    rows_truncated: { sampled: AUTO_SAMPLE_FALLBACK, total: rows.length, reason: "size" },
  };
}

/**
 * Generate a unique run_id.
 *
 * Format: `{base36-timestamp}-{6-hex-chars}`
 * Example: `lmn4p2xc-a3f921`
 *
 * Why base36: shorter than decimal, still human-readable when debugging.
 * Why 6 hex chars: 16M uniqueness per millisecond is plenty.
 */
export function makeRunId(): string {
  const ts = Date.now().toString(36);
  const rand = Math.floor(Math.random() * 0xffffff).toString(16).padStart(6, "0");
  return `${ts}-${rand}`;
}

/**
 * Resolve the traces directory. Matches tapHome()'s behavior so tests
 * that set TAP_HOME=/tmp/x get a sandboxed trace location for free.
 */
function tracesDir(): string {
  const home = Deno.env.get("TAP_HOME") || `${Deno.env.get("HOME")}/.tap`;
  return `${home}/traces`;
}

// Internal counter — prune at most once per process to avoid thrashing.
let _lastPrune = 0;
const PRUNE_INTERVAL_MS = 24 * 60 * 60 * 1000; // once/day
const MAX_TRACE_AGE_MS = 30 * 24 * 60 * 60 * 1000; // 30-day retention

/**
 * Persist a TapTrace to disk. Best-effort — if the filesystem is
 * unwritable or TAP_HOME/HOME are unset, silently drops the write so
 * the caller's tap.run isn't broken by trace logging.
 *
 * Also runs a retention prune at most once per day per process.
 */
export async function writeTapTrace(trace: TapTrace): Promise<void> {
  try {
    const dir = tracesDir();
    await Deno.mkdir(dir, { recursive: true }).catch(() => {});
    const json = JSON.stringify(trace, null, 2);
    const bytes = new TextEncoder().encode(json);

    if (bytes.byteLength >= GZIP_THRESHOLD_BYTES) {
      const compressed = await gzipBytes(bytes);
      await Deno.writeFile(`${dir}/${trace.run_id}.json.gz`, compressed);
    } else {
      await Deno.writeFile(`${dir}/${trace.run_id}.json`, bytes);
    }

    // Best-effort prune. If the last prune was >24h ago, scan the dir
    // and delete anything older than 30 days. Awaited because a fire-and-
    // forget call leaks a live Deno.readDir iterator past the end of
    // runTap — Deno's test leak sanitizer flags it. The prune runs at
    // most once per day per process and touches one directory, so the
    // latency cost is negligible compared to the hot path (~50ms scan
    // on a well-pruned dir).
    const now = Date.now();
    if (now - _lastPrune > PRUNE_INTERVAL_MS) {
      _lastPrune = now;
      try {
        await pruneTapTraces(MAX_TRACE_AGE_MS);
      } catch { /* housekeeping is never load-bearing */ }
    }
  } catch {
    // Silent failure — trace persistence is observational, never load-bearing
  }
}

/**
 * Load a TapTrace by run_id. Transparently handles both `.json` and
 * `.json.gz` storage. Returns null if missing or unreadable.
 */
export async function readTapTrace(runId: string): Promise<TapTrace | null> {
  const dir = tracesDir();
  // Try uncompressed first (more common for small traces).
  try {
    const content = await Deno.readTextFile(`${dir}/${runId}.json`);
    return JSON.parse(content) as TapTrace;
  } catch { /* fall through to .gz */ }
  try {
    const compressed = await Deno.readFile(`${dir}/${runId}.json.gz`);
    const json = await gunzipToText(compressed);
    return JSON.parse(json) as TapTrace;
  } catch {
    return null;
  }
}

/**
 * gzip a byte buffer using Deno's CompressionStream. Returns a single
 * Uint8Array containing the gzipped output.
 */
async function gzipBytes(input: Uint8Array): Promise<Uint8Array> {
  const ab = input.buffer.slice(input.byteOffset, input.byteOffset + input.byteLength) as ArrayBuffer;
  const stream = new Blob([ab]).stream().pipeThrough(new CompressionStream("gzip"));
  const buf = await new Response(stream).arrayBuffer();
  return new Uint8Array(buf);
}

/** Inverse of gzipBytes — gunzip and decode as UTF-8 text. */
async function gunzipToText(input: Uint8Array): Promise<string> {
  const ab = input.buffer.slice(input.byteOffset, input.byteOffset + input.byteLength) as ArrayBuffer;
  const stream = new Blob([ab]).stream().pipeThrough(new DecompressionStream("gzip"));
  return await new Response(stream).text();
}

/**
 * List recent traces matching filter. Returns summaries sorted newest
 * first (run_id prefix is base36 timestamp, so lexical sort = chronological).
 *
 * @param opts.site    Only include traces for this site
 * @param opts.name    Only include traces for this tap name
 * @param opts.status  Only include "ok" or "error" traces
 * @param opts.since   ISO timestamp — only include traces newer than this
 * @param opts.limit   Max results to return (default 20)
 */
export async function listTapTraces(opts?: {
  site?: string;
  name?: string;
  status?: "ok" | "error";
  since?: string;
  limit?: number;
}): Promise<TapTrace[]> {
  const limit = opts?.limit ?? 20;
  const sinceMs = opts?.since ? Date.parse(opts.since) : 0;
  const results: TapTrace[] = [];

  try {
    const dir = tracesDir();
    const entries: string[] = [];
    for await (const entry of Deno.readDir(dir)) {
      if (!entry.isFile) continue;
      if (entry.name.endsWith(".json") || entry.name.endsWith(".json.gz")) {
        entries.push(entry.name);
      }
    }
    // Newest first — run_id prefix is base36 timestamp so lexical desc = chrono desc
    entries.sort((a, b) => b.localeCompare(a));

    for (const filename of entries) {
      if (results.length >= limit) break;
      try {
        let raw: string;
        if (filename.endsWith(".json.gz")) {
          const compressed = await Deno.readFile(`${dir}/${filename}`);
          raw = await gunzipToText(compressed);
        } else {
          raw = await Deno.readTextFile(`${dir}/${filename}`);
        }
        const trace = JSON.parse(raw) as TapTrace;
        // Apply filters
        if (opts?.site && trace.site !== opts.site) continue;
        if (opts?.name && trace.name !== opts.name) continue;
        if (opts?.status && trace.status !== opts.status) continue;
        if (sinceMs > 0 && Date.parse(trace.started_at) < sinceMs) continue;
        results.push(trace);
      } catch {
        // Skip corrupt / unreadable files silently
      }
    }
  } catch {
    // Dir missing = no traces yet
  }

  return results;
}

/**
 * Delete traces older than maxAgeMs. Called opportunistically from
 * writeTapTrace once per day. Exposed for tests and manual cleanup.
 */
export async function pruneTapTraces(maxAgeMs: number): Promise<number> {
  const cutoff = Date.now() - maxAgeMs;
  let deleted = 0;
  try {
    const dir = tracesDir();
    for await (const entry of Deno.readDir(dir)) {
      if (!entry.isFile) continue;
      if (!entry.name.endsWith(".json") && !entry.name.endsWith(".json.gz")) continue;
      try {
        // Parse the base36 timestamp prefix back to a number.
        const tsPart = entry.name.split("-")[0];
        const ts = parseInt(tsPart, 36);
        if (Number.isFinite(ts) && ts < cutoff) {
          await Deno.remove(`${dir}/${entry.name}`);
          deleted++;
        }
      } catch {
        // Skip unparseable names — don't delete what we can't verify is old
      }
    }
  } catch {
    // Dir missing = nothing to prune
  }
  return deleted;
}
