/**
 * Constraint: every manifest permission is earned (safety / what)
 *
 * Why: a permission is not a capability list, it is a SENTENCE Chrome shows the
 * user at install time — and tap's whole pitch is trust ("local-first,
 * credentials never leave the machine"; the moat's second layer is operator
 * reputation). The install prompt is the product's first trust contact, so a
 * permission spends the most expensive currency tap has.
 *
 * On 2026-08-04 six permissions were added (downloads / history / sessions /
 * readingList / browsingData / contentSettings) to make a capability inventory
 * have no blank cells. Measured the same day: zero production flows used them,
 * `op:host` had never executed once in four months of ledger, and none of them
 * sits in the product's own scope — "the login/compliance last 20% APIs can't
 * reach". Reading browsing history is not something an API cannot reach; it is
 * something an API deliberately does not offer.
 *
 * ⭐ The asymmetry that settles it: CHROME GRANTS BY NAMESPACE, NOT BY METHOD.
 * Registering only `get` methods in the host-caps registry is self-restraint,
 * not a technical limit — the user's install prompt still describes everything
 * the namespace can do. So "we only registered the read methods" is an argument
 * the user cannot see and cannot verify. It protects tap from misusing itself;
 * it does not protect the user, and it does not buy back the sentence.
 *
 * ADVERSARIAL framing (Phase 1a):
 *   "If a half-impl passed: drop the six from the manifest but leave the
 *    host-caps namespaces (or the reverse), so the next `deno task test` looks
 *    clean while an op:host call fails at runtime with a permission error — or
 *    worse, silently works because the permission crept back. P2 catches the
 *    split by requiring the manifest to COVER every namespace the registry can
 *    target, in that direction: registry ⊆ manifest."
 *
 * Run: node --test extension/test/permission-budget.test.mjs
 */
import { test } from 'node:test'
import { strict as assert } from 'node:assert'
import { readFileSync } from 'node:fs'

const manifest = JSON.parse(
  readFileSync(new URL('../manifest.json', import.meta.url), 'utf-8'),
)

// Each entry states what it BUYS. A permission with no line here has no reason
// to exist; adding one turns this test red until its reason is written down.
const EARNED = {
  nativeMessaging: 'the native host — tap has no other channel to the engine',
  debugger: 'trusted input, the AX tree, printToPDF, network observation — this IS the last 20%',
  tabs: 'session binding, nav, the tab strip',
  tabGroups: 'op:tab group/ungroup',
  bookmarks: 'op:bookmark — browser UI a page script genuinely cannot reach (4 production flows)',
  scripting: 'op:eval / op:extract injection',
  cookies: 'op:cookies — logged-in state is the product; ⚠️ zero production flows in 4 months, review',
  storage: 'session persistence + side panel state',
  sidePanel: 'op:notify — the highest-usage capability in the corpus (29 production flows)',
}

test('every manifest permission is on the earned list', () => {
  const unearned = manifest.permissions.filter((p) => !(p in EARNED))
  assert.deepEqual(
    unearned,
    [],
    `unearned permission(s): ${unearned.join(', ')}. A permission is a sentence ` +
      `in the install prompt, not a row in a capability table. Write down what ` +
      `it buys — and whether that thing is inside "the last 20% APIs can't reach".`,
  )
})

test('every earned permission is actually requested (no dead entries here)', () => {
  const missing = Object.keys(EARNED).filter((p) => !manifest.permissions.includes(p))
  assert.deepEqual(missing, [], `listed as earned but not requested: ${missing.join(', ')}`)
})

test('activeTab stays out — <all_urls> already covers it', () => {
  // It was requested for years with zero call sites while host_permissions
  // granted a strict superset. A redundant permission still costs a sentence.
  assert.ok(
    !manifest.permissions.includes('activeTab'),
    'activeTab is redundant under <all_urls> and buys nothing',
  )
  assert.ok(
    manifest.host_permissions.includes('<all_urls>'),
    'the superset must actually be present for that argument to hold',
  )
})

test('P2 — the host-caps namespace allowlist is covered by granted permissions', () => {
  // Direction matters: registry ⊆ manifest. A namespace the registry can target
  // without a matching permission fails at runtime, not at build.
  const body = readFileSync(new URL('../background.js', import.meta.url), 'utf-8')
  const m = body.match(/const HOST_NS_OK = new Set\(\[([^\]]*)\]\)/)
  assert.ok(m, 'the defense-in-depth namespace allowlist must exist')
  const namespaces = [...m[1].matchAll(/'([^']+)'/g)].map((x) => x[1])
  // `windows` needs no permission (chrome.windows is available unconditionally).
  const needsPermission = namespaces.filter((n) => n !== 'windows')
  const ungranted = needsPermission.filter((n) => !manifest.permissions.includes(n))
  assert.deepEqual(
    ungranted,
    [],
    `host-caps may target ${ungranted.join(', ')} but the manifest does not grant it`,
  )
})
