/**
 * Constraint: nav-attach multi-match resolution scores by LONGEST COMMON
 * URL PREFIX with the nav target before active/recency tiebreaks.
 * Classification: correctness / what — attach binds the tab the plan means.
 *
 * Why (2026-07-23 wxamp dogfood): under match:origin, one origin can host
 * wholly unrelated surfaces — mp.weixin.qq.com serves BOTH the wxamp admin
 * console and public articles. active/recency-first bound a public ARTICLE
 * tab to an admin-console read plan mid-flow. The tab sharing the deepest
 * URL path with where the plan is going is the tab it means.
 *
 * Run: node extension/test/attach-prefix-scoring.test.mjs
 */

import { strict as assert } from 'node:assert'
import { readFileSync } from 'node:fs'

const BG_SRC = readFileSync(new URL('../background.js', import.meta.url), 'utf-8')

let passed = 0, failed = 0
function test(name, fn) {
  try { fn(); passed++; console.log(`  \x1b[32m✓\x1b[0m ${name}`) }
  catch (e) { failed++; console.log(`  \x1b[31m✗\x1b[0m ${name}`); console.log(`    ${e.message}`) }
}
async function testAsync(name, fn) {
  try { await fn(); passed++; console.log(`  \x1b[32m✓\x1b[0m ${name}`) }
  catch (e) { failed++; console.log(`  \x1b[31m✗\x1b[0m ${name}`); console.log(`    ${e.message}`) }
}

const fnSrc = BG_SRC.slice(
  BG_SRC.indexOf('async function queryAttachCandidate(url, mode) {'),
  BG_SRC.indexOf('async function waitForTabLoad'),
)
assert(fnSrc.length > 100, 'queryAttachCandidate must exist')

test('sort key order: prefix length → active → recency', () => {
  const sortIdx = fnSrc.indexOf('candidates.sort')
  assert(sortIdx > -1)
  const sortSrc = fnSrc.slice(sortIdx)
  const prefixIdx = sortSrc.indexOf('commonPrefixLen')
  const activeIdx = sortSrc.indexOf('b.active')
  const recencyIdx = sortSrc.indexOf('lastAccessed')
  assert(prefixIdx > -1 && activeIdx > -1 && recencyIdx > -1, 'all three keys must appear')
  assert(prefixIdx < activeIdx && activeIdx < recencyIdx,
    'prefix score must dominate; active and recency are tiebreaks only')
})

function extractFn() {
  return new Function('chrome', `${fnSrc}; return queryAttachCandidate`)
}

const tabs = (list) => ({ tabs: { query: async () => list } })

await testAsync('origin mode: deepest-prefix tab beats the ACTIVE unrelated-surface tab', async () => {
  const target = 'https://mp.weixin.qq.com/wxamp/wacodepage/getcodepage?token=1&lang=zh_CN'
  const article = { id: 1, url: 'https://mp.weixin.qq.com/s/abcdef', active: true, lastAccessed: 2000 }
  const console_ = { id: 2, url: 'https://mp.weixin.qq.com/wxamp/wacodepage/getcodepage?token=1&lang=zh_CN', active: false, lastAccessed: 1000 }
  const q = extractFn()(tabs([article, console_]))
  const hit = await q(target, 'origin')
  assert.equal(hit.id, 2, 'the admin-console tab (full-prefix match) must win over the active article tab')
})

await testAsync('equal prefixes fall back to active, then recency (2026-07-03 contract preserved)', async () => {
  const target = 'https://x.test/app'
  const a = { id: 1, url: 'https://x.test/app/page', active: false, lastAccessed: 3000 }
  const b = { id: 2, url: 'https://x.test/app/page', active: true, lastAccessed: 1000 }
  const c = { id: 3, url: 'https://x.test/app/page', active: false, lastAccessed: 2000 }
  const q = extractFn()(tabs([a, b, c]))
  const hit = await q(target, 'url-prefix')
  assert.equal(hit.id, 2, 'active must win among equal prefixes')
  const q2 = extractFn()(tabs([a, c]))
  const hit2 = await q2(target, 'url-prefix')
  assert.equal(hit2.id, 1, 'recency breaks the remaining tie')
})

await testAsync('no match still returns null; exact mode unchanged', async () => {
  const q = extractFn()(tabs([{ id: 9, url: 'https://other.test/', active: true }]))
  assert.equal(await q('https://x.test/a', 'url-prefix'), null)
  const exact = extractFn()(tabs([
    { id: 5, url: 'https://x.test/a', active: false, lastAccessed: 1 },
    { id: 6, url: 'https://x.test/a?b', active: true, lastAccessed: 2 },
  ]))
  const hit = await exact('https://x.test/a', 'exact')
  assert.equal(hit.id, 5, 'exact mode must stay byte-equal')
})

console.log(`\n${passed} passed, ${failed} failed`)
if (failed > 0) process.exit(1)
