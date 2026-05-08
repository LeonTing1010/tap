/**
 * Constraint: extension self-heals MV3 SW idle die + always uses
 * managed background tabs for daemon-driven navs.
 *
 * Classification: safety / what — violations cause silent peer_unreachable
 * spurious failures and active-tab clobbering during daemon ops.
 *
 * Per ADR `2026-05-08-failure-detection-phase-2.md` §2C:
 *   (i)  chrome.alarms keep-alive prevents MV3 SW idle (~30s timeout) from
 *        firing peer_unreachable to engine.
 *   (ii) fromDaemon exemption deleted — daemon-driven navs ALWAYS open a
 *        managed background tab when active is chrome://, never clobber.
 *
 * Adversarial framing (Phase 1a):
 *   "If a half-implementation made this test pass, it could (a) add the
 *    chrome.alarms.create call but never wire onAlarm.addListener (no-op
 *    timer that doesn't actually wake SW) — caught by Rule (i)/2; (b)
 *    delete the !fromDaemon expression but introduce a different
 *    bypass like `if (isInternal && something_else)` that lets daemon
 *    navs through — caught by Rule (ii)/2 which asserts the strict
 *    isInternal-only guard pattern."
 *
 * Run: node extension/test/self-heal.test.mjs
 */

import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";

const BG_SRC = readFileSync(
  new URL("../background.js", import.meta.url),
  "utf-8",
);

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    passed++;
    console.log(`  \x1b[32m✓\x1b[0m ${name}`);
  } catch (e) {
    failed++;
    console.log(`  \x1b[31m✗\x1b[0m ${name}`);
    console.log(`    ${e.message}`);
  }
}

// ═══════════════════════════════════════════════════════════
// Rule (i): MV3 SW keep-alive via chrome.alarms
// Why: MV3 SW unloads after ~30s of inactivity. Without a keep-alive,
// idle daemon connections produce spurious peer_unreachable on next
// op; classifyOpFailure routes those to reconnect_extension, but the
// root cause is fixable here, not at the engine layer.
// ═══════════════════════════════════════════════════════════

console.log("\n  -- Rule (i): MV3 SW keep-alive --\n");

test("chrome.alarms.create with name 'tap-keepalive' exists", () => {
  // The name string is part of the contract — onAlarm dispatch matches
  // on it, and arch tests cite it directly.
  assert(
    /chrome\.alarms\.create\s*\(\s*["']tap-keepalive["']/.test(BG_SRC),
    "background.js must call chrome.alarms.create with name 'tap-keepalive'",
  );
});

test("chrome.alarms.onAlarm.addListener wired to keepalive", () => {
  assert(
    /chrome\.alarms\.onAlarm\.addListener/.test(BG_SRC),
    "background.js must register a chrome.alarms.onAlarm listener",
  );
  // Listener body must reference the keepalive alarm name (otherwise it
  // would be a no-op dispatcher matching nothing).
  const listenerStart = BG_SRC.indexOf("chrome.alarms.onAlarm.addListener");
  const listenerBody = BG_SRC.slice(listenerStart, listenerStart + 600);
  assert(
    /tap-keepalive/.test(listenerBody),
    "onAlarm listener body must dispatch on the 'tap-keepalive' alarm name",
  );
});

test("keepalive period is < 0.5 minutes (< 30s, MV3 idle window)", () => {
  // Default MV3 SW idle is 30s; keepalive must fire faster. Accept any
  // periodInMinutes literal < 0.5 (i.e. <= 0.4 typical, or 0.49).
  const m = BG_SRC.match(
    /chrome\.alarms\.create\s*\(\s*["']tap-keepalive["']\s*,\s*\{[^}]*periodInMinutes:\s*([\d.]+)/,
  );
  assert(m, "chrome.alarms.create must specify periodInMinutes");
  const period = parseFloat(m[1]);
  assert(
    period < 0.5,
    `periodInMinutes ${period} >= 0.5 — SW would idle-die between alarms (MV3 idle ~30s = 0.5min)`,
  );
});

// ═══════════════════════════════════════════════════════════
// Rule (ii): chrome:// guard does NOT exempt fromDaemon
// Why: dogfood 2026-05-08 — when active tab was chrome://extensions
// (during reload), daemon-driven navs got `tab_closed: Cannot access
// a chrome:// URL`. The exemption was a UX-preserving heuristic for
// popup path that wrongly applied to daemon path.
// ═══════════════════════════════════════════════════════════

console.log("\n  -- Rule (ii): chrome:// guard always open background tab --\n");

test("no `&& !fromDaemon` exemption in isInternal nav guard", () => {
  // Strict text check: the exact stale pattern must be absent.
  assert(
    !/if\s*\(\s*isInternal\s*&&\s*!fromDaemon\s*\)/.test(BG_SRC),
    "Stale exemption `if (isInternal && !fromDaemon)` must be deleted; " +
      "daemon-driven navs always open managed background tab.",
  );
});

test("isInternal guard exists and opens new tab", () => {
  // Positive form: must be the strict `if (isInternal) { ... chrome.tabs.create ... }` shape.
  // Search for `if (isInternal)` followed by chrome.tabs.create within ~300 chars.
  const idx = BG_SRC.search(/if\s*\(\s*isInternal\s*\)/);
  assert(
    idx !== -1,
    "Must contain `if (isInternal)` guard (without && !fromDaemon)",
  );
  const block = BG_SRC.slice(idx, idx + 400);
  assert(
    /chrome\.tabs\.create/.test(block),
    "isInternal branch must call chrome.tabs.create to open a new tab",
  );
});

// ═══════════════════════════════════════════════════════════

console.log(`\n  ${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
