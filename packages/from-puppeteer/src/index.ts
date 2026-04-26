/**
 * @taprun/from-puppeteer — Puppeteer source → Tap plan-v1 adapter.
 *
 * Reference implementation that converts a Puppeteer script
 * (.ts / .js source text) into a TapAnnotation envelope. Output passes
 * runConformance() from @taprun/spec.
 *
 * Why a separate package from from-playwright: Puppeteer and Playwright
 * share most of the `page.*` API but diverge on a few important calls
 * (no `page.fill`, `keyboard.press` lives on a separate object, the
 * `page.waitForTimeout` deprecation note). Splitting keeps the regex
 * sets unambiguous and the failure modes per-framework legible.
 *
 * MVP coverage:
 *   page.goto(url)              → { op: "nav", url }
 *   page.click(selector)        → { op: "input", kind: "click", target }
 *   page.type(selector, value)  → { op: "input", kind: "fill", target, value }
 *                                 (Puppeteer's `type` semantically fills;
 *                                  we map to plan-v1 "fill" for the
 *                                  cross-adapter consistency story)
 *   page.keyboard.press(key)    → { op: "input", kind: "press", value: key }
 *                                 (target is implicit / focused element)
 *   page.waitForSelector(s)     → { op: "wait", selector }
 *   page.waitForTimeout(ms)     → { op: "wait", ms }
 *                                 (deprecated in modern Puppeteer but
 *                                  still common in scripts users want
 *                                  to convert)
 *   page.screenshot()           → { op: "screenshot" }
 *
 * Limitations match from-playwright (variable-bound selectors fall
 * through to permissive exec; trailing line comments stay visible).
 * Out-of-MVP page.* calls become { op: "exec", allowUnverifiable: true }
 * with original-line preserved in the fn comment, or throw under
 * `strict: true`.
 */

import type {
  ExecutionPlan,
  Op,
  TapAnnotation,
} from "@taprun/spec";

export interface PuppeteerToTapOptions {
  site: string;
  name: string;
  intent?: "read" | "write";
  description?: string;
  target?: string;
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
const RE_SCREENSHOT = /\.screenshot\s*\(/;
// keyboard.press("Enter") — note `keyboard.` prefix to avoid colliding
// with locator/element.press in newer puppeteer.
const RE_KEYBOARD_PRESS = new RegExp(
  `\\bkeyboard\\.press\\s*\\(${WS}${STR}${WS}\\s*[,)]`,
);
// Generic page.* call detector for permissive-mode fallback.
const RE_PAGE_CALL =
  /(?:page|context|browser|frame)\s*\.\s*([a-zA-Z_$][\w$]*)\s*\(/;

/** Lifecycle methods that are test scaffolding, not user actions —
 *  silently dropped (no plan op emitted, no warning). */
const LIFECYCLE_METHODS: ReadonlySet<string> = new Set([
  "launch",
  "newPage",
  "newContext",
  "defaultBrowserContext",
  "close",
  "disconnect",
]);

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
): TapAnnotation {
  if (!options.site || !options.name) {
    throw new PuppeteerConversionError(
      "site and name are required in PuppeteerToTapOptions",
      source,
    );
  }

  const lines = source.split(/\r?\n/);
  const ops: Op[] = [];
  let firstNavUrl: string | undefined;

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
        if (firstNavUrl === undefined) firstNavUrl = url;
        matched = true;
      }
    } else if ((m = trimmed.match(RE_TYPE))) {
      const pair = pickStr2(m);
      if (pair) {
        // Puppeteer's page.type semantically fills the element. Map to
        // plan-v1 "fill" so consumers don't need to know which framework
        // produced the plan.
        ops.push({
          op: "input",
          kind: "fill",
          target: pair[0],
          value: pair[1],
        });
        matched = true;
      }
    } else if ((m = trimmed.match(RE_KEYBOARD_PRESS))) {
      const key = pickStr(m);
      if (key !== undefined) {
        // No explicit target — focused element receives the press.
        ops.push({ op: "input", kind: "press", value: key });
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
            `MVP supports goto/click/type/keyboard.press/waitForSelector/waitForTimeout/screenshot. ` +
              `Run with strict:false to emit { op: "exec" } and preserve the original line.`,
            i + 1,
          );
        }
        ops.push({
          op: "exec",
          fn: `async function(handle, args) { /* original Puppeteer line ${
            i + 1
          } not auto-converted: ${line.replace(/\*\//g, "*\\/")} */ }`,
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

  const target = options.target ?? firstNavUrl ??
    `urn:puppeteer:${options.site}:${options.name}`;

  const body: ExecutionPlan = {
    type: "tap:ExecutionPlan",
    site: options.site,
    name: options.name,
    intent: options.intent ?? "read",
    ops,
  };
  if (options.description) body.description = options.description;
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
      id: "https://taprun.dev/from-puppeteer",
      type: "SoftwareAgent",
      version: "0.x",
    },
  };
}
