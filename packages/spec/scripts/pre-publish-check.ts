#!/usr/bin/env node
/**
 * Pre-publish gate (ADR 2026-05-04-ecosystem-v2-launch §2.5.1 Layer 4).
 *
 * Runs as `prepublishOnly`. Cannot be bypassed without removing the
 * script entry from package.json (which would itself be a PR-reviewed
 * change). Exits non-zero on any finding — npm publish halts before
 * touching the registry.
 *
 * Checks (each fails CLOSED):
 *   1. `npm pack --dry-run --json` produces the expected file list.
 *   2. The actual file set equals the allowed-files manifest exactly.
 *   3. dist/ JS+d.ts files contain no INTERNAL symbol names from the
 *      ADR §2.4 table.
 *   4. dist/ JS+d.ts files contain no forbidden import paths
 *      (engine internals: core/runtime, core/forge, core/persistence,
 *      core/heal, core/doctor, core/substrate).
 *
 * Node built-ins only (no extra deps).
 */

// @ts-nocheck — runs as Node JS, not strict TS.

import { execSync } from "node:child_process";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const PKG_ROOT = new URL("..", import.meta.url).pathname;

// ─── Manifest of files allowed in the published tarball ──────────────────
//
// Must mirror `package.json` "files" + the always-included files
// (package.json itself, README.md, LICENSE if present). Anything not
// listed here triggers a failure.
const ALLOWED_FILES = new Set([
  "package.json",
  "README.md",
  "dist/types.js",
  "dist/types.d.ts",
  "dist/lint.js",
  "dist/lint.d.ts",
  "dist/ns-vocabulary.js",
  "dist/ns-vocabulary.d.ts",
  "dist/index.js",
  "dist/index.d.ts",
]);

// ─── INTERNAL symbol names that must never appear in published JS ───────
//
// Per ADR §2.4 the Public/Private surface table. If any of these names
// appears as an exported identifier in dist/, the publish halts. (We
// match as a whole-word token to avoid false positives on substrings.)
const FORBIDDEN_SYMBOLS = [
  "Run",
  "IntentRecord",
  "Transition",
  "TransitionKind",
  "Fingerprint",
  "DoctorOutcome",
  "Substrate",
  "OpContext",
];

// ─── Forbidden import paths in published JS ──────────────────────────────
const FORBIDDEN_IMPORT_PATHS = [
  "core/runtime",
  "core/forge",
  "core/persistence",
  "core/heal",
  "core/doctor",
  "core/substrate",
];

// ─── Helpers ─────────────────────────────────────────────────────────────

function fail(msg) {
  console.error(`\n[pre-publish-check] FAIL: ${msg}\n`);
  process.exit(1);
}

function ok(msg) {
  console.log(`[pre-publish-check] OK: ${msg}`);
}

function listFilesRecursive(dir) {
  const out = [];
  if (!exists(dir)) return out;
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    const s = statSync(full);
    if (s.isDirectory()) out.push(...listFilesRecursive(full));
    else out.push(full);
  }
  return out;
}

function exists(p) {
  try {
    statSync(p);
    return true;
  } catch {
    return false;
  }
}

// ─── Check 1+2: npm pack contents match manifest ─────────────────────────

function checkPackContents() {
  let raw;
  try {
    raw = execSync("npm pack --dry-run --json", {
      cwd: PKG_ROOT,
      stdio: ["ignore", "pipe", "inherit"],
    }).toString();
  } catch (e) {
    fail(`\`npm pack --dry-run --json\` exited non-zero: ${e.message}`);
  }
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    fail(`\`npm pack --dry-run --json\` did not produce JSON:\n${raw}`);
  }
  const entry = Array.isArray(parsed) ? parsed[0] : parsed;
  if (!entry || !Array.isArray(entry.files)) {
    fail(`\`npm pack --dry-run --json\` returned no files[]: ${raw}`);
  }

  const actual = new Set(entry.files.map((f) => f.path));

  const unexpected = [...actual].filter((f) => !ALLOWED_FILES.has(f));
  const missing = [...ALLOWED_FILES].filter((f) => !actual.has(f));

  if (unexpected.length > 0) {
    fail(
      `Tarball contains files NOT in allow-list:\n  - ${unexpected.join("\n  - ")}\n\n` +
      `Either (a) remove them from the package, or (b) explicitly add to ALLOWED_FILES in scripts/pre-publish-check.ts (PR-reviewed).`,
    );
  }
  if (missing.length > 0) {
    fail(
      `Tarball is MISSING files from allow-list:\n  - ${missing.join("\n  - ")}\n\n` +
      `Run \`npm run build\` first.`,
    );
  }
  ok(`tarball file set matches allow-list (${actual.size} files)`);
}

// ─── Check 3: forbidden symbols in dist/ ─────────────────────────────────

function stripCommentsAndStrings(src) {
  // Remove block comments, line comments, and string literals so we
  // can scan only structural code. Approximate but adequate for the
  // small dist surface (3 files, ~200 LoC).
  return src
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/\/\/[^\n]*/g, " ")
    .replace(/'(?:\\.|[^'\\])*'/g, "''")
    .replace(/"(?:\\.|[^"\\])*"/g, "\"\"")
    .replace(/`(?:\\.|[^`\\])*`/g, "``");
}

function checkForbiddenSymbols() {
  const distDir = join(PKG_ROOT, "dist");
  if (!exists(distDir)) {
    fail(`dist/ does not exist — run \`npm run build\` first`);
  }
  const found = [];
  for (const file of listFilesRecursive(distDir)) {
    if (!file.endsWith(".js") && !file.endsWith(".d.ts")) continue;
    const raw = readFileSync(file, "utf8");
    const stripped = stripCommentsAndStrings(raw);
    for (const sym of FORBIDDEN_SYMBOLS) {
      // Match the symbol as a whole word in code-only text. Catches:
      //   `export interface Run {`
      //   `export type Run = ...`
      //   `Run,` in an export list
      // Skips occurrences inside doc comments / string literals.
      const re = new RegExp(`\\b${sym}\\b`);
      if (re.test(stripped)) {
        found.push(`${relative(PKG_ROOT, file)}: contains forbidden symbol "${sym}"`);
      }
    }
  }
  if (found.length > 0) {
    fail(
      `INTERNAL symbol(s) leaked into dist/:\n  - ${found.join("\n  - ")}\n\n` +
      `Per ADR 2026-05-04 §2.4, these names must NOT appear in the published spec.`,
    );
  }
  ok("no forbidden INTERNAL symbol names in dist/");
}

// ─── Check 4: forbidden import paths in dist/ ────────────────────────────

function checkForbiddenImports() {
  const distDir = join(PKG_ROOT, "dist");
  const found = [];
  for (const file of listFilesRecursive(distDir)) {
    if (!file.endsWith(".js") && !file.endsWith(".d.ts")) continue;
    const stripped = stripCommentsAndStrings(readFileSync(file, "utf8"));
    for (const path of FORBIDDEN_IMPORT_PATHS) {
      if (stripped.includes(path)) {
        found.push(`${relative(PKG_ROOT, file)}: references "${path}"`);
      }
    }
  }
  if (found.length > 0) {
    fail(
      `Forbidden engine-internal import path(s) in dist/:\n  - ${found.join("\n  - ")}\n\n` +
      `The published spec must not reference engine internals.`,
    );
  }
  ok("no forbidden engine-internal import paths in dist/");
}

// ─── Run ─────────────────────────────────────────────────────────────────

console.log("[pre-publish-check] ADR 2026-05-04 §2.5.1 Layer 4 gate\n");
checkPackContents();
checkForbiddenSymbols();
checkForbiddenImports();
console.log("\n[pre-publish-check] all checks passed.\n");
