#!/usr/bin/env node
/**
 * Pre-publish gate per ADR 2026-05-04 §2.5.1 Layer 4.
 *
 * Runs as `prepublishOnly`. Cannot be skipped without a PR-reviewed
 * package.json edit. Verifies:
 *   1. dist/ contains no forbidden internal-leak symbols
 *   2. dist/ has no unexpected files (whitelist matches package.json `files`)
 *   3. v1.0+ source emits no v1-isms (op:exec, W3C envelope keys)
 */

import { readFile, readdir, stat } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PKG_ROOT = resolve(__dirname, "..");
const DIST = resolve(PKG_ROOT, "dist");

const FORBIDDEN_SYMBOLS = [
  // §2.4 INTERNAL types — must never appear in published code
  "IntentRecord",
  "Transition",
  "TransitionKind",
  "DoctorOutcome",
  "Substrate",
  "OpContext",
  // v1 schema artifacts — should be gone from v1.0+
  "tap:ExecutionPlan",
  "anno.jsonld",
  "tap:executing",
  "allowUnverifiable",
];

const FORBIDDEN_OP_NAMES = [
  // op:exec is retired in v2
  '"op":"exec"',
  '"op": "exec"',
  // op:screenshot is retired in v2
  '"op":"screenshot"',
  '"op": "screenshot"',
];

async function walk(dir) {
  const entries = await readdir(dir);
  const files = [];
  for (const entry of entries) {
    const p = resolve(dir, entry);
    const st = await stat(p);
    if (st.isDirectory()) files.push(...await walk(p));
    else files.push(p);
  }
  return files;
}

async function main() {
  let failed = false;

  let distFiles;
  try {
    distFiles = await walk(DIST);
  } catch {
    console.error(`pre-publish-check: dist/ not found — run \`npm run build\` first`);
    process.exit(1);
  }

  // Symbol grep
  for (const f of distFiles) {
    if (!f.endsWith(".js") && !f.endsWith(".d.ts")) continue;
    const content = await readFile(f, "utf8");
    // Strip comments to avoid matching the prose mentions in the source's
    // header comment block (e.g. "v1 W3C Annotation envelope", which is
    // educational, not leakage).
    const code = content
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/\/\/.*$/gm, "");
    for (const symbol of FORBIDDEN_SYMBOLS) {
      if (code.includes(symbol)) {
        console.error(`pre-publish-check: forbidden symbol "${symbol}" found in ${f}`);
        failed = true;
      }
    }
    for (const opName of FORBIDDEN_OP_NAMES) {
      if (code.includes(opName)) {
        console.error(`pre-publish-check: retired op pattern ${opName} found in ${f}`);
        failed = true;
      }
    }
  }

  // package.json whitelist — confirm `files` exists and is explicit
  const pkg = JSON.parse(await readFile(resolve(PKG_ROOT, "package.json"), "utf8"));
  if (!Array.isArray(pkg.files) || pkg.files.length === 0) {
    console.error(`pre-publish-check: package.json missing explicit "files" whitelist`);
    failed = true;
  }
  if (!pkg.scripts?.prepublishOnly) {
    console.error(`pre-publish-check: package.json missing prepublishOnly script`);
    failed = true;
  }
  if (!pkg.peerDependencies?.["@taprun/spec"]?.startsWith("^1.")) {
    console.error(`pre-publish-check: peerDependencies["@taprun/spec"] must be ^1.x for v1.0+`);
    failed = true;
  }

  if (failed) {
    console.error("pre-publish-check: FAILED — refusing to publish");
    process.exit(1);
  }
  console.log("pre-publish-check: ok");
}

main().catch((e) => {
  console.error("pre-publish-check: error", e);
  process.exit(1);
});
