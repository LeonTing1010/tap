/**
 * @taprun/from-stagehand — Stagehand source → Tap Plan v2 adapter.
 *
 * Stagehand (browserbase/stagehand) ships natural-language browser
 * automation on top of Playwright. Two API surfaces coexist in user
 * scripts:
 *
 *   1. Plain Playwright via stagehand.context.pages()[0] — these calls
 *      (page.goto, page.click, page.fill, etc.) are deterministic and
 *      get mapped to plan-v2 ops the same way @taprun/from-playwright
 *      does.
 *
 *   2. Natural-language Stagehand calls — stagehand.act(prompt),
 *      stagehand.extract(prompt, schema), stagehand.observe(),
 *      stagehand.agent().execute(prompt). These resolve to a sequence
 *      of browser actions ONLY at runtime via an LLM. They are
 *      structurally non-deterministic and cannot be precompiled into
 *      plan-v2 ops without running the LLM.
 *
 * v2 mapping (per ADR `2026-05-04-ecosystem-v2-launch.md` §2.4 / §2.5):
 *   page.goto(url)              → { op: "nav", url }
 *   page.click(selector)        → { op: "input", kind: "click", target }
 *   page.fill(selector, value)  → { op: "input", kind: "fill", target, value }
 *   page.type(selector, value)  → { op: "input", kind: "type", target, value }
 *   page.press(selector, key)   → { op: "input", kind: "press", target, value }
 *   page.waitForSelector(s)     → { op: "wait", selector }
 *   page.waitForTimeout(ms)     → { op: "wait", ms }
 *   stagehand.act(prompt)       → { op: "eval", returns: { type: "object" }, fn: TODO with prompt }
 *   stagehand.extract(prompt)   → { op: "eval", returns: { type: "object" }, fn: TODO with prompt }
 *   stagehand.observe(...)      → { op: "eval", returns: { type: "array"  }, fn: TODO }
 *   stagehand.agent().execute() → { op: "eval", returns: { type: "object" }, fn: TODO }
 *
 * NOTE: v2 has NO op:exec and NO op:screenshot. NL Stagehand calls land
 * on op:eval with a mandatory `returns.type` declaration; the original
 * prompt is preserved as a TODO comment for the author to refine.
 * Lint will flag any op:eval where `returns.type` is structurally wrong.
 *
 * Read vs Write variant heuristic (mirrors from-puppeteer / from-playwright):
 *   Default = read variant (no act/key — whole script becomes `observe`).
 *   Write = if any click selector or button text matches /submit|login|.../
 *           or any page.fill/type targets a password field, the script
 *           is emitted as the `act` variant with a generated `key`.
 *
 * Anything outside the supported set falls through to op:eval with
 * returns.type = "object" and a TODO comment carrying the original line.
 * Strict mode throws a StagehandConversionError instead.
 */

import type { Op, Plan } from "@taprun/spec";

export interface StagehandToTapOptions {
  site: string;
  name: string;
  /** Force the variant. Auto-detected from heuristic when omitted. */
  intent?: "read" | "write";
  description?: string;
  /** Emit error on any unsupported call instead of an op:eval fallback. */
  strict?: boolean;
}

export class StagehandConversionError extends Error {
  override readonly name = "StagehandConversionError";
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

function callRe(method: string, n: 1 | 2): RegExp {
  if (n === 1) {
    return new RegExp(`\\.${method}\\s*\\(${WS}${STR}${WS}\\s*[,)]`);
  }
  return new RegExp(
    `\\.${method}\\s*\\(${WS}${STR}${WS},${WS}${STR}${WS}\\s*[,)]`,
  );
}

// Deterministic Playwright APIs (Stagehand exposes them via .context.pages()).
const RE_GOTO = callRe("goto", 1);
const RE_CLICK = callRe("click", 1);
const RE_FILL = callRe("fill", 2);
const RE_TYPE = callRe("type", 2);
const RE_PRESS = callRe("press", 2);
const RE_WAIT_SEL = callRe("waitForSelector", 1);
const RE_WAIT_MS = /\.waitForTimeout\s*\(\s*(\d+)\s*\)/;
const RE_SCREENSHOT = /\.screenshot\s*\(/;

// Stagehand NL calls — capture the prompt for the eval-op TODO comment.
const RE_STAGEHAND_ACT = new RegExp(`\\.act\\s*\\(${WS}${STR}`);
const RE_STAGEHAND_EXTRACT = new RegExp(`\\.extract\\s*\\(${WS}${STR}`);
const RE_STAGEHAND_OBSERVE = /\.observe\s*\(/;
// stagehand.agent().execute("...") — easier as two patterns.
const RE_STAGEHAND_AGENT = /\.agent\s*\(\s*\)/;
const RE_STAGEHAND_EXECUTE = new RegExp(`\\.execute\\s*\\(${WS}${STR}`);

const RE_PAGE_CALL =
  /(?:page|context|browser|locator|stagehand|sh)\s*\.\s*([a-zA-Z_$][\w$]*)\s*\(/;

const LIFECYCLE_METHODS: ReadonlySet<string> = new Set([
  // Setup / teardown
  "init",
  "launch",
  "newPage",
  "newContext",
  "defaultBrowserContext",
  "close",
  "disconnect",
  // Accessors (returning page/context/browser handle, not user actions)
  "pages",
  "context",
  "page",
  "browser",
]);

/** Heuristic: substring match against selector / value to decide whether
 *  the action mutates server state. */
const WRITE_RX =
  /submit|login|sign[\s_-]?in|sign[\s_-]?up|register|checkout|buy|publish|post|delete|create|update/i;
const PASSWORD_RX = /password|passwd|pwd/i;

function pickStr(m: RegExpMatchArray): string | undefined {
  return m[1] ?? m[2] ?? m[3];
}

function pickStr2(m: RegExpMatchArray): [string, string] | undefined {
  const a = m[1] ?? m[2] ?? m[3];
  const b = m[4] ?? m[5] ?? m[6];
  return a !== undefined && b !== undefined ? [a, b] : undefined;
}

function safeForComment(s: string): string {
  return s.replace(/\*\//g, "*\\/");
}

function nlEvalOp(
  label: string,
  lineNo: number,
  original: string,
  returns: "object" | "array",
): Op {
  return {
    op: "eval",
    fn:
      `/* TODO: stagehand ${label} on line ${lineNo} requires an LLM at ` +
      `runtime — v2 has no op:exec, declare correct returns.type and ` +
      `replace this stub with deterministic ops or a real eval body. ` +
      `Original: ${safeForComment(original)} */ () => (${
        returns === "array" ? "[]" : "{}"
      })`,
    returns: { type: returns },
  };
}

export function stagehandToTap(
  source: string,
  options: StagehandToTapOptions,
): Plan {
  if (!options.site || !options.name) {
    throw new StagehandConversionError(
      "site and name are required in StagehandToTapOptions",
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

    // -- Stagehand NL calls (check FIRST so they don't fall through to
    //    the page-API regex which would mis-match `.act(` / `.extract(`).
    if ((m = trimmed.match(RE_STAGEHAND_ACT))) {
      const prompt = pickStr(m) ?? "";
      ops.push(
        nlEvalOp(
          `act("${prompt.replace(/"/g, "\\\"")}")`,
          i + 1,
          line,
          "object",
        ),
      );
      // Treat NL act() as a likely write — Stagehand `act` typically
      // mutates page state ("click on...", "fill in..."). Even if the
      // prompt is read-flavored, an LLM-driven action is a state-touching
      // operation by its nature.
      if (WRITE_RX.test(prompt)) detectedWrite = true;
      matched = true;
    } else if ((m = trimmed.match(RE_STAGEHAND_EXTRACT))) {
      const prompt = pickStr(m) ?? "";
      ops.push(
        nlEvalOp(
          `extract("${prompt.replace(/"/g, "\\\"")}")`,
          i + 1,
          line,
          "object",
        ),
      );
      matched = true;
    } else if (RE_STAGEHAND_OBSERVE.test(trimmed)) {
      ops.push(nlEvalOp("observe", i + 1, line, "array"));
      matched = true;
    } else if (
      RE_STAGEHAND_AGENT.test(trimmed) || (m = trimmed.match(RE_STAGEHAND_EXECUTE))
    ) {
      const prompt = m ? pickStr(m) ?? "" : "";
      ops.push(
        nlEvalOp(
          prompt
            ? `agent.execute("${prompt.replace(/"/g, "\\\"")}")`
            : "agent",
          i + 1,
          line,
          "object",
        ),
      );
      // agent.execute is open-ended — assume write to be safe.
      if (prompt) detectedWrite = true;
      matched = true;
    }

    // -- Deterministic Playwright APIs ---------------------------------
    if (!matched && (m = trimmed.match(RE_GOTO))) {
      const url = pickStr(m);
      if (url !== undefined) {
        ops.push({ op: "nav", url });
        matched = true;
      }
    } else if (!matched && (m = trimmed.match(RE_FILL))) {
      const pair = pickStr2(m);
      if (pair) {
        ops.push({ op: "input", kind: "fill", target: pair[0], value: pair[1] });
        if (PASSWORD_RX.test(pair[0])) detectedWrite = true;
        matched = true;
      }
    } else if (!matched && (m = trimmed.match(RE_TYPE))) {
      const pair = pickStr2(m);
      if (pair) {
        ops.push({ op: "input", kind: "type", target: pair[0], value: pair[1] });
        if (PASSWORD_RX.test(pair[0])) detectedWrite = true;
        matched = true;
      }
    } else if (!matched && (m = trimmed.match(RE_PRESS))) {
      const pair = pickStr2(m);
      if (pair) {
        ops.push({ op: "input", kind: "press", target: pair[0], value: pair[1] });
        if (/^enter$/i.test(pair[1])) detectedWrite = true;
        matched = true;
      }
    } else if (!matched && (m = trimmed.match(RE_CLICK))) {
      const target = pickStr(m);
      if (target !== undefined) {
        ops.push({ op: "input", kind: "click", target });
        if (WRITE_RX.test(target)) detectedWrite = true;
        matched = true;
      }
    } else if (!matched && (m = trimmed.match(RE_WAIT_SEL))) {
      const selector = pickStr(m);
      if (selector !== undefined) {
        ops.push({ op: "wait", selector });
        matched = true;
      }
    } else if (!matched && (m = trimmed.match(RE_WAIT_MS))) {
      const ms = Number(m[1]);
      if (!Number.isNaN(ms)) {
        ops.push({ op: "wait", ms });
        matched = true;
      }
    } else if (!matched && RE_SCREENSHOT.test(trimmed)) {
      // v2 has no op:screenshot. Drop with a TODO eval stub so the line
      // isn't silently lost.
      ops.push({
        op: "eval",
        fn:
          `/* TODO: page.screenshot() on line ${i + 1} has no v2 ` +
          `equivalent (op:screenshot was retired in plan-v2). ` +
          `Either delete or replace with an out-of-band capture. */ () => ({})`,
        returns: { type: "object" },
      });
      matched = true;
    }

    if (!matched) {
      const generic = trimmed.match(RE_PAGE_CALL);
      if (generic) {
        const method = generic[1];
        if (LIFECYCLE_METHODS.has(method)) continue;
        if (options.strict === true) {
          throw new StagehandConversionError(
            `Unsupported Stagehand/Playwright API on line ${i + 1}: ${method}(`,
            source,
            `MVP v2 supports goto / click / fill / type / press / ` +
              `waitForSelector / waitForTimeout / stagehand.{act,extract,` +
              `observe,agent.execute}. Run with strict:false to emit ` +
              `{ op: "eval" } and preserve the original line as a TODO.`,
            i + 1,
          );
        }
        // Permissive fallback — emit an eval shell with returns: object.
        ops.push({
          op: "eval",
          fn:
            `/* TODO: original Stagehand line ${i + 1} not auto-` +
            `converted: ${safeForComment(line)} ` +
            `— v2 has no op:exec; rewrite as plan ops or declare ` +
            `correct returns.type. */ () => ({})`,
          returns: { type: "object" },
        });
      }
    }
  }

  if (ops.length === 0) {
    throw new StagehandConversionError(
      "no Stagehand or Playwright API calls detected in source",
      source,
      `Add at least one stagehand.act / page.goto / similar call.`,
    );
  }

  const intent = options.intent ?? (detectedWrite ? "write" : "read");
  const id = { site: options.site, name: options.name };

  if (intent === "write") {
    const plan: Plan = {
      id,
      ...(options.description ? { description: options.description } : {}),
      act: ops,
      key: `"${options.site}:${options.name}:" + string($args)`,
      return: "true",
    };
    return plan;
  }

  // Read variant — observe only, no act/key.
  const plan: Plan = {
    id,
    ...(options.description ? { description: options.description } : {}),
    observe: ops,
    return: "true",
  };
  return plan;
}
