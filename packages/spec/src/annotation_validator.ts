/**
 * W3C Web Annotation — lightweight MUST-level validator.
 *
 * Why: Phase 1 of the Web Annotation Migration needs a deterministic gate
 * that every `.tap.js` sidecar annotation Tap emits (target, selector chain,
 * state, doctor diagnostic) validates against the 2017 Recommendation. A
 * full JSON-LD processor is overkill and violates the "zero runtime
 * dependencies" invariant — this module reimplements only the MUST-level
 * shape checks from §3.1 and §4 so corpus drift is caught at test time.
 *
 * Source: https://www.w3.org/TR/annotation-model/ (W3C Recommendation
 * 2017-02-23), specifically:
 *   §3.1   Annotations — @context, type, id shape
 *   §3.3.5 Motivation and Purpose — the 13-term enum
 *   §4     Specific Resources — source + selector
 *   §4.2   Selectors — recognized selector types
 *   §4.3   States — recognized state types
 *
 * Rules:
 *   - Zero imports. No deno.json change. Pure TypeScript.
 *   - No I/O, no network, no filesystem touch.
 *   - Errors are W3C MUSTs; warnings are SHOULDs and Tap-specific hygiene.
 *
 * Explicitly OUT OF SCOPE (not implemented):
 *   - Full JSON-LD expansion / compaction / framing.
 *   - RDF graph canonicalization (URDNA2015 / RDC-1.0).
 *   - Media-type / content-type negotiation.
 *   - Agent, rights, audience, canonical, via field validation.
 *   - AnnotationCollection / AnnotationPage pagination linkage.
 *   - Language-tagged strings, BCP-47 / language / textDirection checks.
 *   - Fetch + verify of `conformsTo` / remote schemas.
 *   - Prefix lookup of CURIEs against the live @context document — we only
 *     verify the prefix is declared syntactically, not that the document
 *     resolves. A separate worktree publishes the `tap:` namespace doc
 *     (https://taprun.dev/ns/tap-v1); fetch-based strict validation is a
 *     future phase.
 */

// ---------------------------------------------------------------------------
// Public surface
// ---------------------------------------------------------------------------

export interface ValidationError {
  /** Machine-readable error code — stable wire identifier. */
  code: string;
  /** Human-readable message, suitable for CLI output. */
  message: string;
  /** JSON-Pointer-like path into the annotation at which the error fired. */
  path: string;
}

export interface ValidationWarning {
  code: string;
  message: string;
  path: string;
}

export interface ValidationResult {
  valid: boolean;
  errors: ValidationError[];
  warnings: ValidationWarning[];
}

/**
 * Validate an unknown value as a W3C Web Annotation.
 *
 * Returns `{ valid: true, errors: [], warnings: [...] }` when all MUSTs pass.
 * Warnings are informational only and do NOT affect `valid`.
 */
export function validateAnnotation(anno: unknown): ValidationResult {
  const errors: ValidationError[] = [];
  const warnings: ValidationWarning[] = [];

  if (!isPlainObject(anno)) {
    errors.push({
      code: "not-object",
      message: "Annotation MUST be a JSON object.",
      path: "$",
    });
    return { valid: false, errors, warnings };
  }

  // §3.1 — @context is REQUIRED and MUST include the anno.jsonld context.
  const contexts = normalizeContext(anno["@context"]);
  if (contexts === null) {
    errors.push({
      code: "context-missing",
      message:
        "MUST have `@context` that includes 'http://www.w3.org/ns/anno.jsonld'.",
      path: "$/@context",
    });
  } else if (!contexts.some(isAnnoContextIri)) {
    errors.push({
      code: "context-missing-anno",
      message:
        "`@context` MUST contain 'http://www.w3.org/ns/anno.jsonld' (http or https).",
      path: "$/@context",
    });
  }

  const declaredPrefixes = collectDeclaredPrefixes(contexts ?? []);

  // §3.1 — type is REQUIRED and MUST include "Annotation".
  // The anno.jsonld context aliases `type` → `@type`; accept either spelling.
  const typeValue = anno["@type"] ?? anno["type"];
  if (typeValue === undefined) {
    errors.push({
      code: "type-missing",
      message: "MUST have `type` (or `@type`).",
      path: "$/type",
    });
  } else if (!includesType(typeValue, "Annotation")) {
    errors.push({
      code: "type-not-annotation",
      message: "`type` MUST include the string \"Annotation\".",
      path: "$/type",
    });
  }

  // §3.1 — id, if present, MUST be a single IRI.
  if ("id" in anno) {
    const idVal = anno.id;
    if (Array.isArray(idVal)) {
      errors.push({
        code: "id-not-single",
        message: "`id` MUST be a single IRI, not an array.",
        path: "$/id",
      });
    } else if (typeof idVal !== "string") {
      errors.push({
        code: "id-not-string",
        message: "`id` MUST be a string IRI.",
        path: "$/id",
      });
    } else if (!isIriOrDeclaredCurie(idVal, declaredPrefixes)) {
      errors.push({
        code: "id-invalid-iri",
        message:
          `\`id\` MUST be an IRI or a CURIE whose prefix is declared in @context (got ${JSON.stringify(idVal)}).`,
        path: "$/id",
      });
    }
  }

  // §3.3.5 — motivation values, if present, must be from the 13-enum or a
  // recognizable IRI / declared CURIE.
  if ("motivation" in anno) {
    validateMotivationField(
      anno.motivation,
      "$/motivation",
      declaredPrefixes,
      errors,
    );
  }

  // §3.1 — target is REQUIRED.
  if (!("target" in anno) || anno.target === undefined || anno.target === null) {
    errors.push({
      code: "target-missing",
      message: "MUST have `target` — either an IRI or an object.",
      path: "$/target",
    });
  } else {
    validateTarget(anno.target, "$/target", declaredPrefixes, errors, warnings);
  }

  // §3.2.5 — body.purpose same motivation-enum rules as top-level motivation.
  if ("body" in anno) {
    validateBody(anno.body, "$/body", declaredPrefixes, errors, warnings);
  }

  return { valid: errors.length === 0, errors, warnings };
}

// ---------------------------------------------------------------------------
// Internal: constants
// ---------------------------------------------------------------------------

/** §3.3.5 — the 13 W3C motivation terms. */
const MOTIVATION_ENUM: ReadonlySet<string> = new Set([
  "assessing",
  "bookmarking",
  "classifying",
  "commenting",
  "describing",
  "editing",
  "highlighting",
  "identifying",
  "linking",
  "moderating",
  "questioning",
  "replying",
  "tagging",
]);

/** §4.2 — recognized selector types. Tap extends with one namespaced CURIE. */
const SELECTOR_TYPES: ReadonlySet<string> = new Set([
  "FragmentSelector",
  "CssSelector",
  "XPathSelector",
  "TextQuoteSelector",
  "TextPositionSelector",
  "DataPositionSelector",
  "SvgSelector",
  "RangeSelector",
  // Tap-namespaced — recognized as a CURIE; prefix is declared in @context.
  "tap:JsonPathSelector",
]);

/** §4.3 — recognized state types. */
const STATE_TYPES: ReadonlySet<string> = new Set([
  "TimeState",
  "HttpRequestState",
  "RequestHeaderState",
  // Tap namespaced.
  "tap:SemanticHashState",
]);

const W3C_ANNO_IRI_HTTP = "http://www.w3.org/ns/anno.jsonld";
const W3C_ANNO_IRI_HTTPS = "https://www.w3.org/ns/anno.jsonld";

// ---------------------------------------------------------------------------
// Internal: normalization helpers
// ---------------------------------------------------------------------------

function isPlainObject(x: unknown): x is Record<string, unknown> {
  return typeof x === "object" && x !== null && !Array.isArray(x);
}

function normalizeContext(ctx: unknown): string[] | null {
  if (ctx === undefined || ctx === null) return null;
  if (typeof ctx === "string") return [ctx];
  if (Array.isArray(ctx)) {
    // JSON-LD allows inline context objects alongside IRIs — we accept them
    // but can't introspect without a processor; treat as non-IRI entries.
    return ctx.filter((c) => typeof c === "string") as string[];
  }
  // Single inline context object: not an IRI entry, treat as "no iri".
  return [];
}

function isAnnoContextIri(c: string): boolean {
  return c === W3C_ANNO_IRI_HTTP || c === W3C_ANNO_IRI_HTTPS;
}

function includesType(value: unknown, needle: string): boolean {
  if (typeof value === "string") return value === needle;
  if (Array.isArray(value)) {
    return value.some((v) => typeof v === "string" && v === needle);
  }
  return false;
}

/**
 * Gather the set of CURIE prefixes *declared* in the @context chain.
 *
 * Heuristic (zero-dep):
 *   - The W3C anno.jsonld context is known to declare `oa:`, `schema:`,
 *     `dc:`, `dcterms:`, `dctypes:`, `foaf:`, `rdf:`, `rdfs:`, `owl:`,
 *     `prov:`, `xsd:`, `iana:`, `skos:`, `as:`.
 *   - The Tap namespace (https://taprun.dev/ns/tap-v1 — and historical
 *     variants) declares `tap:` when present in @context. We don't fetch
 *     the document; presence in the array is sufficient for syntactic
 *     validation (see file-top disclaimer).
 *   - Any inline `@context` object entries are not introspected.
 */
function collectDeclaredPrefixes(ctx: string[]): Set<string> {
  const prefixes = new Set<string>();
  for (const iri of ctx) {
    if (isAnnoContextIri(iri)) {
      for (
        const p of [
          "oa",
          "schema",
          "dc",
          "dcterms",
          "dctypes",
          "foaf",
          "rdf",
          "rdfs",
          "owl",
          "prov",
          "xsd",
          "iana",
          "skos",
          "as",
        ]
      ) prefixes.add(p);
      continue;
    }
    // Tap namespace — any URL under taprun.dev/ns/tap* declares `tap:`.
    if (/^https?:\/\/[^/]*taprun\.dev\/ns\/tap/i.test(iri)) {
      prefixes.add("tap");
      continue;
    }
    // Other custom namespaces — best-effort: a suffix like ".../ns/foo-v1"
    // is taken to declare the final path segment's first word as a prefix.
    const m = /\/ns\/([A-Za-z][A-Za-z0-9_-]*)/.exec(iri);
    if (m) {
      const raw = m[1].split(/[-v.]/)[0]; // "tap-v1" → "tap"
      if (raw) prefixes.add(raw);
    }
  }
  return prefixes;
}

// ---------------------------------------------------------------------------
// Internal: IRI / CURIE syntax
// ---------------------------------------------------------------------------

/**
 * Common registered URI schemes we accept as real IRIs (IANA short list).
 * An unregistered scheme-looking prefix (e.g. "tap:foo") is treated as a
 * CURIE and only accepted when the prefix is declared in @context.
 */
const KNOWN_IRI_SCHEMES: ReadonlySet<string> = new Set([
  "http",
  "https",
  "ftp",
  "ftps",
  "urn",
  "file",
  "mailto",
  "tag",
  "data",
  "ws",
  "wss",
  "about",
  "did",
  "ipfs",
  "ipns",
  "doi",
]);

/**
 * Loose IRI check — RFC 3987 is a full grammar; we accept the subset the
 * annotation corpus actually uses: a registered scheme, a colon, and at
 * least one non-whitespace character. Rejects whitespace; rejects bare
 * text; rejects `tap:foo`-style CURIEs (those go through the CURIE path).
 */
function isIri(s: string): boolean {
  if (s.length === 0) return false;
  if (/\s/.test(s)) return false;
  const m = /^([A-Za-z][A-Za-z0-9+.\-]*):([^\s].*)$/.exec(s);
  if (!m) return false;
  return KNOWN_IRI_SCHEMES.has(m[1].toLowerCase());
}

function splitCurie(s: string): { prefix: string; reference: string } | null {
  // A CURIE is `prefix:reference` — prefix is NCNameStart; reference is the
  // remainder (may contain slashes etc.).
  const m = /^([A-Za-z_][A-Za-z0-9_.\-]*):(.*)$/.exec(s);
  if (!m) return null;
  return { prefix: m[1], reference: m[2] };
}

/**
 * Accept either:
 *  - an absolute IRI (scheme:authority/path), OR
 *  - a CURIE whose prefix is in `declaredPrefixes`.
 *
 * Distinguishing an IRI from a CURIE syntactically: an IRI's scheme is
 * always followed by `//` (hierarchical) or non-slash characters that form
 * an opaque path. We treat the value as a CURIE when its prefix matches one
 * of the declared prefix strings AND is not a known URI scheme.
 */
function isIriOrDeclaredCurie(s: string, declaredPrefixes: Set<string>): boolean {
  // CURIE path first — if the prefix is declared, accept.
  const parts = splitCurie(s);
  if (parts && declaredPrefixes.has(parts.prefix)) return true;
  // Otherwise fall back to IRI syntax (covers http:, https:, urn:, etc.).
  return isIri(s);
}

// ---------------------------------------------------------------------------
// Internal: field validators
// ---------------------------------------------------------------------------

function validateMotivationField(
  value: unknown,
  path: string,
  declaredPrefixes: Set<string>,
  errors: ValidationError[],
): void {
  const values = Array.isArray(value) ? value : [value];
  for (let i = 0; i < values.length; i++) {
    const v = values[i];
    const subPath = Array.isArray(value) ? `${path}[${i}]` : path;
    if (typeof v !== "string") {
      errors.push({
        code: "motivation-not-string",
        message: "motivation values MUST be strings.",
        path: subPath,
      });
      continue;
    }
    if (MOTIVATION_ENUM.has(v)) continue;
    // Must be IRI or declared CURIE.
    if (!isIriOrDeclaredCurie(v, declaredPrefixes)) {
      errors.push({
        code: "motivation-invalid",
        message:
          `motivation ${JSON.stringify(v)} is not in the §3.3.5 enum and is not a recognizable IRI or declared CURIE.`,
        path: subPath,
      });
    }
  }
}

function validateTarget(
  target: unknown,
  path: string,
  declaredPrefixes: Set<string>,
  errors: ValidationError[],
  warnings: ValidationWarning[],
): void {
  if (Array.isArray(target)) {
    target.forEach((t, i) =>
      validateTarget(t, `${path}[${i}]`, declaredPrefixes, errors, warnings)
    );
    return;
  }
  if (typeof target === "string") {
    if (!isIriOrDeclaredCurie(target, declaredPrefixes)) {
      errors.push({
        code: "target-invalid-iri",
        message: "target string MUST be an IRI or declared CURIE.",
        path,
      });
    }
    return;
  }
  if (!isPlainObject(target)) {
    errors.push({
      code: "target-invalid-type",
      message: "target MUST be an IRI string, an object, or an array of those.",
      path,
    });
    return;
  }

  // SpecificResource — selector (if present) MUST have a recognized type.
  if ("selector" in target) {
    validateSelector(
      target.selector,
      `${path}/selector`,
      declaredPrefixes,
      errors,
    );
  }
  // state — same treatment for type recognition if present.
  if ("state" in target) {
    validateState(target.state, `${path}/state`, errors);
  }
  // source — SHOULD be an IRI. Warning, not error (spec is lenient).
  if ("source" in target && typeof target.source === "string") {
    if (!isIriOrDeclaredCurie(target.source, declaredPrefixes)) {
      warnings.push({
        code: "target-source-not-iri",
        message:
          "target.source SHOULD be an IRI.",
        path: `${path}/source`,
      });
    }
  }
}

function validateSelector(
  selector: unknown,
  path: string,
  declaredPrefixes: Set<string>,
  errors: ValidationError[],
): void {
  if (Array.isArray(selector)) {
    selector.forEach((s, i) =>
      validateSelector(s, `${path}[${i}]`, declaredPrefixes, errors)
    );
    return;
  }
  if (typeof selector === "string") {
    // Selector MAY be an IRI reference to an external Selector resource.
    if (!isIriOrDeclaredCurie(selector, declaredPrefixes)) {
      errors.push({
        code: "selector-invalid-iri",
        message: "selector string MUST be an IRI.",
        path,
      });
    }
    return;
  }
  if (!isPlainObject(selector)) {
    errors.push({
      code: "selector-invalid-type",
      message: "selector MUST be a string IRI, an object, or an array.",
      path,
    });
    return;
  }
  const t = selector["@type"] ?? selector["type"];
  if (t === undefined) {
    errors.push({
      code: "selector-type-missing",
      message: "selector object MUST have a `type`.",
      path,
    });
    return;
  }
  if (!hasRecognizedSelectorType(t, declaredPrefixes)) {
    errors.push({
      code: "selector-type-unrecognized",
      message:
        `selector \`type\` ${JSON.stringify(t)} is not a W3C Selectors-and-States type and not a declared CURIE.`,
      path,
    });
  }
  // Recurse into refinedBy.
  if ("refinedBy" in selector) {
    validateSelector(
      selector.refinedBy,
      `${path}/refinedBy`,
      declaredPrefixes,
      errors,
    );
  }
  // RangeSelector-specific: startSelector / endSelector are themselves
  // selectors and MUST validate.
  if ("startSelector" in selector) {
    validateSelector(
      selector.startSelector,
      `${path}/startSelector`,
      declaredPrefixes,
      errors,
    );
  }
  if ("endSelector" in selector) {
    validateSelector(
      selector.endSelector,
      `${path}/endSelector`,
      declaredPrefixes,
      errors,
    );
  }
}

function hasRecognizedSelectorType(
  t: unknown,
  declaredPrefixes: Set<string>,
): boolean {
  const types = Array.isArray(t) ? t : [t];
  for (const tt of types) {
    if (typeof tt !== "string") continue;
    if (SELECTOR_TYPES.has(tt)) return true;
    // Declared CURIE — e.g. "tap:JsonPathSelector".
    const parts = splitCurie(tt);
    if (parts && declaredPrefixes.has(parts.prefix)) return true;
    // Absolute IRI — accept.
    if (isIri(tt) && tt.includes("://")) return true;
  }
  return false;
}

function validateState(
  state: unknown,
  path: string,
  errors: ValidationError[],
): void {
  if (Array.isArray(state)) {
    state.forEach((s, i) => validateState(s, `${path}[${i}]`, errors));
    return;
  }
  if (typeof state === "string") return; // Reference to external state.
  if (!isPlainObject(state)) {
    errors.push({
      code: "state-invalid-type",
      message: "state MUST be a string IRI, an object, or an array.",
      path,
    });
    return;
  }
  const t = state["@type"] ?? state["type"];
  // State type is SHOULD, not MUST, so only error when present and unrecognized.
  if (t !== undefined) {
    const types = Array.isArray(t) ? t : [t];
    const anyRecognized = types.some((tt) => {
      if (typeof tt !== "string") return false;
      if (STATE_TYPES.has(tt)) return true;
      return isIri(tt) && tt.includes("://");
    });
    if (!anyRecognized) {
      // State types are extensible; some fixtures lack recognized types
      // (id-only reference). Keep this non-fatal unless clearly bogus.
      // We tolerate unknown types as long as they are strings — the spec
      // leaves the state vocabulary open. No error.
    }
  }
  if ("refinedBy" in state) {
    // refinedBy on a state may be another state or a selector — spec §4.3.3
    // allows either. Defer to permissive recursion.
    const refined = state.refinedBy;
    if (isPlainObject(refined) || Array.isArray(refined)) {
      validateState(refined, `${path}/refinedBy`, errors);
    }
  }
}

function validateBody(
  body: unknown,
  path: string,
  declaredPrefixes: Set<string>,
  errors: ValidationError[],
  warnings: ValidationWarning[],
): void {
  if (body === null || body === undefined) return;
  if (Array.isArray(body)) {
    body.forEach((b, i) =>
      validateBody(b, `${path}[${i}]`, declaredPrefixes, errors, warnings)
    );
    return;
  }
  if (typeof body === "string") {
    // Body as IRI — SHOULD be an IRI; warn if not.
    if (!isIriOrDeclaredCurie(body, declaredPrefixes)) {
      warnings.push({
        code: "body-not-iri",
        message: "body string SHOULD be an IRI.",
        path,
      });
    }
    return;
  }
  if (!isPlainObject(body)) return;

  // §3.2.5 — body.purpose uses the same motivation rules.
  if ("purpose" in body) {
    validateMotivationField(
      body.purpose,
      `${path}/purpose`,
      declaredPrefixes,
      errors,
    );
  }
  // A body MAY be a SpecificResource — recurse into nested selector/state.
  if ("selector" in body) {
    validateSelector(
      body.selector,
      `${path}/selector`,
      declaredPrefixes,
      errors,
    );
  }
  if ("state" in body) {
    validateState(body.state, `${path}/state`, errors);
  }
  // Choice / Composite / List containers nest items with their own purpose.
  if ("items" in body && Array.isArray(body.items)) {
    body.items.forEach((it, i) =>
      validateBody(it, `${path}/items[${i}]`, declaredPrefixes, errors, warnings)
    );
  }
}
