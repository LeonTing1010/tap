/**
 * @taprun/from-puppeteer — Puppeteer source → Tap Flow v2 adapter.
 *
 * Reference implementation that converts a Puppeteer script
 * (.ts / .js source text) into a v2 `Plan` object. Output is conformant
 * with `@taprun/spec@^1.0` (the v2 schema; see ADR
 * `2026-05-04-ecosystem-v2-launch.md` §2.4).
 *
 * Why a separate package from from-playwright: Puppeteer and Playwright
 * share most of the `page.*` API but diverge on a few important calls
 * (no `page.fill`, `keyboard.press` lives on a separate object, the
 * `page.waitForTimeout` deprecation note). Splitting keeps the regex
 * sets unambiguous and the failure modes per-framework legible.
 *
 * v2 mapping (per ADR §2.5):
 *   page.goto(url)              → { op: "nav", url }
 *   page.click(selector)        → { op: "input", kind: "click", target }
 *   page.type(selector, value)  → { op: "input", kind: "type", target, value }
 *   page.keyboard.press(key)    → { op: "input", kind: "press", value: key }
 *                                 (target implicit / focused element)
 *   page.waitForSelector(s)     → { op: "wait", selector }
 *   page.waitForTimeout(ms)     → { op: "wait", ms }
 *                                 (deprecated in modern Puppeteer too,
 *                                  but still common in legacy scripts)
 *   page.cookies()              → { op: "cookies" }
 *   page.$$eval(sel, fn)        → { op: "eval", fn, returns: { type: "array" } }
 *                                 (TODO note in fn comment — author should
 *                                  refine returns.type if known)
 *   page.evaluate(fn)           → { op: "eval", fn, returns: { type: "object" } }
 *                                 (TODO note — declare correct returns.type)
 *   page.screenshot()           → falls through to op:eval (RE_PAGE_CALL
 *                                 permissive default; not silently dropped).
 *                                 In strict:true mode, throws like other
 *                                 unsupported page.* calls.
 *
 * Read vs Write variant heuristic:
 *   Default = read variant (no act/key — whole script becomes `observe`).
 *   Write = if any click looks submit-like (matches /submit|login|signin|signup|
 *           buy|checkout|publish|post/ in selector or button text), or any
 *           page.type fills a password field, the script is treated as a write
 *           and emitted as the `act` variant with a generated `key`.
 *
 * Anything outside the supported set becomes:
 *   - permissive (default): { op: "eval", fn: "...", returns: { type: "object" } }
 *     wrapping the original line as a string comment, with a TODO marker.
 *   - strict: throws PuppeteerConversionError.
 *
 * NOTE: v2 has NO op:exec. All legacy escape paths route through op:eval
 * with a mandatory `returns.type` declaration. The user MUST fix up
 * `returns.type` before the flow will validate at runtime — `lint.ts`
 * will flag any eval where returns.type is structurally unknown.
 */

import type { Op, Flow } from "@taprun/spec";

export interface PuppeteerToTapOptions {
  site: string;
  name: string;
  /** Force the variant. Auto-detected from heuristic when omitted. */
  intent?: "read" | "write";
  description?: string;
  /** Emit error on any unsupported page.* call instead of an op:eval
   *  fallback. Default false. */
  strict?: boolean;
}

export class PuppeteerConversionError extends Error {
  override readonly name = "PuppeteerConversionError";
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

const STR =
  /(?:"((?:[^"\\]|\\.)*)"|'((?:[^'\\]|\\.)*)'|`((?:[^`\\$]|\\.)*)`)/.source;
const WS = /\s*/.source;

function callRe(method: string, n: 0 | 1 | 2): RegExp {
  if (n === 0) return new RegExp(`\\.${method}\\s*\\(`);
  if (n === 1) {
    return new RegExp(`\\.${method}\\s*\\(${WS}${STR}${WS}\\s*[,)]`);
  }
  return new RegExp(
    `\\.${method}\\s*\\(${WS}${STR}${WS},${WS}${STR}${WS}\\s*[,)]`,
  );
}

const RE_GOTO = callRe("goto", 1);
const RE_CLICK = callRe("click", 1);
const RE_TYPE = callRe("type", 2);
const RE_WAIT_SEL = callRe("waitForSelector", 1);
const RE_WAIT_MS = /\.waitForTimeout\s*\(\s*(\d+)\s*\)/;
const RE_COOKIES = /\.cookies\s*\(/;
// keyboard.press("Enter") — note `keyboard.` prefix to avoid colliding
// with locator/element.press in newer puppeteer.
const RE_KEYBOARD_PRESS = new RegExp(
  `\\bkeyboard\\.press\\s*\\(${WS}${STR}${WS}\\s*[,)]`,
);
// page.$$eval(selector, fn[, ...args])
const RE_DOLLAR_DOLLAR_EVAL = new RegExp(
  `\\.\\$\\$eval\\s*\\(${WS}${STR}`,
);
// page.evaluate(fn[, ...args])
const RE_EVALUATE = /\.evaluate\s*\(/;
// Generic page.* call detector for permissive-mode fallback.
const RE_PAGE_CALL =
  /(?:page|context|browser|frame)\s*\.\s*([a-zA-Z_$][\w$]*)\s*\(/;

/** Lifecycle methods that are test scaffolding, not user actions —
 *  silently dropped (no flow op emitted, no warning). */
const LIFECYCLE_METHODS: ReadonlySet<string> = new Set([
  "launch",
  "newPage",
  "newContext",
  "defaultBrowserContext",
  "close",
  "disconnect",
]);

/** Heuristic: substring match against selector / value to decide whether
 *  the action mutates server state. */
const WRITE_RX = /submit|login|sign[\s_-]?in|sign[\s_-]?up|register|checkout|buy|publish|post|delete|create|update/i;
const PASSWORD_RX = /password|passwd|pwd/i;

function pickStr(m: RegExpMatchArray): string | undefined {
  return m[1] ?? m[2] ?? m[3];
}

function pickStr2(m: RegExpMatchArray): [string, string] | undefined {
  const a = m[1] ?? m[2] ?? m[3];
  const b = m[4] ?? m[5] ?? m[6];
  return a !== undefined && b !== undefined ? [a, b] : undefined;
}

export function puppeteerToTap(
  source: string,
  options: PuppeteerToTapOptions,
): Flow {
  if (!options.site || !options.name) {
    throw new PuppeteerConversionError(
      "site and name are required in PuppeteerToTapOptions",
      source,
    );
  }

  const lines = source.split(/\r?\n/);
  const ops: Op[] = [];
  let detectedWrite = false;

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
    } else if ((m = trimmed.match(RE_TYPE))) {
      const pair = pickStr2(m);
      if (pair) {
        ops.push({
          op: "input",
          kind: "type",
          target: pair[0],
          value: pair[1],
        });
        if (PASSWORD_RX.test(pair[0])) detectedWrite = true;
        matched = true;
      }
    } else if ((m = trimmed.match(RE_KEYBOARD_PRESS))) {
      const key = pickStr(m);
      if (key !== undefined) {
        ops.push({ op: "input", kind: "press", value: key });
        // Enter on a form is a likely submit
        if (/^enter$/i.test(key)) detectedWrite = true;
        matched = true;
      }
    } else if ((m = trimmed.match(RE_CLICK))) {
      const target = pickStr(m);
      if (target !== undefined) {
        ops.push({ op: "input", kind: "click", target });
        if (WRITE_RX.test(target)) detectedWrite = true;
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
    } else if ((m = trimmed.match(RE_DOLLAR_DOLLAR_EVAL))) {
      // page.$$eval(sel, fn) — selector available, fn body left as a
      // structural placeholder. Author must refine returns.type.
      ops.push({
        op: "eval",
        fn:
          `/* TODO: paste original page.$$eval body from line ${i + 1};` +
          ` declare correct returns.type. v2 forbids op:exec — ` +
          `escape hatch is op:eval with mandatory returns. */ () => []`,
        returns: { type: "array" },
      });
      matched = true;
    } else if (RE_EVALUATE.test(trimmed)) {
      ops.push({
        op: "eval",
        fn:
          `/* TODO: paste original page.evaluate body from line ${i + 1};` +
          ` declare correct returns.type. v2 forbids op:exec — ` +
          `escape hatch is op:eval with mandatory returns. */ () => ({})`,
        returns: { type: "object" },
      });
      matched = true;
    }

    if (!matched) {
      const generic = trimmed.match(RE_PAGE_CALL);
      if (generic) {
        const method = generic[1];
        // Lifecycle methods (browser.launch / page.close / etc.) are
        // test scaffolding — silently drop them.
        if (LIFECYCLE_METHODS.has(method)) continue;
        if (options.strict === true) {
          throw new PuppeteerConversionError(
            `Unsupported Puppeteer API on line ${i + 1}: ${method}(`,
            source,
            `MVP v2 supports goto/click/type/keyboard.press/waitForSelector/` +
              `waitForTimeout/cookies/$$eval/evaluate. ` +
              `Run with strict:false to emit { op: "eval" } and preserve ` +
              `the original line as a TODO comment.`,
            i + 1,
          );
        }
        // Permissive fallback — emit an eval shell with returns: object.
        // Author MUST fix up returns.type and fn body before the plan
        // can pass v2 lint at runtime.
        ops.push({
          op: "eval",
          fn:
            `/* TODO: original Puppeteer line ${i + 1} not auto-` +
            `converted: ${line.replace(/\*\//g, "*\\/")} ` +
            `— v2 has no op:exec; rewrite as flow ops or declare ` +
            `correct returns.type. */ () => ({})`,
          returns: { type: "object" },
        });
      }
    }
  }

  if (ops.length === 0) {
    throw new PuppeteerConversionError(
      "no Puppeteer API calls detected in source — adapter has nothing to convert",
      source,
      `Add at least one await page.goto(...) or page.click(...) to the source.`,
    );
  }

  const intent = options.intent ?? (detectedWrite ? "write" : "read");
  const id = { site: options.site, name: options.name };

  if (intent === "write") {
    // Write variant — act + key both required by v2 Flow discriminated
    // union. We synthesize a placeholder key from site/name; author MUST
    // refine to a real CEL expression that uniquely identifies the
    // intended side-effect (per ADR §10 Plan.key dedup contract).
    const plan: Flow = {
      id,
      ...(options.description ? { description: options.description } : {}),
      act: ops,
      key: `"${options.site}:${options.name}:" + string($args)`,
      return: "true",
    };
    return flow;
  }

  // Read variant — observe only, no act/key.
  const plan: Flow = {
    id,
    ...(options.description ? { description: options.description } : {}),
    observe: ops,
    return: "true",
  };
  return flow;
}
