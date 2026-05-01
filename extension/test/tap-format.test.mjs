/**
 * Constraint: .tap.js format contract
 * Classification: safety / what — invalid format = runtime crash
 *
 * Four formats:
 *   tap-format (v0.9+): { site, name, description, tap(handle, args) }
 *     - Unified single entry point. Full tap.* API on handle.
 *
 *   extract-format: { site, name, description, url, extract() }
 *     - Runtime handles nav, wait, limit, columns inference, health defaults
 *
 *   run-format: { site, name, description, columns, run(tap, args) }
 *     - Tap controls everything (interactive / composition taps)
 *
 *   transform-format: { site, name, description, transform(rows, args) }
 *     - Data pipeline: receives rows, returns transformed rows
 *
 * Run: node extension/test/tap-format.test.mjs
 */

import { strict as assert } from 'node:assert'
import { readdir } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { join, basename } from 'node:path'
import { pathToFileURL } from 'node:url'

// Accept dir from CLI arg, or fall back to ~/.tap/skills/
const TAPS_DIR = process.argv[2] || join(process.env.HOME, '.tap', 'skills')
const VALID_ARG_TYPES = ['string', 'int', 'float', 'number', 'boolean']

let passed = 0
let failed = 0

function test(name, fn) {
  try {
    fn()
    passed++
    console.log(`  \x1b[32m✓\x1b[0m ${name}`)
  } catch (e) {
    failed++
    console.log(`  \x1b[31m✗\x1b[0m ${name}`)
    console.log(`    ${e.message}`)
  }
}

async function testAsync(name, fn) {
  try {
    await fn()
    passed++
    console.log(`  \x1b[32m✓\x1b[0m ${name}`)
  } catch (e) {
    failed++
    console.log(`  \x1b[31m✗\x1b[0m ${name}`)
    console.log(`    ${e.message}`)
  }
}

async function findTapFiles(dir) {
  // Walks the tree and treats every .tap.js file's parent directory as its site.
  // Works for both flat layouts (~/.tap/skills/site/name.tap.js) and tap-skills
  // repo's nested layout (showcase/site/name.tap.js · community/site/name.tap.js).
  const files = []
  const stack = [dir]
  while (stack.length) {
    const cur = stack.pop()
    let entries
    try { entries = await readdir(cur, { withFileTypes: true }) } catch { continue }
    for (const e of entries) {
      if (e.name.startsWith('.')) continue
      const full = join(cur, e.name)
      if (e.isDirectory()) stack.push(full)
      else if (e.name.endsWith('.tap.js')) {
        files.push({ site: basename(cur), name: basename(e.name, '.tap.js'), path: full })
      }
    }
  }
  return files
}

// --- Constraints ---

console.log('\n.tap.js format constraints\n')

const tapFiles = await findTapFiles(TAPS_DIR)

// The corpus migrated from .tap.js → .tap.json (plan-only runtime, Phase 2,
// 2026-04). Once tap-skills finishes the migration the count drops to zero;
// this test still has value for any remaining .tap.js but doesn't force-fail
// on an empty .tap.js corpus. The .tap.json format has its own conformance
// gate at @taprun/spec/conformance.
if (tapFiles.length === 0) {
  console.log(`\n  (no .tap.js files in ${TAPS_DIR} — corpus migrated to .tap.json; nothing to validate)`)
  console.log(`\n0 constraints, 0 passed, 0 failed\n`)
  process.exit(0)
}

for (const { site, name, path } of tapFiles) {
  console.log(`\n  ${site}/${name}.tap.js`)

  let mod
  await testAsync(`  loads as ES module`, async () => {
    mod = await import(pathToFileURL(path))
    assert(mod.default, 'must have default export')
  })

  if (!mod?.default) continue
  const tap = mod.default
  const hasRun = typeof tap.run === 'function'
  const hasExtract = typeof tap.extract === 'function'
  const hasTransform = typeof tap.transform === 'function'
  const hasTap = typeof tap.tap === 'function'
  const format = hasTap ? 'tap' : hasTransform ? 'transform' : hasExtract ? 'extract' : 'run'

  // ===== COMMON CONSTRAINTS (both formats) =====

  test(`  [common] has site`, () => {
    assert.equal(typeof tap.site, 'string', 'site must be string')
  })

  test(`  [common] has name`, () => {
    assert.equal(typeof tap.name, 'string', 'name must be string')
  })

  test(`  [common] has description`, () => {
    assert.equal(typeof tap.description, 'string', 'description is required')
  })

  test(`  [common] site matches directory (${tap.site} === ${site})`, () => {
    assert.equal(tap.site, site)
  })

  test(`  [common] name matches filename (${tap.name} === ${name})`, () => {
    assert.equal(tap.name, name)
  })

  test(`  [common] has exactly one entry point (tap(), run(), extract(), or transform())`, () => {
    const legacyCount = [hasRun, hasExtract, hasTransform].filter(Boolean).length
    if (hasTap) {
      assert(legacyCount === 0, `tap-format must not have run()/extract()/transform() alongside tap()`)
    } else {
      assert(legacyCount === 1, `must have exactly one of tap()/run()/extract()/transform(), found ${legacyCount}`)
    }
  })

  // args validation (both formats)
  if (tap.args) {
    test(`  [common] args have valid types`, () => {
      for (const [key, spec] of Object.entries(tap.args)) {
        assert(spec.type, `arg '${key}' missing type`)
        assert(VALID_ARG_TYPES.includes(spec.type), `arg '${key}' has invalid type '${spec.type}'`)
      }
    })
  }

  // health validation (both formats)
  if (tap.health) {
    test(`  [common] health contract is valid`, () => {
      if (tap.health.min_rows !== undefined) {
        assert.equal(typeof tap.health.min_rows, 'number')
        assert(tap.health.min_rows > 0, 'min_rows must be > 0')
      }
      if (tap.health.non_empty !== undefined) {
        assert(Array.isArray(tap.health.non_empty))
        // Cross-check against columns if columns are declared
        if (tap.columns) {
          for (const field of tap.health.non_empty) {
            assert(tap.columns.includes(field), `health.non_empty field '${field}' not in columns`)
          }
        }
      }
    })
  }

  // requires validation (optional — declares protocol version dependency)
  if (tap.requires) {
    test(`  [common] requires is valid semver range`, () => {
      // Why: taps declare minimum protocol version for runtime compatibility negotiation
      assert.equal(typeof tap.requires, 'string', 'requires must be a semver string (e.g. ">=1.0.0")')
      assert(/^[><=^~]*\d+\.\d+\.\d+/.test(tap.requires), `requires "${tap.requires}" must be semver range`)
    })
  }

  // Safety: taps must only use the tap handle, not escape the sandbox
  const checkFn = tap.tap || tap.run || tap.extract || tap.transform
  const fnSrc = checkFn.toString()

  test(`  [safety] ${format}() must not reference chrome.* directly`, () => {
    assert(!fnSrc.includes('chrome.tabs'), 'must not reference chrome.tabs — use tap API')
    assert(!fnSrc.includes('chrome.scripting'), 'must not reference chrome.scripting — use tap API')
    assert(!fnSrc.includes('chrome.debugger'), 'must not reference chrome.debugger — use tap API')
  })

  test(`  [safety] ${format}() must not access Deno APIs directly`, () => {
    // Why: taps interact through the tap handle only. Deno.* is sandbox escape.
    assert(!fnSrc.includes('Deno.read'), 'must not access filesystem')
    assert(!fnSrc.includes('Deno.write'), 'must not write files')
    assert(!fnSrc.includes('Deno.run'), 'must not spawn processes')
    assert(!fnSrc.includes('Deno.Command'), 'must not spawn processes')
    assert(!fnSrc.includes('Deno.env'), 'must not read environment variables')
  })

  test(`  [safety] ${format}() must not use dynamic import`, () => {
    // Why: dynamic import can load arbitrary code, bypassing static analysis
    // Exclude: ObjC.import (JXA API inside eval strings) and string literals
    const stripped = fnSrc.replace(/ObjC\.import\s*\(/g, '').replace(/(["'`])[\s\S]*?\1/g, '')
    assert(!stripped.match(/\bimport\s*\(/), 'must not use dynamic import()')
  })

  // ===== EXTRACT-FORMAT CONSTRAINTS =====

  if (hasExtract) {
    test(`  [extract] has url (string or function)`, () => {
      const valid = (typeof tap.url === 'string' && tap.url.length > 0) || typeof tap.url === 'function'
      assert(valid, 'extract-format requires url (string or function)')
    })

    test(`  [extract] must not have columns (runtime infers)`, () => {
      assert(tap.columns === undefined, 'extract-format must not declare columns — runtime infers from extract() return')
    })

    test(`  [extract] must not have args.limit (runtime provides)`, () => {
      assert(!tap.args?.limit, 'extract-format must not declare args.limit — runtime provides default limit=20')
    })

    test(`  [extract] must not have wait (runtime adaptive)`, () => {
      assert(tap.wait === undefined, 'extract-format must not declare wait — runtime uses adaptive retry')
    })

    // waitFor must be a string if present
    if (tap.waitFor !== undefined) {
      test(`  [extract] waitFor is a string (CSS selector)`, () => {
        assert.equal(typeof tap.waitFor, 'string', 'waitFor must be a CSS selector string')
      })
    }

    // timeout must be a number if present
    if (tap.timeout !== undefined) {
      test(`  [extract] timeout is a number`, () => {
        assert.equal(typeof tap.timeout, 'number', 'timeout must be a number (milliseconds)')
      })
    }
  }

  // ===== RUN-FORMAT CONSTRAINTS =====

  if (hasRun) {
    test(`  [run] has columns (non-empty string array)`, () => {
      assert(Array.isArray(tap.columns), 'run-format requires columns array')
      assert(tap.columns.length > 0, 'columns must not be empty')
      for (const col of tap.columns) {
        assert.equal(typeof col, 'string', `column must be string, got ${typeof col}`)
      }
    })

    // Composition constraint: tap.run() references must resolve to existing taps
    const body = tap.run.toString()
    const tapCalls = [...body.matchAll(/tap\.run\(\s*["']([^"']+)["']\s*,\s*["']([^"']+)["']/g)]
    for (const [, refSite, refName] of tapCalls) {
      test(`  [composition] tap.run("${refSite}", "${refName}") references existing tap`, () => {
        const refPath = join(TAPS_DIR, refSite, `${refName}.tap.js`)
        const exists = existsSync(refPath)
        assert(exists,
          `tap.run("${refSite}", "${refName}") references non-existent tap at ${refPath} — composition requires all sub-taps to exist on disk`)
      })
    }
  }

  // Composition constraint for tap-format: handle.run() references must resolve to existing taps
  if (hasTap) {
    const body = tap.tap.toString()
    const handleCalls = [...body.matchAll(/handle\.run\(\s*["']([^"']+)["']\s*,\s*["']([^"']+)["']/g)]
    for (const [, refSite, refName] of handleCalls) {
      test(`  [composition] handle.run("${refSite}", "${refName}") references existing tap`, () => {
        const refPath = join(TAPS_DIR, refSite, `${refName}.tap.js`)
        const exists = existsSync(refPath)
        assert(exists,
          `handle.run("${refSite}", "${refName}") references non-existent tap at ${refPath} — composition requires all sub-taps to exist on disk`)
      })
    }
  }
}

// --- Summary ---
console.log(`\n${passed + failed} constraints, ${passed} passed, ${failed} failed\n`)
process.exit(failed > 0 ? 1 : 0)
