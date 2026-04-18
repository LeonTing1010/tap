/**
 * Built-in pipe operations — atomic transforms that ship with the
 * executor instead of living as user-side .tap.js files.
 *
 * Why built-in: filter/sort/dedupe/pick/limit/table are language
 * primitives for `handle.pipe`, not user content. Shipping them as
 * editable .tap.js files in `~/.tap/taps/tap/` mixed system-level
 * pipeline ops with user-authored taps and required an `internal:
 * true` flag plus a tap.list filter to hide them. Moving them in-
 * tree:
 *   - Eliminates the system/user file mixing.
 *   - Makes the ops version-locked to the executor that runs them
 *     (no drift from a half-updated user fleet).
 *   - Removes ~6 file I/O calls per pipe step (in-process dispatch).
 *   - Unblocks deletion of the `internal` flag once the user-side
 *     files are gone.
 *
 * Backward compat: the pipe runner checks this registry FIRST, then
 * falls back to disk lookup. Existing user-side .tap.js copies of
 * these atomics keep working until they're removed; this registry
 * just shadows them with the built-in implementation.
 *
 * Each built-in:
 *   - Receives the resolved args dict (including upstream `rows`).
 *   - Returns a row array. The pipe runner wraps it as `{rows,
 *     columns, count}` for downstream consumption.
 *   - Is pure / synchronous / no I/O. Pipeline atomics never need
 *     network or filesystem.
 */

type Row = Record<string, unknown>;

/**
 * Signature shared by every built-in pipe op. Pure transformer:
 * upstream rows + args → downstream rows.
 */
export type PipeBuiltin = (rows: Row[], args: Record<string, unknown>) => Row[];

const filter: PipeBuiltin = (rows, args) => {
  const field = String(args.field ?? "");
  return rows.filter((r) => {
    const v = (r as Row)[field];
    if (args.gt !== undefined) return Number(v) > Number(args.gt);
    if (args.lt !== undefined) return Number(v) < Number(args.lt);
    if (args.eq !== undefined) return String(v) === String(args.eq);
    if (args.contains !== undefined) return String(v).includes(String(args.contains));
    return true;
  });
};

const sort: PipeBuiltin = (rows, args) => {
  const field = String(args.field ?? "");
  const dir = args.order === "asc" ? 1 : -1;
  return [...rows].sort((a, b) => {
    const va = (a as Row)[field];
    const vb = (b as Row)[field];
    const na = Number(va);
    const nb = Number(vb);
    if (!isNaN(na) && !isNaN(nb)) return (na - nb) * dir;
    return String(va).localeCompare(String(vb)) * dir;
  });
};

const dedupe: PipeBuiltin = (rows, args) => {
  const field = String(args.field ?? "");
  const seen = new Set<string>();
  return rows.filter((r) => {
    const key = String((r as Row)[field] ?? JSON.stringify(r));
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
};

const pick: PipeBuiltin = (rows, args) => {
  const keys = String(args.fields ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  return rows.map((r) => {
    const out: Row = {};
    for (const k of keys) if (k in (r as Row)) out[k] = (r as Row)[k];
    return out;
  });
};

const limit: PipeBuiltin = (rows, args) => {
  const offset = Number(args.offset ?? 0) || 0;
  const n = Number(args.n ?? 10) || 10;
  return rows.slice(offset, offset + n);
};

const table: PipeBuiltin = (rows, args) => {
  if (rows.length === 0) return [{ line: "(no rows)" }];
  const maxW = parseInt(String(args.max ?? "40"), 10) || 40;
  const cols = args.cols
    ? String(args.cols).split(",").map((s) => s.trim())
    : Object.keys(rows[0] as Row);
  const widths = cols.map((c) =>
    Math.min(
      maxW,
      Math.max(c.length, ...rows.map((r) => String((r as Row)[c] ?? "").length)),
    )
  );
  const pad = (s: unknown, w: number) => {
    const str = String(s);
    return str.length > w ? str.slice(0, w - 1) + "…" : str.padEnd(w);
  };
  const sep = "  ";
  const lines: Row[] = [];
  lines.push({ line: cols.map((c, i) => pad(c, widths[i])).join(sep) });
  lines.push({ line: cols.map((_, i) => "─".repeat(widths[i])).join(sep) });
  for (const r of rows) {
    lines.push({ line: cols.map((c, i) => pad((r as Row)[c] ?? "", widths[i])).join(sep) });
  }
  return lines;
};

/**
 * Closed registry of every built-in pipe op. Adding a new one extends
 * this object, and `PipeBuiltinName` (derived below) picks it up
 * automatically — no parallel list to maintain.
 */
export const PIPE_BUILTINS = {
  filter,
  sort,
  dedupe,
  pick,
  limit,
  table,
} as const satisfies Record<string, PipeBuiltin>;

/** Closed literal union of every built-in pipe op name. */
export type PipeBuiltinName = keyof typeof PIPE_BUILTINS;

/**
 * Type-narrowing predicate: true when (site, name) names a built-in pipe op.
 * Use this in the pipe runner to dispatch through the registry first
 * before falling back to disk-based sub-tap loading.
 */
export function isPipeBuiltin(site: string, name: string): name is PipeBuiltinName {
  return site === "tap" && name in PIPE_BUILTINS;
}
