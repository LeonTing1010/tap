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
  // The guard may be `if (isInternal)` or `if (isInternal || <other>)`.
  // What matters: isInternal participates in a guard whose body opens
  // a new background tab via chrome.tabs.create.
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
// Why: 2026-05-08 dogfood — Cloudflare nav redirected through CF
// auth chain, leaving tab on dash.cloudflare.com/two-factor. Next
// nav (juejin.cn/search) called `chrome.tabs.update(tabId, { url })`
// to navigate same tab, but the eval ran on cloudflare login page —
// silent data corruption. Same applies to parallel batch calls
// sharing a tab. Fix: when daemon-driven nav target origin differs
// from current tab origin, open a new background tab instead of
// clobbering. Same-origin navs continue to use tabs.update (cheap).
// ═══════════════════════════════════════════════════════════

console.log("\n  -- Rule (iii): origin-mismatch nav → new background tab --\n");

test("nav handler computes target origin", () => {
  // Source-text proxy: must call new URL(...) on params.url to extract origin.
  // Pattern: `new URL(params.url)` followed by `.origin` access OR variable
  // assignment that's later compared to current origin.
  assert(
    /new URL\(params\.url\)/.test(BG_SRC),
    "nav handler must construct URL(params.url) to extract target origin",
  );
});

test("nav handler compares target.origin vs current.origin", () => {
  // Must read .origin from both target and current to compare.
  // Looser pattern: at least 2 occurrences of `.origin` near nav case
  // (one for target, one for current).
  const navStart = BG_SRC.indexOf("case 'nav':");
  assert(navStart !== -1, "nav case handler must exist");
  // Search a 2000-char window starting from `case 'nav':`.
  const navBlock = BG_SRC.slice(navStart, navStart + 2000);
  const originAccesses = navBlock.match(/\.origin\b/g) || [];
  assert(
    originAccesses.length >= 2,
    `nav handler must access .origin on both target and current to compare; ` +
      `found ${originAccesses.length} .origin access(es) in 2000-char window`,
  );
});

test("origin mismatch branch opens new tab via chrome.tabs.create", () => {
  // Two acceptable idioms:
  //   (a) inline:   if (target.origin !== current.origin) { chrome.tabs.create(...) }
  //   (b) variable: const cross = a.origin !== b.origin; if (... || cross) { chrome.tabs.create(...) }
  // What matters: somewhere in the nav handler there's an `.origin !==
  // .origin` comparison whose result drives a chrome.tabs.create branch.
  const navStart = BG_SRC.indexOf("case 'nav':");
  const navBlock = BG_SRC.slice(navStart, navStart + 3000);
  // Step 1: confirm origin-vs-origin comparison appears.
  assert(
    /\.origin\s*!==?\s*[a-zA-Z_$.]*\.origin/.test(navBlock),
    "nav handler must compare `.origin !== .origin` (cross-origin detection)",
  );
  // Step 2: confirm chrome.tabs.create appears within the same nav block.
  assert(
    /chrome\.tabs\.create/.test(navBlock),
    "nav handler must call chrome.tabs.create somewhere",
  );
  // Step 3: confirm the result of the origin comparison influences a
  // boolean used in the if-guard. Look for either:
  //   - inline:    if (...origin !==...origin...) { ... chrome.tabs.create
  //   - variable:  crossOrigin (or similar) referenced in if + assigned from origin compare
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
// Why: 2026-05-08 dogfood post-merge — after §2C(iii) opens a new bg tab
// for cross-origin nav, subsequent ops in the same plan must route to
// the new tab. Pre-2026-05-10: this was solved by manually emitting
// active_tab_changed so daemon's lastActiveTab cache updates. Post-2026-
// 05-10 (parent SAA ADR + this ADR): daemon's lastActiveTab cache is
// deleted; the new mechanism is the SAA self-heal at the end of the nav
// handler — `if (!sessionUpdated && fromDaemon && sid && !sessions.has(sid))
// { sessions.set(sid, {tabId, ...}) }` — binds the new tabId to the
// dispatch sessionId locally without any daemon round-trip.
//
// Per ADR 2026-05-10-saa-page-session-fetch-cross-repo. The corresponding
// active_tab_changed emissions in nav / ws.onopen / chrome.tabs.onActivated
// are deleted (regression-guarded by SAA1 in the core repo).
// ═══════════════════════════════════════════════════════════

console.log("\n  -- Rule (iv): cross-origin new tab binds via SAA self-heal --\n");

test("nav handler contains SAA self-heal that binds new tabId to sessionId", () => {
  // Structural property: somewhere in the nav handler, after tabId is
  // (re)assigned, there must be a self-heal block that pulls
  // `params._sessionId` and calls `sessions.set(sid, {tabId, ...})`.
  // This is what replaces the old daemon-side lastActiveTab cache.
  const navStart = BG_SRC.indexOf("case 'nav':");
  const navEnd = BG_SRC.indexOf("case '", navStart + 10);
  const navBlock = BG_SRC.slice(
    navStart,
    navEnd > 0 ? navEnd : navStart + 6000,
  );
  // Look for: params._sessionId assignment + sessions.set(<sid>, {tabId})
  // within the nav handler.
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
  // Regression guard. The pre-2026-05-10 nav handler had a manual
  // active_tab_changed emission for daemon's lastActiveTab cache. Both
  // the daemon's cache AND the emission are deleted. SAA1 in core/
  // bans `lastActiveTab` symbol use; this is the cross-repo counterpart
  // for the wire-side notification.
  const navStart = BG_SRC.indexOf("case 'nav':");
  const navEnd = BG_SRC.indexOf("case '", navStart + 10);
  const navBlock = BG_SRC.slice(
    navStart,
    navEnd > 0 ? navEnd : navStart + 6000,
  );
  // The string may appear in a comment referencing the ADR; only
  // reject ws.send / JSON.stringify shapes that actually emit.
  const re = /ws\.send\s*\([\s\S]{0,200}?active_tab_changed/;
  assert(
    !re.test(navBlock),
    "Nav handler must not call ws.send({...active_tab_changed...}) — the " +
      "daemon-side lastActiveTab cache is gone (parent SAA ADR); the SAA " +
      "self-heal binds tabId locally via sessions.set instead.",
  );
});

// ═══════════════════════════════════════════════════════════

console.log(`\n  ${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
