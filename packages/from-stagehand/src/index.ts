/**
 * @taprun/from-stagehand — Stagehand source → Tap plan-v1 adapter.
 *
 * Stagehand (browserbase/stagehand) ships natural-language browser
 * automation on top of Playwright. Two API surfaces coexist in user
 * scripts:
 *
 *   1. Plain Playwright via stagehand.context.pages()[0] — these calls
 *      (page.goto, page.click, page.fill, etc.) are deterministic and
 *      get mapped to plan-v1 ops the same way @taprun/from-playwright
 *      does.
 *
 *   2. Natural-language Stagehand calls — stagehand.act(prompt),
 *      stagehand.extract(prompt, schema), stagehand.observe(),
 *      stagehand.agent().execute(prompt). These resolve to a sequence
 *      of browser actions ONLY at runtime via an LLM. They are
 *      structurally non-deterministic and cannot be precompiled into
 *      plan-v1 ops without running the LLM.
 *
 * This adapter therefore takes a pragmatic approach:
 *
 *   - Deterministic page.* calls → mapped 1:1 to plan ops
 *   - Stagehand NL calls          → emitted as { op: "exec",
 *                                    allowUnverifiable: true } with the
 *                                    original prompt preserved in the
 *                                    fn comment for human review
 *
 * The resulting plan is partially deterministic — Tap can `doctor` and
 * `heal` the page.* portions; the NL portions remain a black box that
 * the user must re-resolve via Stagehand at runtime. To get fully
 * deterministic plans, users should record a Stagehand trace and use a
 * future trace-based adapter (out of MVP scope).
 *
 * Positioning: this is a complement to Stagehand, not a competitor.
 * "Run your Stagehand script through Tap to monitor what stays
 * deterministic and audit what doesn't."
 */

import type {
  ExecutionPlan,
  Op,
  TapAnnotation,
} from "@taprun/spec";

export interface StagehandToTapOptions {
  site: string;
  name: string;
  intent?: "read" | "write";
  description?: string;
  target?: string;
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

// Stagehand NL calls — capture the prompt for the exec op comment.
// Match `<thing>.act("prompt")` — `<thing>` may be `stagehand`, `sh`, or
// any identifier the user destructured.
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

function pickStr(m: RegExpMatchArray): string | undefined {
  return m[1] ?? m[2] ?? m[3];
}

function pickStr2(m: RegExpMatchArray): [string, string] | undefined {
  const a = m[1] ?? m[2] ?? m[3];
  const b = m[4] ?? m[5] ?? m[6];
  return a !== undefined && b !== undefined ? [a, b] : undefined;
}

function safeFnComment(label: string, lineNo: number, original: string): string {
  return `async function(handle, args) { /* stagehand ${label} (line ${lineNo}, requires LLM at runtime — see plan.allowUnverifiable): ${
    original.replace(/\*\//g, "*\\/")
  } */ }`;
}

export function stagehandToTap(
  source: string,
  options: StagehandToTapOptions,
): TapAnnotation {
  if (!options.site || !options.name) {
    throw new StagehandConversionError(
      "site and name are required in StagehandToTapOptions",
      source,
    );
  }

  const lines = source.split(/\r?\n/);
  const ops: Op[] = [];
  let firstNavUrl: string | undefined;
  let nlCallCount = 0; // number of stagehand.* NL calls emitted as exec

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
      ops.push({
        op: "exec",
        fn: safeFnComment(`act("${prompt.replace(/"/g, "\\\"")}")`, i + 1, line),
      });
      nlCallCount++;
      matched = true;
    } else if ((m = trimmed.match(RE_STAGEHAND_EXTRACT))) {
      const prompt = pickStr(m) ?? "";
      ops.push({
        op: "exec",
        fn: safeFnComment(`extract("${prompt.replace(/"/g, "\\\"")}")`, i + 1, line),
      });
      nlCallCount++;
      matched = true;
    } else if (RE_STAGEHAND_OBSERVE.test(trimmed)) {
      ops.push({
        op: "exec",
        fn: safeFnComment("observe", i + 1, line),
      });
      nlCallCount++;
      matched = true;
    } else if (
      RE_STAGEHAND_AGENT.test(trimmed) || (m = trimmed.match(RE_STAGEHAND_EXECUTE))
    ) {
      const prompt = m ? pickStr(m) ?? "" : "";
      ops.push({
        op: "exec",
        fn: safeFnComment(
          prompt ? `agent.execute("${prompt.replace(/"/g, "\\\"")}")` : "agent",
          i + 1,
          line,
        ),
      });
      nlCallCount++;
      matched = true;
    }

    // -- Deterministic Playwright APIs ---------------------------------
    if (!matched && (m = trimmed.match(RE_GOTO))) {
      const url = pickStr(m);
      if (url !== undefined) {
        ops.push({ op: "nav", url });
        if (firstNavUrl === undefined) firstNavUrl = url;
        matched = true;
      }
    } else if (!matched && (m = trimmed.match(RE_FILL))) {
      const pair = pickStr2(m);
      if (pair) {
        ops.push({ op: "input", kind: "fill", target: pair[0], value: pair[1] });
        matched = true;
      }
    } else if (!matched && (m = trimmed.match(RE_TYPE))) {
      const pair = pickStr2(m);
      if (pair) {
        ops.push({ op: "input", kind: "type", target: pair[0], value: pair[1] });
        matched = true;
      }
    } else if (!matched && (m = trimmed.match(RE_PRESS))) {
      const pair = pickStr2(m);
      if (pair) {
        ops.push({ op: "input", kind: "press", target: pair[0], value: pair[1] });
        matched = true;
      }
    } else if (!matched && (m = trimmed.match(RE_CLICK))) {
      const target = pickStr(m);
      if (target !== undefined) {
        ops.push({ op: "input", kind: "click", target });
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
      ops.push({ op: "screenshot" });
      matched = true;
    }

    if (!matched) {
      const generic = trimmed.match(RE_PAGE_CALL);
      if (generic) {
        const method = generic[1];
        if (LIFECYCLE_METHODS.has(method)) continue;
        // Permissive — preserve as exec.
        ops.push({
          op: "exec",
          fn: safeFnComment(`${method}(...) [unmatched]`, i + 1, line),
        });
        nlCallCount++;
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

  const target = options.target ?? firstNavUrl ??
    `urn:stagehand:${options.site}:${options.name}`;

  const body: ExecutionPlan = {
    type: "tap:ExecutionPlan",
    site: options.site,
    name: options.name,
    intent: options.intent ?? "read",
    ops,
  };
  if (options.description) body.description = options.description;
  // Any NL call (or unmatched permissive) flips the plan to unverifiable.
  if (nlCallCount > 0) body.allowUnverifiable = true;

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
      id: "https://taprun.dev/from-stagehand",
      type: "SoftwareAgent",
      version: "0.x",
    },
  };
}
