/**
 * @taprun/from-playwright — Playwright source → Tap plan-v1 adapter.
 *
 * Reference implementation that converts a Playwright test script
 * (.ts / .js source text) into a TapAnnotation envelope. Output passes
 * runConformance() from @taprun/spec.
 *
 * Why this package exists: Playwright is the dominant browser-automation
 * SDK on npm (47M weekly downloads — 60× the next SDK). Most users
 * with broken scrapers wrote them in Playwright. This adapter is the
 * on-ramp from "I have a Playwright script" to "Tap can monitor and
 * heal it" without rewriting in another framework.
 *
 * MVP coverage (Iteration 2):
 *   page.goto(url)              → { op: "nav", url }
 *   page.click(selector)        → { op: "input", kind: "click", target }
 *   page.fill(selector, value)  → { op: "input", kind: "fill", target, value }
 *   page.type(selector, value)  → { op: "input", kind: "type", target, value }
 *   page.press(selector, key)   → { op: "input", kind: "press", target, value: key }
 *   page.waitForSelector(s)     → { op: "wait", selector }
 *   page.waitForTimeout(ms)     → { op: "wait", ms }
 *   page.screenshot()           → { op: "screenshot" }
 *
 * Limitations (escape via Iteration 3 or hand-edit the output):
 *   - Variable-bound selectors (`const sel = "..."; page.click(sel)`) —
 *     MVP regex sees the variable name as the selector. Use literals.
 *   - Template-string interpolation in URLs/selectors works only when
 *     the entire string is `\`literal\`` — `\`${dynamic}\`` is reported.
 *   - locator chains, expect() assertions, fixtures, multi-context — out of
 *     MVP scope; left as future Iteration 3 work.
 *
 * Out-of-MVP page.* calls produce a `PlaywrightConversionError`
 * with a hint pointing at the offending source line. Callers can
 * either rewrite the script to use supported APIs or upgrade to
 * Iteration 3 once it ships AST-level fallback.
 */

import type {
  ExecutionPlan,
  Op,
  TapAnnotation,
} from "@taprun/spec";

export interface PlaywrightToTapOptions {
  /** Required — the tap's site identifier (e.g., "github"). */
  site: string;
  /** Required — the tap's name within the site (e.g., "trending"). */
  name: string;
  /** Optional — declared intent. Defaults to "read". */
  intent?: "read" | "write";
  /** Optional — human description for the resulting tap. */
  description?: string;
  /** Optional — the URL the tap targets (defaults to first page.goto in source). */
  target?: string;
  /** When true, throws on any unrecognized page.* call. When false (default),
   *  emits a warning op { op: "exec", allowUnverifiable: true } preserving
   *  the original line. */
  strict?: boolean;
}

export class PlaywrightConversionError extends Error {
  override readonly name = "PlaywrightConversionError";
  readonly source: string;
  readonly hint?: string;
  readonly line?: number;

  constructor(message: string, source: string, hint?: string, line?: number) {
    super(message);
    this.source = source;
    this.hint = hint;
    this.line = line;
  }
}

// ---------------------------------------------------------------------------
// Internal: token extraction
// ---------------------------------------------------------------------------

/** Match a single string literal — "..." or '...' or `...` (no interpolation). */
const STR = /(?:"((?:[^"\\]|\\.)*)"|'((?:[^'\\]|\\.)*)'|`((?:[^`\\$]|\\.)*)`)/.source;
/** Optional whitespace. */
const WS = /\s*/.source;

/**
 * Build a regex that matches `page.<method>(<args>)` with `n` string args
 * and an optional trailing options object (which we just allow-match).
 */
function callRe(method: string, n: 1 | 2): RegExp {
  // Allow `page` or any identifier — Playwright tests sometimes destructure.
  // We just look for `.<method>(` to keep MVP tight.
  if (n === 1) {
    return new RegExp(`\\.${method}\\s*\\(${WS}${STR}${WS}\\s*[,)]`);
  }
  return new RegExp(
    `\\.${method}\\s*\\(${WS}${STR}${WS},${WS}${STR}${WS}\\s*[,)]`,
  );
}

const RE_GOTO = callRe("goto", 1);
const RE_CLICK = callRe("click", 1);
const RE_FILL = callRe("fill", 2);
const RE_TYPE = callRe("type", 2);
const RE_PRESS = callRe("press", 2);
const RE_WAIT_SEL = callRe("waitForSelector", 1);
const RE_WAIT_MS = /\.waitForTimeout\s*\(\s*(\d+)\s*\)/;
const RE_SCREENSHOT = /\.screenshot\s*\(/;
/** Page-API smell — any `.something(` call we can attribute to Playwright. */
const RE_PAGE_CALL = /(?:page|context|browser|locator)\s*\.\s*([a-zA-Z_$][\w$]*)\s*\(/;

/**
 * Extract the matched string content from any of the three capture groups
 * `(double | single | backtick)`. Returns the first non-undefined one.
 */
function pickStr(m: RegExpMatchArray): string | undefined {
  return m[1] ?? m[2] ?? m[3];
}

/**
 * Same shape but for two-string calls — picks group 1/2/3 (first arg) and
 * group 4/5/6 (second arg).
 */
function pickStr2(m: RegExpMatchArray): [string, string] | undefined {
  const a = m[1] ?? m[2] ?? m[3];
  const b = m[4] ?? m[5] ?? m[6];
  return a !== undefined && b !== undefined ? [a, b] : undefined;
}

// ---------------------------------------------------------------------------
// Convert
// ---------------------------------------------------------------------------

export function playwrightToTap(
  source: string,
  options: PlaywrightToTapOptions,
): TapAnnotation {
  if (!options.site || !options.name) {
    throw new PlaywrightConversionError(
      "site and name are required in PlaywrightToTapOptions",
      source,
    );
  }

  const lines = source.split(/\r?\n/);
  const ops: Op[] = [];
  let firstNavUrl: string | undefined;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    // Skip pure-comment + blank lines. Don't strip trailing `//` because
    // URLs contain `//` and a naive strip would corrupt page.goto("https://…").
    // Limitation: trailing line comments stay in the source visible to the
    // regex matchers — they only affect the unhandled-line warning, never
    // a successful match.
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("//")) continue;

    let matched = false;

    // Order matters — try the most specific patterns first.
    let m: RegExpMatchArray | null;

    if ((m = trimmed.match(RE_GOTO))) {
      const url = pickStr(m);
      if (url !== undefined) {
        ops.push({ op: "nav", url });
        if (firstNavUrl === undefined) firstNavUrl = url;
        matched = true;
      }
    } else if ((m = trimmed.match(RE_FILL))) {
      const pair = pickStr2(m);
      if (pair) {
        ops.push({ op: "input", kind: "fill", target: pair[0], value: pair[1] });
        matched = true;
      }
    } else if ((m = trimmed.match(RE_TYPE))) {
      const pair = pickStr2(m);
      if (pair) {
        ops.push({ op: "input", kind: "type", target: pair[0], value: pair[1] });
        matched = true;
      }
    } else if ((m = trimmed.match(RE_PRESS))) {
      const pair = pickStr2(m);
      if (pair) {
        ops.push({ op: "input", kind: "press", target: pair[0], value: pair[1] });
        matched = true;
      }
    } else if ((m = trimmed.match(RE_CLICK))) {
      const target = pickStr(m);
      if (target !== undefined) {
        ops.push({ op: "input", kind: "click", target });
        matched = true;
      }
    } else if ((m = trimmed.match(RE_WAIT_SEL))) {
      const selector = pickStr(m);
      if (selector !== undefined) {
        ops.push({ op: "wait", selector });
        matched = true;
      }
    } else if ((m = trimmed.match(RE_WAIT_MS))) {
      const ms = Number(m[1]);
      if (!Number.isNaN(ms)) {
        ops.push({ op: "wait", ms });
        matched = true;
      }
    } else if (RE_SCREENSHOT.test(trimmed)) {
      ops.push({ op: "screenshot" });
      matched = true;
    }

    if (!matched) {
      // Detect any unhandled page.* call so we can decide strict vs
      // permissive behavior.
      const generic = trimmed.match(RE_PAGE_CALL);
      if (generic) {
        const method = generic[1];
        if (options.strict === true) {
          throw new PlaywrightConversionError(
            `Unsupported Playwright API on line ${i + 1}: page.${method}(`,
            source,
            `MVP supports goto/click/fill/type/press/waitForSelector/waitForTimeout/screenshot. ` +
              `Run with strict:false to emit { op: "exec" } and preserve the original line.`,
            i + 1,
          );
        }
        // Permissive: preserve the original line as an exec op so the
        // plan still round-trips. Mark the plan unverifiable.
        ops.push({
          op: "exec",
          fn: `async function(handle, args) { /* original Playwright line ${i + 1} not auto-converted: ${line.replace(/\*\//g, "*\\/")} */ }`,
        });
      }
    }
  }

  if (ops.length === 0) {
    throw new PlaywrightConversionError(
      "no Playwright API calls detected in source — adapter has nothing to convert",
      source,
      `Add at least one await page.goto(...) or page.click(...) to the source.`,
    );
  }

  // Compute target URL from first page.goto if caller didn't pass one.
  const target = options.target ?? firstNavUrl ??
    `urn:playwright:${options.site}:${options.name}`;

  // Build the plan body.
  const body: ExecutionPlan = {
    type: "tap:ExecutionPlan",
    site: options.site,
    name: options.name,
    intent: options.intent ?? "read",
    ops,
  };
  if (options.description) body.description = options.description;

  // If any exec op was emitted, the plan is unverifiable as a whole.
  if (ops.some((o) => o.op === "exec")) {
    body.allowUnverifiable = true;
  }

  return {
    "@context": [
      "http://www.w3.org/ns/anno.jsonld",
      "https://taprun.dev/ns/tap-v1",
    ],
    type: "Annotation",
    motivation: "tap:executing",
    target,
    body,
    generator: {
      id: "https://taprun.dev/from-playwright",
      type: "SoftwareAgent",
      version: "0.x",
    },
  };
}
