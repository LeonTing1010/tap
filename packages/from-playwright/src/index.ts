/**
 * @taprun/from-playwright — Playwright source → Tap plan-v1 adapter.
 *
 * Reference implementation that converts a Playwright test script
 * (.ts / .js source text) into a TapAnnotation envelope. Output passes
 * runConformance() from @taprun/spec.
 *
 * Why this package exists: Playwright is the dominant browser-automation
 * SDK in the Node ecosystem (47M weekly npm downloads — 60× the next
 * SDK). Most users with broken scrapers wrote them in Playwright. This
 * adapter is the on-ramp from "I have a Playwright script" to "Tap can
 * monitor and heal it."
 *
 * STATE: Iteration 1 — RED stub. The real converter lands in Iteration 2.
 *
 * SCOPE (planned):
 *   IN  page.goto(url)              → { op: "nav", url }
 *   IN  page.click(selector)        → { op: "input", kind: "click", target: selector }
 *   IN  page.fill(selector, value)  → { op: "input", kind: "fill", target, value }
 *   IN  page.type(selector, value)  → { op: "input", kind: "type", target, value }
 *   IN  page.press(selector, key)   → { op: "input", kind: "press", target, value: key }
 *   IN  page.locator(s).textContent() → { op: "extract", root: s, per_item: { text: "" } }
 *   IN  page.waitForSelector(s)     → { op: "wait", selector }
 *   IN  page.waitForTimeout(ms)     → { op: "wait", ms }
 *   IN  page.screenshot()           → { op: "screenshot" }
 *
 * OUT OF SCOPE for v0.x (escaped via { op: "exec" } with allowUnverifiable):
 *   - Custom test fixtures
 *   - expect() assertions (these belong in health.non_empty / authoritative)
 *   - Playwright traces (different format — separate adapter)
 *   - Multi-page / context (single-page assumed)
 */

import type { TapAnnotation } from "@taprun/spec";

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
}

export class PlaywrightConversionError extends Error {
  override readonly name = "PlaywrightConversionError";
  readonly source: string;
  readonly hint?: string;

  constructor(message: string, source: string, hint?: string) {
    super(message);
    this.source = source;
    this.hint = hint;
  }
}

/**
 * Convert Playwright source text into a TapAnnotation.
 *
 * Iteration 1 stub: throws PlaywrightConversionError("not-implemented")
 * unconditionally. Iteration 2 wires the real conversion.
 */
export function playwrightToTap(
  source: string,
  options: PlaywrightToTapOptions,
): TapAnnotation {
  // TODO(iter-2): regex-then-AST conversion of page.* calls.
  void source;
  void options;
  throw new PlaywrightConversionError(
    "playwrightToTap is not implemented yet (Iteration 1 stub).",
    source,
    "Iteration 2 will land minimal page.goto / click / fill / type / wait / screenshot mapping.",
  );
}
