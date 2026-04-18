/**
 * Tap executor — dynamic loading + execution of .tap.js files.
 *
 * Tap executor — dynamic loading + execution. Taps are loaded via dynamic
 * import() from disk, executed with a tap handle, results normalized.
 */

import { createTapHandle, type RpcSend } from "./page.ts";
import { type Pipe, type PipeTrace, runPipeWithTrace } from "./pipe.ts";
import { runInSandbox } from "./sandbox.ts";
import { makeRunId, type TapTrace, writeTapTrace } from "./trace.ts";

export interface TapArgSpec {
  type: string;
  default?: unknown;
  required?: boolean;
  maxLength?: number;
  description?: string;
}

export interface TapHealthContract {
  min_rows?: number;
  non_empty?: string[];
  contains?: Record<string, string>;
  unique?: string[];
  max_ms?: number;
  url?: string;
  title?: string;
  visible?: string[];
  hidden?: string[];
  requires_auth?: boolean;
  /** Declarative property assertions — runtime validation of row data semantics.
   *  Each entry is a JS expression evaluated against each row. Examples:
   *    - "price >= 0" — numeric constraint
   *    - "url.startsWith('http')" — format check
   *    - "title.length > 0 && title.length <= 200" — length range
   *    - "status === 'active' || status === 'pending'" — enum constraint
   *  Returns { ok, issues } where issues describe which rows failed.
   */
  properties?: string[];
  /** Per-column numeric range constraints.
   *  Each key is a column name, value specifies min/max bounds (both optional).
   *  Example: { price: { min: 1, max: 50000 }, score: { min: 0, max: 100 } }
   */
  range?: Record<string, { min?: number; max?: number }>;
  /** Per-column regex pattern constraints.
   *  Each key is a column name, value is a regex string tested against every row.
   *  Example: { url: "^https://", date: "^\\d{4}-\\d{2}-\\d{2}$" }
   */
  pattern?: Record<string, string>;
  /** Cross-run value distribution drift detection.
   *  Each key is a column name, value is the max allowed % change in median vs baseline.
   *  Checked by doctor (requires cross-run history), not by checkHealth at runtime.
   *  Example: { price: 50 } — alert if median price changes >50% between runs.
   */
  drift?: Record<string, number>;
  /**
   * Cross-validate DOM-extracted values against the page's own JSON-LD structured data.
   * Each key is a column name from the tap's output, value is a JSON-LD path:
   *   "jsonld:Product.name"           — match against @type=Product, field name
   *   "jsonld:Product.offers.price"   — nested path
   *   "jsonld:Product.offers.availability" — e.g. "https://schema.org/InStock"
   * Checked by doctor (requires browser to read current JSON-LD from page).
   * Catches the hardest failure: valid-typed data from the wrong page element.
   */
  cross_validate?: Record<string, string>;
}

/** Structure fingerprint — captured at forge time, compared by doctor. */
export interface TapFingerprint {
  captured: string;    // ISO timestamp
  strategy: "dom" | "api" | "ssr" | "unknown";
  root_hash?: string;  // Merkle root — O(1) "did anything change?" check
  selectors?: Record<string, { count: number; sample_tag?: string; semantic_hash?: string; context_hash?: string }>;
  endpoints?: Array<{ url: string; status: number; shape_hash: string }>;
  globals?: Array<{ name: string; keys: string[] }>;
  json_ld_types?: string[];  // Schema.org @type values — SEO-driven, extremely stable
  /**
   * Full JSON-LD entity values — captured at forge time for cross-validation.
   * Keyed by "@type.field.path" (e.g. "Product.name", "Product.offers.price").
   * Sites maintain JSON-LD for Google rich snippets — changing it hurts SEO.
   * Doctor compares DOM-extracted values against these declared values.
   * All scalar values stored as strings; nested objects flattened with dot notation.
   */
  json_ld_values?: Record<string, string | null>;
  page?: { title_pattern: string; element_count_range: [number, number] };
  /**
   * Write actions discovered via forge.probe_actions (Phase B/C).
   * Populated only for write-intent taps that have been probed at least once.
   * Each entry is a (trigger, endpoint, body shape) tuple — drift in any of
   * these means the page's write surface changed and the tap may need re-forging.
   * Optional + additive: existing fingerprints without this field still validate.
   */
  write_actions?: Array<{
    trigger_text: string;        // Visible text or aria-label of the triggering element
    method: string;              // POST | PUT | PATCH | DELETE
    url_pattern: string;         // Endpoint URL with /\d+/ → /:id normalization
    body_keys: string[];         // Sorted top-level keys of the request body
    body_shape_hash: string;     // FNV-1a hash of the body's deep shape (stable across values)
  }>;
}

/**
 * Column schema for tap outputs. Used to declare the shape of result rows
 * so pipeline consumers can validate their input contract without running
 * the upstream tap first.
 *
 * Backwards compatible with the legacy `columns: string[]` form — a plain
 * string is treated as `{ name }` with no type info.
 */
export interface ColumnSchema {
  name: string;
  type?: "string" | "number" | "boolean" | "object" | "array";
  required?: boolean;
  description?: string;
}

/** Either legacy name-only or full schema. Mixed arrays are allowed. */
export type ColumnDecl = string | ColumnSchema;

/** Normalize a TapModule.columns value into an array of ColumnSchema objects. */
export function normalizeColumns(cols: ColumnDecl[] | undefined): ColumnSchema[] {
  if (!cols) return [];
  return cols.map(c => typeof c === "string" ? { name: c } : c);
}

/** Extract just the column names from either legacy or schema form. */
export function columnNames(cols: ColumnDecl[] | undefined): string[] {
  if (!cols) return [];
  return cols.map(c => typeof c === "string" ? c : c.name);
}

/**
 * Auto-detect which Tap handle methods a tap body calls, by regex-scanning
 * the source for `handle.X(` or `tap.X(` patterns.
 *
 * Populates TapModule.capabilities at forge.save time. Embedding products
 * (like RDK's runPipeInProcess) read this to statically decide whether
 * the current runtime can execute the tap — a capabilities: ["fetch"]
 * tap runs anywhere, capabilities: ["nav", "eval"] needs a browser-backed
 * RpcSend.
 *
 * Imperfect: won't catch destructured `const { nav } = handle; nav()` or
 * dynamic dispatch. Good enough for ~95% of hand-written tap code. For
 * the edge cases, authors can explicitly set the `capabilities` field.
 */
export function detectCapabilities(code: string): string[] {
  const METHODS = [
    // Core (8)
    "eval", "pointer", "keyboard", "nav", "wait", "screenshot", "run", "capabilities",
    // Built-in (20)
    "click", "type", "fill", "hover", "scroll", "pressKey", "select", "upload",
    "dialog", "fetch", "find", "cookies", "download", "waitFor", "waitForNetwork",
    "ssrState", "storage", "copyAll", "parseXML", "extract",
    // Composition
    "pipe", "invoke",
  ];
  const found = new Set<string>();
  for (const method of METHODS) {
    // Match `handle.method(` or `tap.method(`. Catches common variable
    // names, ignores method names buried inside longer identifiers like
    // `myhandle.navigate(` or `taps.click`.
    const pattern = new RegExp(`\\b(handle|tap)\\s*\\.\\s*${method}\\s*\\(`);
    if (pattern.test(code)) found.add(method);
  }
  return [...found].sort();
}

/**
 * Phase 1 — Web Annotation Migration. An authoring-time structural navigation
 * decision, persisted as an optional `target` field on a .tap.js module.
 *
 * The shape intentionally mirrors W3C Web Annotation Data Model's SpecificResource
 * so downstream phases can lift this into a full Annotation without reshuffling.
 * Executor treats it as opaque pass-through data — zero behavior change when
 * absent. See `shared.ts#resolveTarget` for normalization into the full
 * Annotation envelope.
 */
export interface TapTarget {
  /** The URL the selector chain resolves against. SHOULD be an absolute IRI. */
  source?: string;
  /**
   * Ordered selector chain (W3C Selectors and States §2).
   * First = outermost, may contain `refinedBy` for inner selectors.
   * Shape: { type: string|string[], value?: string, ... } | array thereof.
   * Full type: see core/src/annotation.ts Selector union.
   */
  selector?: Record<string, unknown> | Array<Record<string, unknown>>;
  /** Optional captured state (time / fingerprint) — populated by Phase 2. */
  state?: Record<string, unknown>;
  /** Open to tap-specific and prov:* extensions. */
  [k: string]: unknown;
}

export interface TapModule {
  site: string;
  name: string;
  description: string;
  /**
   * Phase 1 — optional W3C Annotation target. When present, forge picked
   * a specific structural source (API endpoint, JSON-LD, DOM node) to
   * compile from, and that decision is now first-class persisted metadata.
   * Legacy taps without this field run unchanged.
   */
  target?: TapTarget;
  runtime?: "extension" | "playwright" | "macos";
  app?: string;
  columns?: ColumnDecl[];
  /**
   * Sub-tap dependencies declared as "site/name" strings.
   * Validated at forge.save time — missing sub-taps reject the save so
   * broken composite taps never reach production.
   */
  requires?: string[];
  args?: Record<string, TapArgSpec>;
  examples?: Record<string, unknown>[];
  health?: TapHealthContract;
  fingerprint?: TapFingerprint;
  /**
   * Intent declaration — separates execution location from side-effect intent.
   *   "read"  (default) — no side effects, doctor runs automatically
   *   "write" — has side effects (post/delete/upload), doctor skips without --all
   */
  intent?: "read" | "write";
  /**
   * Unified tap entry point. Receives the tap handle (full tap.* API) and resolved args.
   * Single execution function — replaces the historical {extract, transform, run} split.
   */
  tap?: (handle: unknown, args: Record<string, unknown>) => Promise<unknown[]> | unknown[];
  /**
   * Static pipe declaration. When set, the tap IS the pipe — no tap() function
   * body, no arbitrary code, pure data flow. runTap auto-wraps this into a
   * tap() equivalent of `(h, _a) => h.pipe(mod.pipe)`.
   *
   * Benefits over inlining `handle.pipe({...})` inside a tap() function:
   *  - Sandbox can be skipped (no arbitrary code to isolate)
   *  - forge.save can statically validate every step's args against the
   *    declared schema of the sub-tap it calls
   *  - The pipe is introspectable without running (e.g. by `tap explain`)
   *  - AI generation writes less boilerplate — just the data structure
   */
  pipe?: Pipe;
  /**
   * Set of tap handle methods the tap body calls, auto-detected at
   * forge.save time via source scan. Consumed by embedding products
   * (like RDK's runPipeInProcess) to decide whether the current runtime
   * can actually execute this tap — a tap with capabilities: ["fetch"]
   * runs anywhere, one with capabilities: ["nav", "eval"] needs a
   * browser-backed RpcSend.
   */
  capabilities?: string[];
  cleanup?: (tap: unknown) => Promise<void>;
  url?: string | ((args: Record<string, unknown>) => string);
  waitFor?: string;
  timeout?: number;
  reuseTab?: boolean;
}

/**
 * Resolve effective intent for a tap module.
 * Default is read (safe-by-default for new tap shape).
 */
export function resolveIntent(mod: TapModule): "read" | "write" {
  return mod.intent ?? "read";
}

export interface TraceStep {
  method: string;
  params_summary: string;
  result_summary?: string;
  duration_ms: number;
  error?: string;
}

export interface TapResult {
  columns: string[];
  rows: Record<string, unknown>[];
  rawRows: Record<string, unknown>[];
  count: number;
  timing: {
    run_ms?: number;
    total_ms: number;
  };
  trace?: TraceStep[];
  /**
   * Pipe execution trace — one entry per sub-step when the tap is a pipe.
   * Absent for leaf taps. Structure: { nodes: PipeTraceNode[], rounds: string[][] }.
   * Use to localize failures in multi-stage pipes without re-running.
   */
  pipe?: PipeTrace;
  /**
   * Unique identifier for this run, emitted since 2026-04-11 with T_trace.
   * Present on every runTap invocation; `tap.trace(run_id)` looks up the
   * persisted TapTrace with the same id for post-mortem inspection.
   * Optional in the type only for backwards compat with pre-T_trace
   * consumers that literal-matched the result shape.
   */
  run_id?: string;
  /**
   * Phase 5 — W3C PROV lineage for the result.
   *
   * List of tap IRIs (format `tap:${site}/${name}`) in lineage order.
   * - Ancestors first, current tap last. When A → B → C, C's result carries
   *   `["tap:siteA/A", "tap:siteB/B", "tap:siteC/C"]`.
   * - Produced for every `runTap` invocation. `handle.run`/`handle.invoke`
   *   composition appends the sub-tap's chain. CLI stdin pipeline
   *   (`tap A | tap B`) prepends the upstream envelope's chain.
   * - Order-preserving dedupe — circular composition collapses to a single
   *   entry per tap.
   * - Optional in the type only so older consumers that literal-matched
   *   the result shape keep compiling.
   */
  "prov:wasDerivedFrom"?: string[];
  /** ISO 8601 UTC timestamp the result was produced. */
  "prov:generatedAtTime"?: string;
  /** Generator identifier: e.g. "tap-core/0.11.5". */
  "prov:generator"?: string;
}

// ─── Provenance helpers (Phase 5) ───────────────────────────────────

/**
 * Canonical IRI for a tap — same shape as Phase 1 annotation `id`. Kept
 * inside the executor package so it's usable without reaching across the
 * package boundary; re-exported from src/shared.ts for callers outside.
 */
export function makeTapIri(site: string, name: string): string {
  const s = site && site.length > 0 ? site : "_";
  const n = name && name.length > 0 ? name : "_";
  return `tap:${s}/${n}`;
}

/**
 * Order-preserving dedupe merge. First occurrence of any IRI wins, so
 * circular compositions (A → B → A) flatten to `[A, B]` instead of
 * `[A, B, A]`. Either arg may be undefined; result is always an array.
 */
export function appendProvenance(
  current: string[] | undefined,
  ancestor: string[] | undefined,
): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  const push = (iri: string) => {
    if (typeof iri !== "string" || iri.length === 0) return;
    if (seen.has(iri)) return;
    seen.add(iri);
    out.push(iri);
  };
  if (Array.isArray(current)) for (const iri of current) push(iri);
  if (Array.isArray(ancestor)) for (const iri of ancestor) push(iri);
  return out;
}

/**
 * Phase 5 generator identifier. Reads TAP_VERSION env var at call time so
 * the executor doesn't have to import cli.ts's VERSION constant (which
 * would create a cycle). CLI / MCP set this once at startup.
 */
function tapProvGenerator(): string {
  const v = (typeof Deno !== "undefined" && Deno.env?.get)
    ? (Deno.env.get("TAP_VERSION") || "")
    : "";
  return v ? `tap-core/${v}` : "tap-core";
}

function summarize(s: string, max: number): string {
  if (!s || s.length <= max) return s || "";
  return s.slice(0, max) + "...";
}

/** Parse a string literal ('...' or "...") and return its contents, or null. */
function parseStringLiteral(s: string): string | null {
  const m = s.match(/^["'](.*)["']$/);
  return m ? m[1] : null;
}

/** Simple expression interpreter for health.properties — no eval/Function, zero injection risk.
 *  Supports: "field > 0", "field.length > 0", "field !== ''",
 *            "field.startsWith('x')", "field.includes('x')", "field.endsWith('x')" */
function safeEvalExpr(expr: string, row: Record<string, unknown>): boolean | null {
  const e = expr.trim();

  // Pattern 1: field.method('arg') — returns boolean directly
  const methodMatch = e.match(/^(\w+)\.(startsWith|endsWith|includes)\((.+)\)$/);
  if (methodMatch) {
    const [, field, method, argRaw] = methodMatch;
    if (!(field in row) || typeof row[field] !== "string") return null;
    const arg = parseStringLiteral(argRaw.trim());
    if (arg === null) return null;
    const val = row[field] as string;
    if (method === "startsWith") return val.startsWith(arg);
    if (method === "endsWith") return val.endsWith(arg);
    if (method === "includes") return val.includes(arg);
  }

  // Pattern 2: field(.prop)? op value — comparison
  const cmpMatch = e.match(/^(\w+)(?:\.(\w+))?\s*(>=|<=|===|!==|>|<)\s*(.+)$/);
  if (!cmpMatch) return null;
  const [, field, prop, op, rhsRaw] = cmpMatch;
  if (!(field in row)) return null;
  let lhs: unknown = row[field];
  if (prop) {
    if (prop === "length" && (typeof lhs === "string" || Array.isArray(lhs))) lhs = lhs.length;
    else return null;
  }
  const rhs = rhsRaw.trim();
  let right: unknown;
  if (rhs === "''" || rhs === '""') right = "";
  else if (rhs === "null") right = null;
  else if (rhs === "true") right = true;
  else if (rhs === "false") right = false;
  else if (/^-?\d+(\.\d+)?$/.test(rhs)) right = Number(rhs);
  else { const s = parseStringLiteral(rhs); if (s !== null) right = s; else return null; }
  switch (op) {
    case ">": return (lhs as number) > (right as number);
    case ">=": return (lhs as number) >= (right as number);
    case "<": return (lhs as number) < (right as number);
    case "<=": return (lhs as number) <= (right as number);
    case "===": return lhs === right;
    case "!==": return lhs !== right;
  }
  return null;
}

/** Check a tap result against its health contract. Always returns a Promise. */
export async function checkHealth(
  tap: TapModule,
  result: TapResult,
  send?: RpcSend,
): Promise<{ ok: boolean; issues: string[] }> {
  const issues: string[] = [];
  if (!tap.health) return { ok: true, issues };
  if (tap.health.min_rows && result.count < tap.health.min_rows) {
    issues.push(`min_rows: expected ${tap.health.min_rows}, got ${result.count}`);
  }
  if (tap.health.non_empty && result.rows.length > 0) {
    for (const col of tap.health.non_empty) {
      const empty = result.rows.filter(r => !r[col] || r[col] === "");
      if (empty.length > 0) {
        issues.push(`non_empty: ${empty.length}/${result.rows.length} rows have empty "${col}"`);
      }
    }
  }
  if (tap.health.contains) {
    for (const [col, value] of Object.entries(tap.health.contains)) {
      const found = result.rows.some(r => r[col] === value);
      if (!found) {
        issues.push(`contains: no row has "${col}" matching "${value}"`);
      }
    }
  }
  if (tap.health.unique) {
    for (const col of tap.health.unique) {
      const values = result.rows.map(r => r[col]);
      const uniqueValues = new Set(values);
      if (uniqueValues.size < values.length) {
        issues.push(`unique: column "${col}" has duplicate values`);
      }
    }
  }
  if (tap.health.max_ms !== undefined && result.timing.total_ms > tap.health.max_ms) {
    issues.push(`max_ms: expected <= ${tap.health.max_ms}ms, got ${result.timing.total_ms}ms`);
  }
  // Property assertions — each expression evaluated safely against each row
  if (tap.health.properties && result.rows.length > 0) {
    for (const expr of tap.health.properties) {
      const failures: number[] = [];
      for (let i = 0; i < result.rows.length; i++) {
        const row = result.rows[i];
        const result_val = safeEvalExpr(expr, row);
        if (result_val === null) {
          issues.push(`properties: expression "${expr}" is not allowed or failed to evaluate`);
          break;
        }
        if (!result_val) failures.push(i);
      }
      if (failures.length > 0) {
        const sample = failures.slice(0, 3).map(i => {
          const r = result.rows[i];
          return JSON.stringify(r).slice(0, 50);
        });
        issues.push(`properties: "${expr}" failed on ${failures.length}/${result.rows.length} rows (sample: ${sample.join(", ")})`);
      }
    }
  }
  // Range constraints — per-column numeric bounds
  if (tap.health.range && result.rows.length > 0) {
    for (const [col, bounds] of Object.entries(tap.health.range)) {
      let outOfRange = 0;
      for (const row of result.rows) {
        if (row[col] == null) continue;  // skip null/undefined — missing data, not out-of-range
        const val = Number(row[col]);
        if (Number.isNaN(val)) continue;  // skip non-numeric (e.g. "N/A")
        if (bounds.min !== undefined && val < bounds.min) outOfRange++;
        else if (bounds.max !== undefined && val > bounds.max) outOfRange++;
      }
      if (outOfRange > 0) {
        const label = `[${bounds.min ?? "-∞"}, ${bounds.max ?? "∞"}]`;
        issues.push(`range: "${col}" value outside ${label} in ${outOfRange}/${result.rows.length} rows`);
      }
    }
  }
  // Pattern constraints — per-column regex validation
  if (tap.health.pattern && result.rows.length > 0) {
    for (const [col, regexStr] of Object.entries(tap.health.pattern)) {
      try {
        const re = new RegExp(regexStr);
        let failures = 0;
        for (const row of result.rows) {
          const val = row[col];
          if (val === undefined || val === null) { failures++; continue; }
          if (!re.test(String(val))) failures++;
        }
        if (failures > 0) {
          issues.push(`pattern: "${col}" failed regex /${regexStr}/ in ${failures}/${result.rows.length} rows`);
        }
      } catch {
        issues.push(`pattern: "${col}" has invalid regex "${regexStr}"`);
      }
    }
  }
  // drift checked by doctor, not here — requires cross-run history
  // Async checks
  if (send && tap.health.url) {
    const href = await send("tool", "tap.eval", { expression: "location.href" }) as string;
    if (!href || !href.includes(tap.health.url)) {
      issues.push(`url: expected URL to include "${tap.health.url}", got "${href}"`);
    }
  }
  if (send && tap.health.visible) {
    for (const selector of tap.health.visible) {
      const vis = await send("tool", "tap.eval", { expression: `!!document.querySelector('${selector}')` });
      if (!vis) {
        issues.push(`visible: selector "${selector}" is not visible`);
      }
    }
  }
  // Cross-validate: compare DOM-extracted values against page's JSON-LD declarations
  // Catches "valid type, wrong source" — the hardest silent failure mode.
  if (send && tap.health.cross_validate && result.rows.length > 0) {
    try {
      const ldValues = await send("tool", "tap.eval", { expression: `(() => {
        const vals = {}
        function flatten(obj, prefix) {
          if (obj == null) return
          if (typeof obj !== 'object') { vals[prefix] = String(obj); return }
          if (Array.isArray(obj)) { if (obj.length <= 10) obj.forEach((v, i) => flatten(v, prefix + '.' + i)); return }
          for (const [k, v] of Object.entries(obj)) {
            if (k === '@context' || k === '@type') continue
            flatten(v, prefix + '.' + k)
          }
        }
        document.querySelectorAll('script[type="application/ld+json"]').forEach(s => {
          try { const d = JSON.parse(s.textContent); const es = d['@graph'] || [d]; es.forEach(e => { const t = e['@type']; if (t && t !== 'BreadcrumbList') flatten(e, String(t)) }) } catch {}
        })
        return vals
      })()` }) as Record<string, string> | null;
      if (ldValues && Object.keys(ldValues).length > 0) {
        for (const [col, ldPath] of Object.entries(tap.health.cross_validate)) {
          // Parse "jsonld:Product.name" → "Product.name"
          const path = ldPath.startsWith("jsonld:") ? ldPath.slice(7) : ldPath;
          const declaredValue = ldValues[path];
          if (declaredValue === undefined) continue; // JSON-LD doesn't have this field — skip
          // Check first row's value against JSON-LD declared value
          const domValue = String(result.rows[0][col] ?? "").trim();
          const ldTrimmed = declaredValue.trim();
          if (domValue && ldTrimmed && !domValue.includes(ldTrimmed) && !ldTrimmed.includes(domValue)) {
            issues.push(`cross_validate: "${col}" value "${domValue}" does not match ${ldPath} "${ldTrimmed}"`);
          }
        }
      }
    } catch { /* best-effort — page may not have JSON-LD */ }
  }
  return { ok: issues.length === 0, issues };
}

/** Cache for loaded tap modules — evicts oldest entries when capacity is reached.
 *  Prevents unbounded module registry growth from repeated dynamic import() calls. */
const tapCache = new Map<string, { mod: TapModule; mtime: number }>();
const TAP_CACHE_MAX_SIZE = 100;

/** Load a single .tap.js from disk via dynamic import. */
export async function loadTap(path: string): Promise<TapModule> {
  // Cache-bust with mtime so tap edits are picked up without daemon restart
  const stat = await Deno.stat(path).catch(() => null);
  const mtime = stat?.mtime?.getTime() ?? Date.now();

  // Check cache — return cached module if file hasn't changed
  const cached = tapCache.get(path);
  if (cached && cached.mtime === mtime) return cached.mod;

  // Evict oldest entries if cache is full
  if (tapCache.size >= TAP_CACHE_MAX_SIZE) {
    const firstKey = tapCache.keys().next().value;
    if (firstKey !== undefined) tapCache.delete(firstKey);
  }

  // Convert to file:// URL for Deno import
  const base = path.startsWith("file://") ? path : `file://${path}`;
  const url = `${base}?t=${mtime}`;
  const mod = await import(url);
  const tap = mod.default;
  if (!tap || !tap.site || !tap.name) {
    throw new Error(`Invalid tap at ${path}: missing site or name`);
  }
  // Read the unified per-tap manifest (.jsonld) for the fingerprint. The manifest
  // also carries Schema.org public surface (provider, action, item list) for external
  // consumers, but doctor's runtime contract is tap.health — manifest schema fields
  // are documentation for outside tools, not an internal validation source.
  if (!tap.fingerprint) {
    const manifestPath = path.replace(/\.tap\.js$/, ".jsonld");
    try {
      const manifest = JSON.parse(await Deno.readTextFile(manifestPath)) as Record<string, unknown>;
      const fp = manifest["tap:fingerprint"] as Record<string, unknown> | undefined;
      if (fp) {
        tap.fingerprint = parseTapFingerprintFromJsonLd(fp);
      }
    } catch { /* no manifest — pre-migration tap, runs without enriched metadata */ }
  }

  // Cache the loaded module
  tapCache.set(path, { mod: tap as TapModule, mtime });

  return tap as TapModule;
}

/** Parse a JSON-LD `tap:fingerprint` blob back into the internal TapFingerprint shape. */
function parseTapFingerprintFromJsonLd(fp: Record<string, unknown>): TapFingerprint {
  const out: TapFingerprint = {
    captured: (fp["tap:capturedAt"] as string) || new Date().toISOString(),
    strategy: ((fp["tap:strategy"] as string) || "tap:unknown").replace(/^tap:/, "") as TapFingerprint["strategy"],
    root_hash: fp["tap:rootHash"] as string | undefined,
  };
  const sels = fp["tap:selectors"] as Array<Record<string, unknown>> | undefined;
  if (sels && sels.length > 0) {
    out.selectors = {};
    for (const s of sels) {
      const css = s["tap:css"] as string;
      if (!css) continue;
      out.selectors[css] = {
        count: (s["tap:count"] as number) ?? 0,
        ...(s["tap:semanticHash"] ? { semantic_hash: s["tap:semanticHash"] as string } : {}),
      };
    }
  }
  const eps = fp["tap:endpoints"] as Array<Record<string, unknown>> | undefined;
  if (eps && eps.length > 0) {
    out.endpoints = eps.map(e => ({
      url: e["tap:url"] as string,
      status: (e["tap:status"] as number) ?? 0,
      shape_hash: (e["tap:shapeHash"] as string) ?? "",
    }));
  }
  const globs = fp["tap:globals"] as Array<Record<string, unknown>> | undefined;
  if (globs && globs.length > 0) {
    out.globals = globs.map(g => ({
      name: g["tap:name"] as string,
      keys: (g["tap:keys"] as string[]) ?? [],
    }));
  }
  return out;
}

/** Discover all .tap.js files in directories.
 *  Dirs are searched in order — first match wins (user taps override skills). */
export async function listTaps(dirs: string[]): Promise<TapModule[]> {
  const seen = new Set<string>();
  const taps: TapModule[] = [];
  for (const dir of dirs) {
    try {
      for await (const siteEntry of Deno.readDir(dir)) {
        if (!siteEntry.isDirectory) continue;
        const sitePath = `${dir}/${siteEntry.name}`;
        for await (const fileEntry of Deno.readDir(sitePath)) {
          if (!fileEntry.name.endsWith(".tap.js")) continue;
          try {
            const tap = await loadTap(`${sitePath}/${fileEntry.name}`);
            const key = `${tap.site}/${tap.name}`;
            if (seen.has(key)) continue; // user tap already registered
            seen.add(key);
            taps.push(tap);
          } catch {
            // Skip invalid taps
          }
        }
      }
    } catch {
      // Skip missing directories
    }
  }
  return taps.sort((a, b) =>
    `${a.site}/${a.name}`.localeCompare(`${b.site}/${b.name}`)
  );
}

/** Append a log entry to ~/.tap/logs/tap.jsonl. Auto-rotates: keeps last 30 days. */
let _lastRotation = 0;
const ROTATION_INTERVAL_MS = 24 * 60 * 60 * 1000; // check once per day
const MAX_LOG_AGE_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

export async function appendLog(entry: Record<string, unknown>): Promise<void> {
  try {
    const home = Deno.env.get("TAP_HOME") || `${Deno.env.get("HOME")}/.tap`;
    const dir = `${home}/logs`;
    await Deno.mkdir(dir, { recursive: true }).catch(() => {});
    const logPath = `${dir}/tap.jsonl`;
    const now = Date.now();
    const line = JSON.stringify({ ...entry, ts: now }) + "\n";
    await Deno.writeTextFile(logPath, line, { append: true });
    // Rotate: prune old entries once per day
    if (now - _lastRotation > ROTATION_INTERVAL_MS) {
      _lastRotation = now;
      try {
        const content = await Deno.readTextFile(logPath);
        const cutoff = now - MAX_LOG_AGE_MS;
        const kept = content.split("\n").filter((l: string) => {
          if (!l) return false;
          try { return (JSON.parse(l).ts || 0) > cutoff; } catch { return false; }
        });
        await Deno.writeTextFile(logPath, kept.join("\n") + "\n");
      } catch { /* rotation is best-effort */ }
    }
  } catch { /* logging must never break execution */ }
}

/** Run a tap with a tap handle, normalize results. */
export async function runTap(
  mod: TapModule,
  args: Record<string, unknown>,
  send: RpcSend,
  tapDirs?: string[],
  opts?: { sessionId?: string; tapPath?: string; sandbox?: boolean },
): Promise<TapResult> {
  // Tab identity is managed by SessionManager in the extension.
  // Executor does not track tabId — session routing is handled by createSessionSend.

  // Trace collection: record every RPC call for Meta-Forge history
  const traceSteps: TraceStep[] = [];
  const tracingSend: RpcSend = async (type: string, method: string, params: Record<string, unknown>) => {
    const t0 = performance.now();
    try {
      const result = await send(type, method, params);
      traceSteps.push({
        method,
        params_summary: summarize(JSON.stringify(params), 200),
        result_summary: summarize(JSON.stringify(result), 500),
        duration_ms: Math.round(performance.now() - t0),
      });
      return result;
    } catch (e) {
      traceSteps.push({
        method,
        params_summary: summarize(JSON.stringify(params), 200),
        duration_ms: Math.round(performance.now() - t0),
        error: String(e).slice(0, 200),
      });
      throw e;
    }
  };

  const tap = createTapHandle(tracingSend);
  const start = performance.now();

  // T_trace: assign a unique run_id for this invocation so callers can
  // later look up the persisted TapTrace via tap.trace(run_id). Generated
  // unconditionally because it's free; persistence is best-effort and
  // silently no-ops if the filesystem isn't writable.
  const runId = makeRunId();
  const runStartedAt = new Date().toISOString();

  // Sub-tap resolution helper shared by tap.run and tap.invoke. Walks the
  // configured tapDirs in order, returns the first matching path, throws if
  // no candidate exists. Extracted so run/invoke stay trivial wrappers.
  const resolveSubTap = async (site: string, name: string): Promise<string> => {
    if (!tapDirs) throw new Error(`tap not found: ${site}/${name} (no tapDirs configured)`);
    for (const dir of tapDirs) {
      const p = `${dir}/${site}/${name}.tap.js`;
      try { await Deno.stat(p); return p; } catch { /* next dir */ }
    }
    throw new Error(`tap not found: ${site}/${name}`);
  };

  // Phase 5 — accumulate prov:wasDerivedFrom from every sub-run the tap body
  // performs via handle.run / handle.invoke. The current tap's own IRI is
  // appended last (below, at result construction). Chain rule: ancestors
  // first, most-recent derivation appended after them. Deduplicated in
  // order so circular composition (A → B → A) collapses to [A, B].
  //
  // Initial seed: incoming args may carry a prov chain from an upstream
  // source — e.g. the CLI Unix pipeline `tap A | tap B` reads A's envelope
  // from stdin and threads its `prov:wasDerivedFrom` into B's args. Same
  // shape, same semantics: ancestors come before the current tap's IRI.
  const incomingProv = Array.isArray((args as Record<string, unknown>)["prov:wasDerivedFrom"])
    ? (args as Record<string, unknown>)["prov:wasDerivedFrom"] as string[]
    : undefined;
  let subProvenance: string[] = incomingProv ? appendProvenance([], incomingProv) : [];

  // Wire tap.run() for composition — legacy API returning just .rows, kept
  // so every existing composite tap (many taps written before 2026-04-11)
  // keeps working unchanged. New compositional code should prefer
  // tap.invoke(), which returns the full TapResult.
  if (tapDirs) {
    tap.run = async (site: string, name: string, subArgs: Record<string, unknown> = {}) => {
      const tapPath = await resolveSubTap(site, name);
      const subMod = await loadTap(tapPath);
      const result = await runTap(subMod, subArgs, send, tapDirs);
      // Phase 5 — absorb the sub-run's full chain (ancestors + sub itself)
      // into this tap's accumulator. Sub's chain already ends with its own
      // IRI; appending works whether this tap has called run() 0, 1, or N
      // times before.
      subProvenance = appendProvenance(subProvenance, result["prov:wasDerivedFrom"]);
      return result.rows;
    };

    // Wire tap.invoke() — the compositional alternative. Returns the full
    // TapResult so callers can access .rows, .columns, .count, .rawRows,
    // and .timing without a second query. This is what tap.pipe uses
    // internally; exposing it to tap authors lets them write imperative
    // compositions that still get the full result shape.
    tap.invoke = async (site: string, name: string, subArgs: Record<string, unknown> = {}) => {
      const tapPath = await resolveSubTap(site, name);
      const subMod = await loadTap(tapPath);
      const result = await runTap(subMod, subArgs, send, tapDirs);
      subProvenance = appendProvenance(subProvenance, result["prov:wasDerivedFrom"]);
      return result;
    };
  }

  // Resolve args with defaults + validate constraints
  const resolvedArgs: Record<string, unknown> = { ...args };
  if (mod.args) {
    const argEntries: [string, Record<string, unknown>][] = Array.isArray(mod.args)
      ? mod.args.map((spec: Record<string, unknown>) => [spec.name as string, spec])
      : Object.entries(mod.args) as unknown as [string, Record<string, unknown>][];
    for (const [key, spec] of argEntries) {
      if (resolvedArgs[key] === undefined && spec.default !== undefined) {
        resolvedArgs[key] = spec.default;
      }
      // Validate required
      if (spec.required && (resolvedArgs[key] === undefined || resolvedArgs[key] === '')) {
        throw new Error(`${mod.site}/${mod.name}: required arg "${key}" is missing`);
      }
      // Validate maxLength
      if (spec.maxLength && typeof resolvedArgs[key] === 'string') {
        const val = resolvedArgs[key] as string;
        if (val.length > (spec.maxLength as number)) {
          throw new Error(
            `${mod.site}/${mod.name}: arg "${key}" is ${val.length} chars, max ${spec.maxLength}`
          );
        }
      }
    }
  }

  // Wire tap.pipe() — declarative composition DSL. Uses the parent tap's
  // resolvedArgs as the $args.* binding context. Needs tapDirs to resolve
  // sub-tap paths; throws a clear error otherwise.
  //
  // T_trace: capture the PipeTrace from runPipeWithTrace into a closure
  // variable so the enclosing runTap call can persist it alongside the
  // top-level TapTrace metadata. If a tap calls handle.pipe() multiple
  // times (unusual but legal), only the LAST call's trace survives —
  // v0.1 accepts this rather than threading a list. Most pipe-only
  // taps call pipe() exactly once at the top level anyway.
  let capturedPipeTrace: PipeTrace | null = null;
  if (tapDirs) {
    tap.pipe = async (pipe: unknown) => {
      const pipeRun = async (site: string, name: string, subArgs: Record<string, unknown>) => {
        let tapPath = "";
        for (const dir of tapDirs) {
          const p = `${dir}/${site}/${name}.tap.js`;
          try { await Deno.stat(p); tapPath = p; break; } catch { /* next */ }
        }
        if (!tapPath) throw new Error(`tap not found: ${site}/${name}`);
        const subMod = await loadTap(tapPath);
        // Return the FULL TapResult so $step.rows, $step.columns, $step.count
        // all work from the pipe's reference binding layer.
        const r = await runTap(subMod, subArgs, send, tapDirs);
        // Phase 5 — every pipe step is a sub-run for lineage purposes.
        subProvenance = appendProvenance(subProvenance, r["prov:wasDerivedFrom"]);
        return r;
      };
      const { result, trace: pipeTrace } = await runPipeWithTrace(
        pipe as Pipe,
        resolvedArgs,
        pipeRun,
      );
      capturedPipeTrace = pipeTrace;
      return result;
    };
  } else {
    tap.pipe = () => {
      throw new Error("tap.pipe requires tapDirs to be configured for sub-tap loading");
    };
  }

  // Resolve the tap function. Three cases in order of priority:
  //   1. Explicit mod.tap — user-authored function body (imperative taps)
  //   2. Static mod.pipe — synthesize a tap function that forwards to
  //      handle.pipe. Pipe-only taps don't need arbitrary code; the DSL
  //      is declarative data, which is why sandbox (below) can be skipped
  //      for this case.
  //   3. Neither set — invalid, throw.
  //
  // `isPipeOnly` is used below to decide whether the sandbox Worker runs
  // (Tension 3: pipe-only taps are pure data flow, sandboxing them adds
  // overhead for zero isolation benefit — sub-taps called by the pipe
  // executor still get their own sandbox decisions based on their own
  // module shape).
  const isPipeOnly = !mod.tap && !!mod.pipe;
  const tapFn: TapModule["tap"] = mod.tap
    ? mod.tap
    : mod.pipe
      ? (handle, _args) => {
          const h = handle as { pipe?: (p: unknown) => Promise<unknown> };
          if (!h.pipe) {
            throw new Error(`pipe-only tap ${mod.site}/${mod.name} needs a tap handle with .pipe() method (configure tapDirs)`);
          }
          return h.pipe(mod.pipe!) as Promise<unknown[]>;
        }
      : undefined;

  let rawRows: unknown[];
  try {
    if (!tapFn) {
      throw new Error(`Tap ${mod.site}/${mod.name} must define a tap(handle, args) function OR a pipe: {...} declaration`);
    }
    // Sandbox: run in isolated Deno Worker with zero permissions.
    // Tap code can only call tap.* via message passing — no filesystem, no network.
    //
    // EXCEPTION: pipe-only taps skip the sandbox. The tap body has no
    // arbitrary code — it's just `handle.pipe(mod.pipe)`. The real
    // isolation happens per sub-tap inside the pipe executor, not here.
    //
    // For imperative-with-pipe taps (mod.tap() that internally calls
    // handle.pipe({...})), we route handle.pipe through a localPipe
    // handler so the sandbox worker can compose sub-taps via the real
    // executor closure. Without this, handle.pipe would be forwarded as
    // an RPC call to the daemon, which has no handler for it — that was
    // the "operation 'pipe' is restricted" wall that blocked every
    // imperative-with-pipe tap running through the CLI subprocess path.
    if (opts?.sandbox !== false && opts?.tapPath && !isPipeOnly) {
      // Only expose local pipe composition when tapDirs is configured.
      // Without tapDirs, tap.pipe throws a clear error anyway, so the
      // sandbox's default rejection message is more informative.
      const localPipe = tapDirs
        ? (pipe: unknown) => (tap.pipe as (p: unknown) => Promise<unknown>)(pipe)
        : undefined;
      rawRows = (await runInSandbox(
        opts.tapPath,
        resolvedArgs,
        tracingSend,
        localPipe,
      )) as unknown[];
    } else {
      rawRows = (await tapFn.call(mod, tap, resolvedArgs)) as unknown[];
    }
    // Apply limit if specified (formerly extract-format-only)
    if (Array.isArray(rawRows) && resolvedArgs.limit) {
      rawRows = rawRows.slice(0, resolvedArgs.limit as number);
    }
  } catch (e) {
    // Run cleanup even on error — guaranteed lifecycle
    if (mod.cleanup) {
      try { await mod.cleanup(tap); } catch { /* cleanup must not break execution */ }
    }
    const totalMs = Math.round(performance.now() - start);
    await appendLog({
      event: "run", site: mod.site, name: mod.name,
      run_id: runId,
      ms: totalMs, rows: 0, error: String(e),
      ...(opts?.sessionId && { sid: opts.sessionId }),
    });
    // T_trace: persist the trace on error so post-mortem tooling sees
    // the failure. If the pipe crashed mid-run, capturedPipeTrace has
    // whatever rounds completed before the throw — crucial debugging data.
    const errorTrace: TapTrace = {
      run_id: runId,
      site: mod.site,
      name: mod.name,
      started_at: runStartedAt,
      finished_at: new Date().toISOString(),
      total_ms: totalMs,
      status: "error",
      error: e instanceof Error ? e.message : String(e),
      args: resolvedArgs,
      ...(capturedPipeTrace ? { pipe: capturedPipeTrace } : {}),
    };
    await writeTapTrace(errorTrace);
    throw e;
  }

  // Run cleanup on success — guaranteed lifecycle
  if (mod.cleanup) {
    try { await mod.cleanup(tap); } catch { /* cleanup must not break execution */ }
  }

  const totalMs = Math.round(performance.now() - start);

  // Ensure array
  if (!Array.isArray(rawRows)) {
    rawRows = rawRows ? [rawRows] : [];
  }

  // Preserve raw rows (original types) for pipeline composition
  const typedRows = rawRows.map((row) => {
    if (row && typeof row === "object") return { ...row as Record<string, unknown> };
    return {};
  });

  // Normalize rows: all values to strings (for display / LLM consumption)
  const rows = rawRows.map((row) => {
    const normalized: Record<string, string> = {};
    if (row && typeof row === "object") {
      for (const [k, v] of Object.entries(row as Record<string, unknown>)) {
        normalized[k] = v == null ? "" : String(v);
      }
    }
    return normalized;
  });

  // Infer columns from first row if not declared. Declared columns may be
  // the new ColumnSchema form — flatten to names for the result shape.
  const columns = mod.columns
    ? columnNames(mod.columns)
    : (rows.length > 0 ? Object.keys(rows[0]) : []);

  await appendLog({
    event: "run", site: mod.site, name: mod.name,
    run_id: runId,
    ms: totalMs, rows: rows.length,
    ...(opts?.sessionId && { sid: opts.sessionId }),
  });

  // T_trace: persist the successful run's trace. For pipe-only taps,
  // capturedPipeTrace has per-step detail. For leaf taps, there's no
  // pipe trace — just the top-level metadata + row count. The RPC-level
  // trace (traceSteps, from tracingSend above) stays attached to the
  // returned TapResult, since that's what existing consumers expect.
  const successTrace: TapTrace = {
    run_id: runId,
    site: mod.site,
    name: mod.name,
    started_at: runStartedAt,
    finished_at: new Date().toISOString(),
    total_ms: totalMs,
    status: "ok",
    rows_out: rows.length,
    args: resolvedArgs,
    ...(capturedPipeTrace ? { pipe: capturedPipeTrace } : {}),
  };
  await writeTapTrace(successTrace);

  // Phase 5 — compose the final prov chain. Current tap's IRI is appended
  // last (most-recent-derivation-appended convention), after ancestors
  // contributed by sub-runs, incoming args envelope, and pipe steps.
  // Dedupe is order-preserving so circular composition produces a clean
  // chain of distinct taps.
  const selfIri = makeTapIri(mod.site, mod.name);
  const provChain = appendProvenance(subProvenance, [selfIri]);

  return {
    columns,
    rows,
    rawRows: typedRows,
    count: rows.length,
    timing: { run_ms: totalMs, total_ms: totalMs },
    trace: traceSteps,
    // Pipe trace: only present for pipe taps. Each entry = one sub-step
    // (site, name, args, rows_out, duration, cache_hit). Lets callers
    // debug which step of a multi-stage pipe produced/consumed what
    // without re-running. Leaf taps omit this field.
    ...(capturedPipeTrace ? { pipe: capturedPipeTrace } : {}),
    run_id: runId,
    "prov:wasDerivedFrom": provChain,
    "prov:generatedAtTime": new Date().toISOString(),
    "prov:generator": tapProvGenerator(),
  };
}
