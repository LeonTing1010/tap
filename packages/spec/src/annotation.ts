/**
 * W3C Web Annotation Data Model — types and pure helpers (Phase 0).
 *
 * Why: Tap is migrating its self-invented vocabulary (strategy, layer, tier,
 * fingerprint) onto the W3C Web Annotation Data Model (2017 Recommendation).
 * This module is the type foundation — no behavior change, no imports, no
 * runtime dependencies. Later phases use these shapes for `.tap.js` metadata,
 * forge candidates, doctor diagnostics, and provenance.
 *
 * References:
 *   - https://www.w3.org/TR/annotation-model/
 *   - https://www.w3.org/TR/selectors-states/
 *   - RFC 9535 (JSONPath)
 *
 * Rules:
 *   - Zero runtime dependencies.
 *   - Zero imports from other Tap modules.
 *   - Fields are optional wherever the W3C spec permits optionality.
 *   - Tap-specific extensions are namespaced via `tap:` and the TAP_NS context.
 */

// ---------------------------------------------------------------------------
// Context constants
// ---------------------------------------------------------------------------

export const W3C_ANNO = "http://www.w3.org/ns/anno.jsonld";
export const TAP_NS = "https://taprun.dev/ns/tap-v1";

// ---------------------------------------------------------------------------
// Motivation — W3C enum (plus common variants)
// ---------------------------------------------------------------------------

export type Motivation =
  | "assessing"
  | "classifying"
  | "commenting"
  | "tagging"
  | "linking"
  | "identifying"
  | "bookmarking"
  | "describing"
  | "editing"
  | "highlighting"
  | "moderating"
  | "questioning"
  | "replying";

// ---------------------------------------------------------------------------
// Selectors — discriminated by `type` (string | string[])
// ---------------------------------------------------------------------------

/** `type` in JSON-LD may be a single IRI or an array of IRIs (multi-type). */
export type SelectorType = string | string[];

export interface FragmentSelector {
  type: "FragmentSelector" | string[];
  value: string;
  conformsTo?: string;
  refinedBy?: Selector;
}

export interface CssSelector {
  type: "CssSelector" | string[];
  value: string;
  refinedBy?: Selector;
}

export interface XPathSelector {
  type: "XPathSelector" | string[];
  value: string;
  refinedBy?: Selector;
}

export interface TextQuoteSelector {
  type: "TextQuoteSelector" | string[];
  exact: string;
  prefix?: string;
  suffix?: string;
  refinedBy?: Selector;
}

export interface TextPositionSelector {
  type: "TextPositionSelector" | string[];
  start: number;
  end: number;
  refinedBy?: Selector;
}

export interface DataPositionSelector {
  type: "DataPositionSelector" | string[];
  start: number;
  end: number;
  refinedBy?: Selector;
}

export interface SvgSelector {
  type: "SvgSelector" | string[];
  value: string;
  refinedBy?: Selector;
}

export interface RangeSelector {
  type: "RangeSelector" | string[];
  startSelector: Selector;
  endSelector: Selector;
  refinedBy?: Selector;
}

/**
 * Tap-namespaced JSONPath selector (RFC 9535).
 * Not part of W3C Selectors and States (2017 Note); JSONPath wasn't ratified
 * until 2024. Proposed back to the W3C CG — see migration plan Open Questions.
 */
export interface JsonPathSelector {
  type: "tap:JsonPathSelector" | string[];
  value: string;
  /** e.g. "https://www.rfc-editor.org/rfc/rfc9535" */
  conformsTo?: string;
  /** Data source indicator: "jsonld", a URL, "ssr", "api", etc. */
  source?: string;
  refinedBy?: Selector;
}

export type Selector =
  | FragmentSelector
  | CssSelector
  | XPathSelector
  | TextQuoteSelector
  | TextPositionSelector
  | DataPositionSelector
  | SvgSelector
  | RangeSelector
  | JsonPathSelector;

// ---------------------------------------------------------------------------
// States — captured snapshot a selector resolved against
// ---------------------------------------------------------------------------

export interface TimeState {
  type: "TimeState" | string[];
  sourceDate: string;
}

export interface HttpRequestState {
  type: "HttpRequestState" | string[];
  value: string;
}

/**
 * Tap-namespaced semantic hash state. Carries the fingerprint data that was
 * previously stored in `~/.tap/fingerprints/` so taps can own their own state.
 */
export interface SemanticHashState {
  type: "tap:SemanticHashState" | string[];
  /** ISO 8601 timestamp when this snapshot was captured. */
  sourceDate?: string;
  /** Merkle root hash of all sub-components — changes when any part drifts. */
  "tap:rootHash"?: string;
  /** Extraction strategy that produced this fingerprint (ssr, api, dom, etc.). */
  "tap:strategy"?: string;
  /** DOM selector → match count + semantic hash. Empty = no DOM layer used. */
  "tap:selectors"?: {
    count?: number;
    semanticHash?: string;
    [k: string]: unknown;
  };
  /** API endpoints discovered on the page + their response shape hashes. */
  "tap:endpoints"?: Array<{
    url: string;
    shapeHash?: string;
    [k: string]: unknown;
  }>;
  /** JSON-LD @type values found in the page's structured data. */
  "tap:jsonLdValues"?: Record<string, unknown>;
  /** Global variable names whose presence was detected (e.g., __INITIAL_STATE__). */
  "tap:globals"?: Array<{
    name: string;
    keys: string[];
  }>;
  /** JSON-LD @type values from structured data (deduplicated list). */
  "tap:jsonLdTypes"?: string[];
  /** Page-level metadata: title pattern and element count range for change detection. */
  "tap:page"?: {
    title_pattern?: string;
    element_count_range?: [number, number];
  };
  /** Write actions discovered by probe_writes: method + url + body keys + shape hash. */
  "tap:writeActions"?: Array<{
    method: string;
    url_pattern: string;
    body_keys: string[];
    body_shape_hash?: string;
  }>;
  [k: string]: unknown;
}

export type State = TimeState | HttpRequestState | SemanticHashState;

// ---------------------------------------------------------------------------
// SpecificResource / target
// ---------------------------------------------------------------------------

export interface SpecificResource {
  type?: "SpecificResource" | string | string[];
  source?: string;
  selector?: Selector | Selector[];
  state?: State | State[];
  /** Open to tap-specific and prov:* extensions. */
  [k: string]: unknown;
}

export type Target = string | SpecificResource | Array<string | SpecificResource>;

// ---------------------------------------------------------------------------
// Annotation + AnnotationCollection
// ---------------------------------------------------------------------------

export interface Annotation {
  "@context"?: string | string[];
  "@type"?: "Annotation" | string | string[];
  id?: string;
  motivation?: Motivation | Motivation[] | string | string[];
  target: Target;
  body?: unknown;
  generator?: string | { id?: string; type?: string; name?: string };
  created?: string;
  /** Open extension fields — `prov:*` (W3C PROV) and `tap:*` (namespaced). */
  [k: `prov:${string}`]: unknown;
  // TypeScript can't combine two index signatures of the same key type; keep
  // tap:* open via the generic fallback below.
  // deno-lint-ignore no-explicit-any
  [k: string]: any;
}

export interface AnnotationCollection {
  "@context"?: string | string[];
  "@type"?: "AnnotationCollection" | string | string[];
  id?: string;
  label: string;
  total?: number;
  items: Annotation[];
  first?: unknown;
  last?: unknown;
  [k: string]: unknown;
}

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

const KNOWN_SELECTOR_TYPES = new Set<string>([
  "FragmentSelector",
  "CssSelector",
  "XPathSelector",
  "TextQuoteSelector",
  "TextPositionSelector",
  "DataPositionSelector",
  "SvgSelector",
  "RangeSelector",
  "tap:JsonPathSelector",
]);

function firstType(t: unknown): string | undefined {
  if (typeof t === "string") return t;
  if (Array.isArray(t) && t.length > 0 && typeof t[0] === "string") return t[0];
  return undefined;
}

/**
 * Derive the Tap trust layer (1–4) from a Selector, per Appendix A of the
 * Web Annotation Migration plan.
 *
 *   Layer 1 — explicit declarations (JSON-LD, Open Graph, agents.json, ...)
 *   Layer 2 — data contracts (API, SSR hydration, WebSocket)
 *   Layer 3 — semantic structure (ARIA, headings, text positions)
 *   Layer 4 — implementation details (CSS classes, framework attrs)
 *
 * Unknown types conservatively return 4. For RangeSelector, returns the
 * minimum (highest-trust) of its inner selectors.
 */
export function selectorLayer(sel: Selector): 1 | 2 | 3 | 4 {
  const type = firstType((sel as { type?: unknown }).type);
  switch (type) {
    case "FragmentSelector": {
      const v = (sel as FragmentSelector).value;
      // Layer 1 — explicit structured-data declarations on the page:
      //   jsonld, og:*, rss/atom feeds, agents.json, openapi.
      // Appendix A of the Web Annotation Migration plan anchors this list —
      // each format carries an EXTERNAL stability driver (SEO/feed
      // subscribers/contract) that keeps it stable across site deploys.
      if (typeof v === "string") {
        if (v === "jsonld" || v.startsWith("og:")) return 1;
        if (v === "rss" || v === "atom") return 1;
        if (v === "agents.json" || v === "openapi") return 1;
      }
      return 3;
    }
    case "tap:JsonPathSelector": {
      const source = (sel as JsonPathSelector).source;
      if (
        source === "jsonld" ||
        (typeof source === "string" && source.endsWith(".jsonld"))
      ) {
        return 1;
      }
      return 2;
    }
    case "TextQuoteSelector":
    case "TextPositionSelector":
    case "XPathSelector":
    case "DataPositionSelector":
    case "SvgSelector":
      return 3;
    case "CssSelector":
      return 4;
    case "RangeSelector": {
      const r = sel as RangeSelector;
      const a = selectorLayer(r.startSelector);
      const b = selectorLayer(r.endSelector);
      return (a < b ? a : b) as 1 | 2 | 3 | 4;
    }
    default:
      return 4;
  }
}

/**
 * Walk an arbitrary value (TapModule, ExecutionPlan body, plan op, …) and
 * return the highest-trust selectorLayer found anywhere inside, by treating
 * every `selector` (or `startSelector`/`endSelector`) key as a candidate and
 * gating with `isSelector`. Returns undefined when no selector is found —
 * legacy taps without target metadata, or write taps whose ops carry no
 * structural anchors.
 *
 * "Highest-trust" = lowest layer number — Layer 1 dominates Layer 4. A plan
 * that mixes a JSON-LD root with a CSS leaf is "Layer 1" for the K(Δ)
 * question because the JSON-LD root is what carries it across deploys.
 *
 * Bounded by recursion depth (16) — JSONata expressions and pathological
 * cyclic graphs (which shouldn't reach this code, but defense-in-depth)
 * cannot blow the stack.
 */
export function derivePlanSelectorLayer(value: unknown): 1 | 2 | 3 | 4 | undefined {
  let best: 1 | 2 | 3 | 4 | undefined = undefined;
  const visit = (v: unknown, depth: number): void => {
    if (depth > 16 || v === null || typeof v !== "object") return;
    if (isSelector(v)) {
      const layer = selectorLayer(v);
      if (best === undefined || layer < best) best = layer;
      return;
    }
    if (Array.isArray(v)) {
      for (const item of v) visit(item, depth + 1);
      return;
    }
    for (const [k, child] of Object.entries(v)) {
      // Selector-shaped keys carry the candidates we care about. We could
      // walk every key, but that re-traverses huge trees (page_inspection
      // payloads, fingerprint maps) for no signal. Constrain to known keys.
      if (
        k === "selector" || k === "selectors" ||
        k === "startSelector" || k === "endSelector" ||
        k === "target" || k === "body" || k === "ops"
      ) {
        visit(child, depth + 1);
      }
    }
  };
  visit(value, 0);
  return best;
}

/** Structural type guard — no JSON Schema, just shape checks. */
export function isSelector(x: unknown): x is Selector {
  if (!x || typeof x !== "object") return false;
  const t = firstType((x as { type?: unknown }).type);
  if (!t) return false;
  if (!KNOWN_SELECTOR_TYPES.has(t)) return false;

  switch (t) {
    case "FragmentSelector":
    case "CssSelector":
    case "XPathSelector":
    case "SvgSelector":
    case "tap:JsonPathSelector":
      return typeof (x as { value?: unknown }).value === "string";
    case "TextQuoteSelector":
      return typeof (x as { exact?: unknown }).exact === "string";
    case "TextPositionSelector":
    case "DataPositionSelector":
      return (
        typeof (x as { start?: unknown }).start === "number" &&
        typeof (x as { end?: unknown }).end === "number"
      );
    case "RangeSelector": {
      const r = x as {
        startSelector?: unknown;
        endSelector?: unknown;
      };
      return isSelector(r.startSelector) && isSelector(r.endSelector);
    }
    default:
      return false;
  }
}

/** Accepts any object with a `target` — motivation and @context are optional. */
export function isAnnotation(x: unknown): x is Annotation {
  if (!x || typeof x !== "object") return false;
  const obj = x as { target?: unknown };
  if (obj.target === undefined || obj.target === null) return false;
  // target may be string | SpecificResource | array
  if (typeof obj.target === "string") return true;
  if (Array.isArray(obj.target)) return true;
  if (typeof obj.target === "object") return true;
  return false;
}
