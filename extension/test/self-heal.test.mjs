/**
 * Constraint: extension self-heals MV3 SW idle die + always uses
 * managed background tabs for daemon-driven navs.
 *
 * Classification: safety / what — violations cause silent peer_unreachable
 * spurious failures and active-tab clobbering during daemon ops.
 *
 * Rule (i): SW keepalive — POST-2026-05-13 (native messaging migration):
 *   The chrome.runtime.connectNative port is held by the SW; per PoC T1
 *   the port itself keeps the SW alive past Chrome's 30s idle threshold
 *   AND past the 5-minute hard-kill (validated 19m30s zero-traffic
 *   persistence). Previously: chrome.alarms 25s keepalive (deleted per
 *   ADR 2026-05-13-daemon-extension-via-native-messaging.md §3 N1).
 *
 * Rule (ii): chrome:// guard — daemon-driven navs always use managed
 * background tab (no !fromDaemon exemption).
 *
 * Rule (iii): origin-mismatch nav → new background tab.
 * Rule (iv): cross-origin new tab binds via SAA self-heal (sessions.set).
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
// Rule (i): SW keepalive via Native Messaging port (post-2026-05-13)
// Why: chrome.runtime.connectNative port persistence replaces the prior
// chrome.alarms 25s ping. PoC validated 19m30s zero-traffic SW alive
// while port is open — far past MV3's 30s idle and 5-min hard-kill.
//
// The OLD rule asserted chrome.alarms.create('tap-keepalive') existed;
// per N1 architecture invariant that string MUST be gone post-migration.
// These tests enforce both directions:
//   - presence: connectNative call wired
//   - absence: no chrome.alarms.create / no tap-keepalive name
// ═══════════════════════════════════════════════════════════

console.log("\n  -- Rule (i): SW keepalive via native messaging port --\n");

test("chrome.runtime.connectNative is wired (sole keepalive mechanism)", () => {
  assert(
    /chrome\.runtime\.connectNative\s*\(/.test(BG_SRC),
    "background.js must call chrome.runtime.connectNative to establish the port that keeps SW alive",
  );
});

test("connectNative targets the canonical host name 'dev.taprun.daemon'", () => {
  // The host name is part of the contract — the per-user manifest at
  // ~/Library/Application Support/Google/Chrome/NativeMessagingHosts/
  // dev.taprun.daemon.json identifies the host by this exact name.
  assert(
    /chrome\.runtime\.connectNative\s*\(\s*['"`]?(?:NATIVE_HOST_NAME|dev\.taprun\.daemon)['"`]?\s*\)/
      .test(BG_SRC) ||
    /['"`]dev\.taprun\.daemon['"`]/.test(BG_SRC),
    "background.js must reference 'dev.taprun.daemon' as the native messaging host name",
  );
});

test("port.onDisconnect listener captures lastError for popup CTA dispatch", () => {
  // The popup distinguishes failure modes by Chrome's lastError.message;
  // SW must capture that into a module-scope variable returned via the
  // tap-status response.
  assert(
    /port\.onDisconnect\.addListener/.test(BG_SRC),
    "background.js must register port.onDisconnect listener",
  );
  assert(
    /chrome\.runtime\.lastError/.test(BG_SRC),
    "port.onDisconnect handler must read chrome.runtime.lastError for failure-mode classification",
  );
});

test("no chrome.alarms.create call (keepalive deleted per N1 invariant)", () => {
  // Regression guard: the old alarm-based keepalive must stay deleted.
  // Native messaging port is the only keepalive mechanism — reintroducing
  // an alarm would be code rot.
  assert(
    !/chrome\.alarms\.create/.test(BG_SRC),
    "chrome.alarms.create must NOT appear — native messaging port is the sole keepalive (N1 invariant)",
  );
});

test("no 'tap-keepalive' alarm name (regression guard for the retired name)", () => {
  assert(
    !/tap-keepalive/.test(BG_SRC),
    "'tap-keepalive' alarm name must NOT appear — deleted post-2026-05-13",
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
  assert(
    !/if\s*\(\s*isInternal\s*&&\s*!fromDaemon\s*\)/.test(BG_SRC),
    "Stale exemption `if (isInternal && !fromDaemon)` must be deleted; " +
      "daemon-driven navs always open managed background tab.",
  );
});

test("isInternal guard exists and opens new tab", () => {
  const idx = BG_SRC.search(/if\s*\(\s*isInternal[\s|)]/);
  assert(
    idx !== -1,
    "Must contain `if (isInternal ...)` guard (with isInternal as first condition)",
  );
  const block = BG_SRC.slice(idx, idx + 600);
  assert(
    /chrome\.tabs\.create/.test(block),
    "isInternal-branch must call chrome.tabs.create to open a new tab",
  );
});

// ═══════════════════════════════════════════════════════════
// Rule (iii): origin-mismatch nav → new background tab
// ═══════════════════════════════════════════════════════════

console.log("\n  -- Rule (iii): origin-mismatch nav → new background tab --\n");

test("nav handler computes target origin", () => {
  assert(
    /new URL\(params\.url\)/.test(BG_SRC),
    "nav handler must construct URL(params.url) to extract target origin",
  );
});

test("nav handler compares target.origin vs current.origin", () => {
  const navStart = BG_SRC.indexOf("case 'nav': {");
  assert(navStart !== -1, "nav case handler must exist");
  // Slice through end of the nav case (next `case '...':`) so the window
  // size doesn't drift as the handler grows. Pre-2026-05-17 this was a
  // hardcoded 2000-char window that fell short once op-nav-attach landed
  // ~50 lines of attach-mode bookkeeping before the cross-origin check.
  const navEnd = BG_SRC.indexOf("case '", navStart + 10);
  const navBlock = BG_SRC.slice(navStart, navEnd > 0 ? navEnd : navStart + 6000);
  const originAccesses = navBlock.match(/\.origin\b/g) || [];
  assert(
    originAccesses.length >= 2,
    `nav handler must access .origin on both target and current to compare; ` +
      `found ${originAccesses.length} .origin access(es) in nav case block`,
  );
});

test("origin mismatch branch opens new tab via chrome.tabs.create", () => {
  const navStart = BG_SRC.indexOf("case 'nav': {");
  // 4000: the nav case legitimately grew (attach find-or-create + 
  // attach.reload bind-only + created-flag tab ownership, 2026-06-11);
  // the constraint is proximity of the origin-gate to tabs.create, not
  // a fixed handler size.
  const navBlock = BG_SRC.slice(navStart, navStart + 4000);
  assert(
    /\.origin\s*!==?\s*[a-zA-Z_$.]*\.origin/.test(navBlock),
    "nav handler must compare `.origin !== .origin` (cross-origin detection)",
  );
  assert(
    /chrome\.tabs\.create/.test(navBlock),
    "nav handler must call chrome.tabs.create somewhere",
  );
  const inlinePattern =
    /if\s*\([^)]*\.origin\s*!==?[^)]*\.origin[^)]*\)\s*\{[\s\S]{0,500}chrome\.tabs\.create/;
  const variablePattern =
    /(\w+)\s*=\s*[^;]*\.origin\s*!==?\s*[a-zA-Z_$.]*\.origin[\s\S]{0,500}if\s*\([^)]*\1[^)]*\)\s*\{[\s\S]{0,500}chrome\.tabs\.create/;
  assert(
    inlinePattern.test(navBlock) || variablePattern.test(navBlock),
    "nav handler must use the origin comparison (inline or via boolean " +
      "variable) to gate a chrome.tabs.create branch",
  );
});

// ═══════════════════════════════════════════════════════════
// Rule (iv): cross-origin new tab must bind to params._sessionId locally
// ═══════════════════════════════════════════════════════════

console.log("\n  -- Rule (iv): cross-origin new tab binds via SAA self-heal --\n");

test("nav handler contains SAA self-heal that binds new tabId to sessionId", () => {
  const navStart = BG_SRC.indexOf("case 'nav': {");
  const navEnd = BG_SRC.indexOf("case '", navStart + 10);
  const navBlock = BG_SRC.slice(
    navStart,
    navEnd > 0 ? navEnd : navStart + 6000,
  );
  const hasSidPickup = /params\._sessionId/.test(navBlock);
  const hasSessionsSet = /sessions\.set\s*\(\s*sid\s*,\s*\{\s*tabId/.test(
    navBlock,
  );
  assert(
    hasSidPickup && hasSessionsSet,
    "Nav handler must contain SAA self-heal: read `params._sessionId` and " +
      "`sessions.set(sid, { tabId, ... })` so the dispatch sessionId binds " +
      "to the (possibly newly-created) tabId. Without this, page-session " +
      "fetch in subsequent ops can't find the tab.",
  );
});

test("nav handler does NOT emit active_tab_changed (deleted per SAA cross-repo ADR)", () => {
  const navStart = BG_SRC.indexOf("case 'nav': {");
  const navEnd = BG_SRC.indexOf("case '", navStart + 10);
  const navBlock = BG_SRC.slice(
    navStart,
    navEnd > 0 ? navEnd : navStart + 6000,
  );
  // Old shape: ws.send({...active_tab_changed...}). New transport is
  // port.postMessage but the regression guard applies to either — the
  // notification should not be emitted at all.
  const wsPattern = /ws\.send\s*\([\s\S]{0,200}?active_tab_changed/;
  const portPattern = /port\.postMessage\s*\([\s\S]{0,200}?active_tab_changed/;
  assert(
    !wsPattern.test(navBlock) && !portPattern.test(navBlock),
    "Nav handler must not emit active_tab_changed via ws.send or port.postMessage — " +
      "the daemon-side lastActiveTab cache is gone (parent SAA ADR); the SAA " +
      "self-heal binds tabId locally via sessions.set instead.",
  );
});

// ═══════════════════════════════════════════════════════════

console.log(`\n  ${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
