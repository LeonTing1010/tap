/**
 * @taprun/from-playwright v1.0 — Playwright source → Tap v2 Plan adapter.
 *
 * Reference implementation that converts a Playwright test script
 * (.ts / .js source text) into a v2 `Plan` per `@taprun/spec@1.x`.
 *
 * Per ADR 2026-05-04 §2.4 (Ecosystem v2 launch — lockstep major bump),
 * v1.0 emits the v2 Plan shape:
 *   - bare Plan (no W3C Annotation envelope)
 *   - 11-op closure: fetch / nav / wait / input / extract / cookies / tap /
 *     if / foreach / parallel / eval
 *   - `op:exec` is GONE — `op:eval` is the escape hatch with mandatory
 *     `returns.type`
 *   - Read variant has no `act`/`key`; write variant requires both
 *
 * Why this package exists: Playwright is the dominant browser-automation
 * SDK on npm (47M weekly downloads — 60× the next SDK). Most users with
 * broken scrapers wrote them in Playwright. This adapter is the on-ramp
 * from "I have a Playwright script" to "Tap can monitor and heal it"
 * without rewriting in another framework.
 *
 * Mapping (v1.0):
 *   page.goto(url)              → { op: "nav", url }
 *   page.click(selector)        → { op: "input", kind: "click", target }
 *   page.fill(selector, value)  → { op: "input", kind: "fill", target, value }
 *   page.type(selector, value)  → { op: "input", kind: "type", target, value }
 *   page.press(selector, key)   → { op: "input", kind: "press", target, value }
 *   page.waitForSelector(s)     → { op: "wait", selector }
 *   page.waitForTimeout(ms)     → { op: "wait", ms }
 *   page.context().cookies()    → { op: "cookies" }
 *   page.evaluate(fn)           → { op: "eval", fn, returns: { type: "object" } }
 *
 * Locator chain (Playwright codegen):
 *   page.locator(sel).action()        sel passes through
 *   page.getByText(t).action()        → "text=<t>"
 *   page.getByTestId(id).action()     → "[data-testid=\"<id>\"]"
 *   page.getByLabel(l).action()       → "label=<l>"
 *   page.getByPlaceholder(p).action() → "placeholder=<p>"
 *   page.getByRole(r,{name}).action() → "role=<r>[name=\"<name>\"]"
 *   page.getByAltText(a).action()     → "[alt=\"<a>\"]"
 *   page.getByTitle(t).action()       → "[title=\"<t>\"]"
 *
 * v2 retired ops (handled with warning + op:eval fallback):
 *   page.screenshot() — no v2 op; emit eval with TODO comment.
 *
 * Read vs write detection (heuristic):
 *   The script is treated as WRITE iff a click target matches one of
 *   the submit-like patterns: `[type=submit]`, `[type='submit']`,
 *   `button[type="submit"]`, role="button"+name~"submit|post|send|publish|save".
 *   Write plans get a TODO `key` placeholder (`'TODO_DECLARE_KEY'`) and
 *   minimal `act` body. Hand-rolling a real CEL `key` is out of scope —
 *   that requires AI / authoritative-source knowledge.
 *
 * Limitations:
 *   - Variable-bound selectors — regex sees the variable name, not the value.
 *   - Multi-line locator chains (const loc = page.locator(...); await loc.click())
 *     fall through to op:eval in permissive mode.
 *   - Template-string interpolation works only for pure literals.
 *
 * Unrecognised page.* calls produce a `PlaywrightConversionError` (strict)
 * or an `{ op: "eval" }` preserve op (permissive, default) carrying a
 * structured warning.
 */

import type { Plan, Op } from "@taprun/spec";

export interface PlaywrightToTapOptions {
  /** Required — the tap's site identifier (e.g., "github"). */
  site: string;
  /** Required — the tap's name within the site (e.g., "trending"). */
  name: string;
  /** Optional — human description for the resulting tap. */
  description?: string;
  /** When true, throws on any unrecognized page.* call. When false (default),
   *  emits an `{ op: "eval" }` placeholder preserving the original line and
   *  attaches a structured warning to the result. */
  strict?: boolean;
  /** Optional override — force read or write variant. When omitted, the
   *  adapter heuristically infers write iff a submit-like click is seen. */
  variant?: "read" | "write";
}

export interface PlaywrightToTapResult {
  plan: Plan;
  /** Structured warnings the adapter could not represent losslessly. */
  warnings: PlaywrightConversionWarning[];
}

export interface PlaywrightConversionWarning {
  /** "eval-fallback" — emitted op:eval as escape hatch.
   *  "todo-key"      — write variant emitted with placeholder key.
   *  "screenshot-dropped" — page.screenshot() is no-op in v2.
   *  "lifecycle-dropped"  — browser.launch / page.close silently dropped. */
  kind:
    | "eval-fallback"
    | "todo-key"
    | "screenshot-dropped"
    | "lifecycle-dropped";
  line?: number;
  message: string;
  /** When kind=eval-fallback, the original Playwright line. */
  source?: string;
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
 * Build a regex matching `.<method>(<args>)` with `n` string args and an
 * optional trailing options object (allow-match).
 */
function callRe(method: string, n: 1 | 2): RegExp {
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
const RE_COOKIES = /\.context\s*\(\s*\)\s*\.\s*cookies\s*\(/;
const RE_EVALUATE = /\.evaluate\s*\(/;
/** Page-API smell — any `.something(` call we can attribute to Playwright. */
const RE_PAGE_CALL = /(?:page|context|browser|locator)\s*\.\s*([a-zA-Z_$][\w$]*)\s*\(/;

/** Submit-like click selectors that strongly imply write side effects. */
const RE_SUBMIT_SELECTOR = /(?:type\s*=\s*["']?submit["']?)|(?:type\s*=\s*submit)/i;
const RE_SUBMIT_NAME = /\b(submit|post|send|publish|save|create|delete|remove|update)\b/i;

// ---------------------------------------------------------------------------
// Locator chain support
// ---------------------------------------------------------------------------

interface LocatorChainOp {
  selector: string;
  action: "click" | "fill" | "type" | "press" | "waitFor" | "waitForTimeout";
  value?: string;
  ms?: number;
}

/** Extract first string literal from start of s; return [value, rest] or null. */
function extractFirstStr(s: string): [string, string] | null {
  const m = s.match(/^\s*(?:"((?:[^"\\]|\\.)*)"|'((?:[^'\\]|\\.)*)'|`((?:[^`\\$]|\\.)*)`)/);
  if (!m) return null;
  return [(m[1] ?? m[2] ?? m[3])!, s.slice(m[0].length)];
}

/** Return rest of string after the matching closing ')' at depth 0. */
function skipToCloseParen(s: string): string | null {
  let depth = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c === "(" || c === "{" || c === "[") depth++;
    else if (c === ")" || c === "}" || c === "]") {
      if (depth === 0 && c === ")") return s.slice(i + 1);
      depth--;
    }
  }
  return null;
}

const RE_GETTER_START =
  /\.(?:locator|getByText|getByTestId|getByLabel|getByPlaceholder|getByRole|getByAltText|getByTitle)\s*\(/;

function parseLocatorChain(line: string): LocatorChainOp | null {
  const getterMatch = line.match(RE_GETTER_START);
  if (!getterMatch) return null;

  const getterName = (getterMatch[0].match(/\.(getBy\w+|locator)/)?.[1]) ?? "";
  const afterOpen = line.slice(getterMatch.index! + getterMatch[0].length);

  const arg1Result = extractFirstStr(afterOpen);
  if (!arg1Result) return null;
  const [arg1, afterArg1] = arg1Result;

  let roleName: string | undefined;
  const afterGetter: string | null = (() => {
    if (getterName === "getByRole") {
      const nameMatch = afterArg1.match(
        /^\s*,\s*\{[^}]*?name\s*:\s*(?:"((?:[^"\\]|\\.)*)"|'((?:[^'\\]|\\.)*)'|`((?:[^`\\$]|\\.)*)`)/,
      );
      if (nameMatch) {
        roleName = nameMatch[1] ?? nameMatch[2] ?? nameMatch[3];
      }
    }
    return skipToCloseParen(afterArg1);
  })();
  if (!afterGetter) return null;

  let selector: string;
  switch (getterName) {
    case "locator":           selector = arg1; break;
    case "getByText":         selector = `text=${arg1}`; break;
    case "getByTestId":       selector = `[data-testid="${arg1}"]`; break;
    case "getByLabel":        selector = `label=${arg1}`; break;
    case "getByPlaceholder":  selector = `placeholder=${arg1}`; break;
    case "getByAltText":      selector = `[alt="${arg1}"]`; break;
    case "getByTitle":        selector = `[title="${arg1}"]`; break;
    case "getByRole":
      selector = roleName ? `role=${arg1}[name="${roleName}"]` : `role=${arg1}`;
      break;
    default: selector = arg1;
  }

  const actionMatch = afterGetter.match(
    /^\s*\.\s*(click|fill|type|press|waitFor|waitForTimeout)\s*\(/,
  );
  if (!actionMatch) return null;

  const action = actionMatch[1] as LocatorChainOp["action"];
  const afterActionParen = afterGetter.slice(actionMatch[0].length);

  if (action === "click" || action === "waitFor") return { selector, action };

  if (action === "waitForTimeout") {
    const msMatch = afterActionParen.match(/^\s*(\d+)/);
    if (!msMatch) return null;
    return { selector, action, ms: Number(msMatch[1]) };
  }

  const valResult = extractFirstStr(afterActionParen);
  if (!valResult) return null;
  return { selector, action, value: valResult[0] };
}

const LIFECYCLE_METHODS: ReadonlySet<string> = new Set([
  "launch", "newPage", "newContext", "defaultBrowserContext",
  "close", "disconnect",
]);

function pickStr(m: RegExpMatchArray): string | undefined {
  return m[1] ?? m[2] ?? m[3];
}

function pickStr2(m: RegExpMatchArray): [string, string] | undefined {
  const a = m[1] ?? m[2] ?? m[3];
  const b = m[4] ?? m[5] ?? m[6];
  return a !== undefined && b !== undefined ? [a, b] : undefined;
}

/** Heuristic — does this click target look like a write submit?
 *
 * Matches:
 *   - `[type=submit]` / `[type='submit']` — HTML submit attribute
 *   - `role=button[name="..."]` where name contains submit-like word
 *   - `text=Submit` / `text=Post` / etc. — Playwright text selector
 *   - `text="Sign up"` style content with submit-like word
 *
 * Conservative: a missed-positive (read mistakenly classified write) is
 * cheap (user passes `variant: "read"` to override). A missed-negative
 * (write classified as read) silently produces a Plan that can't dedup. */
function isSubmitLikeTarget(target: string): boolean {
  if (RE_SUBMIT_SELECTOR.test(target)) return true;
  if (target.startsWith("role=button") && RE_SUBMIT_NAME.test(target)) return true;
  if (target.startsWith("text=") && RE_SUBMIT_NAME.test(target)) return true;
  return false;
}

// ---------------------------------------------------------------------------
// Convert
// ---------------------------------------------------------------------------

export function playwrightToTap(
  source: string,
  options: PlaywrightToTapOptions,
): PlaywrightToTapResult {
  if (!options.site || !options.name) {
    throw new PlaywrightConversionError(
      "site and name are required in PlaywrightToTapOptions",
      source,
    );
  }

  const lines = source.split(/\r?\n/);
  const ops: Op[] = [];
  const warnings: PlaywrightConversionWarning[] = [];
  let sawSubmitLikeClick = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("//")) continue;

    let matched = false;
    let m: RegExpMatchArray | null;

    if ((m = trimmed.match(RE_GOTO))) {
      const url = pickStr(m);
      if (url !== undefined) {
        ops.push({ op: "nav", url });
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
        if (isSubmitLikeTarget(target)) sawSubmitLikeClick = true;
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
    } else if (RE_COOKIES.test(trimmed)) {
      ops.push({ op: "cookies" });
      matched = true;
    } else if (RE_SCREENSHOT.test(trimmed)) {
      // v2 has no screenshot op — drop with warning.
      warnings.push({
        kind: "screenshot-dropped",
        line: i + 1,
        message:
          "page.screenshot() has no v2 equivalent; dropped from output. " +
          "If you need a snapshot, capture via op:eval over document.title or similar.",
      });
      matched = true;
    } else if (RE_EVALUATE.test(trimmed)) {
      // page.evaluate(fn) → op:eval with mandatory returns.type. Caller
      // must declare returns shape; we default to "object" + TODO warning.
      const fnSrc = trimmed
        .replace(/^await\s+/, "")
        .replace(/^.*?\.evaluate\s*\(/, "")
        .replace(/\)\s*;?\s*$/, "");
      ops.push({
        op: "eval",
        fn: fnSrc,
        returns: { type: "object" },
      });
      warnings.push({
        kind: "eval-fallback",
        line: i + 1,
        message:
          "page.evaluate emitted as op:eval with returns.type='object' (default). " +
          "Verify and adjust the declared return type to match the function's actual output.",
        source: line,
      });
      matched = true;
    } else {
      // Locator chain
      const chain = parseLocatorChain(trimmed);
      if (chain) {
        switch (chain.action) {
          case "click":
            ops.push({ op: "input", kind: "click", target: chain.selector });
            if (isSubmitLikeTarget(chain.selector)) sawSubmitLikeClick = true;
            break;
          case "fill":
            ops.push({ op: "input", kind: "fill", target: chain.selector, value: chain.value! });
            break;
          case "type":
            ops.push({ op: "input", kind: "type", target: chain.selector, value: chain.value! });
            break;
          case "press":
            ops.push({ op: "input", kind: "press", target: chain.selector, value: chain.value! });
            break;
          case "waitFor":
            ops.push({ op: "wait", selector: chain.selector });
            break;
          case "waitForTimeout":
            ops.push({ op: "wait", ms: chain.ms! });
            break;
        }
        matched = true;
      }
    }

    if (!matched) {
      const generic = trimmed.match(RE_PAGE_CALL);
      if (generic) {
        const method = generic[1];
        if (LIFECYCLE_METHODS.has(method)) {
          warnings.push({
            kind: "lifecycle-dropped",
            line: i + 1,
            message: `page.${method}() is test scaffolding — dropped from output.`,
          });
          continue;
        }
        if (options.strict === true) {
          throw new PlaywrightConversionError(
            `Unsupported Playwright API on line ${i + 1}: page.${method}(`,
            source,
            `v1.0 supports goto/click/fill/type/press/waitForSelector/` +
              `waitForTimeout/cookies/evaluate. Run with strict:false to ` +
              `emit op:eval and preserve the original line.`,
            i + 1,
          );
        }
        // Permissive: preserve original line as op:eval. The function body
        // is wrapped to be syntactically valid; runtime execution remains
        // a TODO for the user to complete.
        const fnSrc = `(() => { /* TODO original Playwright line ${i + 1}: ${
          line.replace(/\*\//g, "*\\/")
        } */ return null; })()`;
        ops.push({
          op: "eval",
          fn: fnSrc,
          returns: { type: "object" },
        });
        warnings.push({
          kind: "eval-fallback",
          line: i + 1,
          message:
            `page.${method}() has no direct v2 mapping; emitted as op:eval ` +
            `placeholder. Replace the body with logic that returns a value ` +
            `matching returns.type.`,
          source: line,
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

  // Decide read vs write variant. Caller override wins.
  const variant: "read" | "write" =
    options.variant ?? (sawSubmitLikeClick ? "write" : "read");

  const common = {
    id: { site: options.site, name: options.name },
    description: options.description,
    return: "null",
  } as const;

  let plan: Plan;
  if (variant === "write") {
    warnings.push({
      kind: "todo-key",
      message:
        "Write variant detected via submit-like click. The emitted plan " +
        "carries a placeholder `key: 'TODO_DECLARE_KEY'` — replace with a " +
        "real CEL expression keying on the user-controlled fields (typically " +
        "from $args) before relying on dedup semantics.",
    });
    plan = {
      ...common,
      observe: [],
      act: ops,
      key: "TODO_DECLARE_KEY",
    };
  } else {
    plan = {
      ...common,
      observe: ops,
    };
  }

  // Drop undefined description so JSON output is tight.
  if (plan.description === undefined) {
    delete (plan as { description?: string }).description;
  }

  return { plan, warnings };
}

// ---------------------------------------------------------------------------
// Re-exports for convenience
// ---------------------------------------------------------------------------

export type { Plan, Op } from "@taprun/spec";
