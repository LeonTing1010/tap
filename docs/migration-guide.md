---
title: "Migration guide — Tap v1 → v2"
description: "How to upgrade from the v1 W3C Annotation envelope to bare v2 Plans. One CLI verb, one schema change, one weekend of npm bumps."
permalink: /migration-guide/
layout: default
---

# Migration guide — v1 → v2

Tap v2 is a discontinuous schema break. The v1 W3C Annotation envelope is gone; the [`@taprun/spec`](https://www.npmjs.com/package/@taprun/spec) package ships v1.0 with a bare `Plan` type sourced from `core/types.ts`. This guide walks the four moving parts: your local taps, the npm packages you depend on, the doctor verdict you read in CI, and the runtime-shape change every consumer must absorb.

If you keep v0.x lockfiles pinned, nothing breaks today. If you upgrade, this is the path.

---

## TL;DR

```bash
# 1. See what migrates automatically
tap migrate scan

# 2. Apply
tap migrate migrate

# 3. Bump npm packages
npm install @taprun/spec@^1 @taprun/from-playwright@^1 @taprun/from-puppeteer@^1
```

The CLI prints a report of three buckets: **auto-migratable** (W3C envelope wrapping a body that already uses only v2 ops), **needs-rewrite** (uses deleted ops or fields), and **corrupt**. Auto-migratable plans land in `~/.tap/flows/<site>/<name>.flow.json`. Originals stay read-only in `~/.tap/taps/` for the deprecation window so nothing is lost.

> **Be realistic about coverage.** Most v0.x plans were compiled with a universal `op:exec` body (the v1 escape hatch). Auto-migration coverage on the legacy corpus is therefore close to 0% — not because the migration tool is incomplete but because v1 leaned heavily on free-form JS. Most upgrades land in the **needs-rewrite** bucket. The cheapest path for those is `tap capture <url> <site>/<name> --intent "..."` against the original target, not a hand port.

---

## What changed at the schema level

| Concept | v1 (deprecated) | v2 (current) |
|---|---|---|
| Envelope | W3C Annotation `{type:"Annotation", body:{type:"tap:ExecutionPlan", ...}}` | Bare `Plan` (no wrapper) |
| Op count | 24 ops including `op:exec`, `op:pipe`, `op:parseXML`, `op:screenshot`, `op:scroll` | **11 ops** — 7 substrate + 3 control flow + 1 typed-eval escape |
| Op:exec | Free-form Deno-host JS body | Replaced by `op:eval` (page-context) with required `returns` type, plus composition via `if`/`foreach`/`parallel` |
| Read/write split | `intent: "read" \| "write"` field | Discriminated union on the `Plan` type itself: read variant has no `act`/`key`; write variant requires both |
| Doctor verdict | 6 arms (`healthy` · `broken` · `stale` · `layer-mismatch` · `unreachable` · `unverified`) | **4 arms** — `equivalent` · `drifted` · `first_snapshot` · `unreachable` |
| Equivalence rule | Hard-coded structural diff in doctor | Per-tap CEL `snapshot_equivalent` predicate that you author |
| `legacy: true`, `allowUnverifiable` | Pre-drainage escape hatches | Deleted; v2 lint rejects on save |
| Heal classes | "3 token classes" (cache / minimal / rewrite) as separate codepaths | Same three paths, single escalation pipeline; reads as `cache` (0 tokens) → `minimal-patch` (~1.1K) → `full-rewrite` (~14K) |
| `generator` field | Required | Optional `compiled_by` metadata under [forge-ai-lifecycle](/adrs/) ADR |

The unifying move: every concept that used to be a string discriminator (`intent`, `legacy`, `allowUnverifiable`) became a TypeScript discriminated union. Invalid combinations are now unrepresentable.

The verb surface itself collapsed too: v1's `tap-v2 doctor` is now `tap verify`; `tap-v2 fix` and the AI-write heal pipeline merged into the `capture` re-call path (re-running `capture` against an existing site+name is the heal path); `tap-v2 mcp-tool` is gone — every saved plan auto-projects as the MCP tool `<site>.<name>`.

---

## The three CLI verbs you need

### `tap migrate scan`

Read-only inventory. Walks `~/.tap/taps/` and classifies each `.tap.json` into one of three buckets. No file is moved. Output is a printable report with the count per bucket.

```bash
tap migrate scan --root ~/.tap          # all sites
tap migrate scan --site github          # one site
```

### `tap migrate migrate`

Applies the conversion. For each auto-migratable plan: strips the W3C wrapper, drops the deleted top-level fields (`intent`, `legacy`, `allowUnverifiable`), synthesises `id: { site, name }` from the body, treats `ops` as `observe` for read taps, runs `lintPlan` on the result, and writes to `~/.tap/flows/<site>/<name>.flow.json` if lint passes. Originals stay untouched in `~/.tap/taps/` until you decide to delete them.

```bash
tap migrate migrate --dry-run           # preview
tap migrate migrate                     # apply
```

`--dry-run` performs the full conversion + lint in memory and prints the same summary you'd get from a live run, so you can read the report before any file lands.

Behaviour reference: the `tap migrate` CLI verb provided by the Tap binary. The migration adapter is part of the proprietary engine.

### `tap lint` (planned)

If you author plans by hand, lint is the static gate. It rejects deleted fields (`legacy: true` on save, `intent` discriminator, `allowUnverifiable`), enforces the 13-op closure, and verifies the read/write discriminated union is well-formed.

```bash
tap lint                                        # whole fleet
tap lint github/trending                        # one tap
```

---

## Plans that don't auto-migrate

A plan needs hand-rewriting if its body contains:

- An `op:exec` step (Deno-host arbitrary JS) — replace with composition over `if` / `foreach` / `parallel` plus a typed `op:eval` for the value-only escape, or model the side-effect as a sequence of `op:input` + `op:wait` steps.
- An `op:pipe` step — pipes were a v1-only template macro. Inline the underlying ops or re-forge from a fresh source.
- An `op:parseXML` / `op:screenshot` / `op:scroll` step — parseXML is now `op:fetch` + CEL extraction; screenshot is removed from the closure (use the chrome runtime directly if needed); scroll merges into `op:input` with `kind: "scroll"`.
- A field set to `legacy: true` or `allowUnverifiable: true`.

For these, the cheapest path is: `tap capture <url> <site>/<name> --intent "..."` against the original target. The forge AI cost is usually 2–4K tokens per re-capture — cheaper than a hand-rewrite.

If the plan is bespoke (no public source, no easy re-forge), open a tap-skills issue tagged `migration-help`. The core team sweeps the queue weekly during the deprecation window.

---

## npm packages

| Package | v0.x | v1.0 (this release) | Action |
|---|---|---|---|
| [`@taprun/spec`](https://www.npmjs.com/package/@taprun/spec) | Vendored v1 schema | Re-vendored v2 `core/types.ts` PUBLIC subset + JSON Schema validator | `npm install @taprun/spec@^1` |
| [`@taprun/from-playwright`](https://www.npmjs.com/package/@taprun/from-playwright) | Compiles to v1 plan | Compiles to v2 Plan | `npm install @taprun/from-playwright@^1` |
| [`@taprun/from-puppeteer`](https://www.npmjs.com/package/@taprun/from-puppeteer) | Compiles to v1 plan | Compiles to v2 Plan | `npm install @taprun/from-puppeteer@^1` |
| [`@taprun/from-stagehand`](https://www.npmjs.com/package/@taprun/from-stagehand) | Compiles Stagehand → v1 | Compiles to v2 Plan | `npm install @taprun/from-stagehand@^1` |
| [`create-tap-script`](https://www.npmjs.com/package/create-tap-script) | Scaffolds v1 starter | Scaffolds v2 starter | `npx create-tap-script@latest` |

### `from-stagehand` ships v2 at 1.0.0

An earlier revision of this guide deprecated `from-stagehand` — Stagehand is cloud-coupled (it requires Browserbase to run) while Tap v2 is local-first by architecture (cookies never cross a trust boundary). That call was reversed once it was clear the adapter is **compile-time only**: it reads Stagehand `.ts/.js` source and emits a bare v2 `Plan`, so it never drags a cloud implementation into the engine. Deterministic Playwright calls map to plan ops; NL `act` / `extract` / `observe` land on `op:eval` with the prompt preserved as a TODO for you to finalise. Install with `npm install @taprun/from-stagehand@^1`.

Prefer to skip the NL steps entirely? Capture the same flow with [`@taprun/from-playwright`](https://www.npmjs.com/package/@taprun/from-playwright) against your own Chromium — the underlying Playwright control-flow is what Stagehand wraps anyway.

### v0.x is not unpublished

We never `npm unpublish`. v0.x stays installable forever; lockfiles continue to resolve. The only difference is the `npm deprecate` notice that points back here. Upgrade on your schedule.

---

## Code-level mapping cheatsheet

### Read tap

v1:
```json
{
  "@context": ["http://www.w3.org/ns/anno.jsonld", "https://taprun.dev/ns/tap-v1"],
  "type": "Annotation",
  "motivation": "tap:executing",
  "body": {
    "type": "tap:ExecutionPlan",
    "site": "github", "name": "trending",
    "intent": "read",
    "ops": [
      { "op": "fetch", "url": "https://api.github.com/search/repositories?q=stars:>1000" }
    ]
  }
}
```

v2:
```json
{
  "id": { "site": "github", "name": "trending" },
  "observe": [
    {
      "op": "fetch",
      "url": "https://api.github.com/search/repositories?q=stars:>1000",
      "format": "json",
      "save": "raw"
    }
  ],
  "return": "$.raw.items"
}
```

### Write tap

v1 used `intent: "write"` plus a free-form `op:exec` body. v2 splits the lifecycle into `observe` (read state), `act` (perform side effect), `confirm` (verify it took), with a `key` CEL expression that dedups runs.

```json
{
  "id": { "site": "twitter", "name": "post" },
  "args": { "text": { "type": "string", "required": true } },
  "key": "$.args.text",
  "observe": [
    { "op": "fetch", "url": "https://twitter.com/api/me/drafts", "save": "drafts" }
  ],
  "act": [
    { "op": "input", "kind": "fill",  "target": "[data-testid='tweetTextarea_0']", "value": "{{$.args.text}}" },
    { "op": "input", "kind": "click", "target": "[data-testid='tweetButton']" }
  ],
  "confirm": [
    { "op": "wait", "selector": "[data-testid='toast']", "timeout_ms": 5000 }
  ],
  "return": "$.confirm[0]"
}
```

The `act` array carries the side effect; `confirm` verifies it landed; `key` is the dedup contract over runs sharing the same args. Runs sharing a key go through the intent state machine (`preflight` → `in_flight` → `committed` / `aborted` / `uncertain`) so a retry can't double-post.

### `op:exec` → `op:eval`

v1's `op:exec` was the all-purpose JS escape hatch. v2 replaces it with `op:eval`, which:

- runs in page context (not Deno host) — same security posture as `chrome.scripting`;
- requires a declared `returns.type` (`string` | `number` | `boolean` | `object` | `array`) — output is schema-checked before binding into scope;
- forbids side effects via lint — eval is value-only.

If your old `op:exec` was doing DOM mutation, model it as a sequence of `op:input` ops. If it was reading a value, port it to `op:eval` with the appropriate `returns.type`.

---

## Doctor verdict — what changed in CI

If your CI parses `tap verify` JSON output (formerly `tap doctor` in v1), the verdict enum collapsed from 6 arms to 4:

| v1 verdict | v2 verdict | Notes |
|---|---|---|
| `healthy` | `equivalent` | Renamed for symmetry with `drifted` |
| `broken` | `drifted` | Drift now includes the per-tap CEL predicate result |
| `stale` | `drifted` | No separate state — the predicate decides |
| `layer-mismatch` | `drifted` | Folded in |
| `unverified` | `first_snapshot` | First-run state on a fresh tap |
| `unreachable` | `unreachable` | Unchanged |

The 40% false-positive reduction (PoC-measured) comes from the per-tap `snapshot_equivalent` CEL predicate — you decide which fields count as "the same answer."

---

## Plugins, if you ship them

Plugin authoring moved off the in-process `*.plugin.ts` interface to MCP sub-server pattern: `~/.tap/config/plugins/<name>/manifest.json` plus an executable speaking JSON-RPC. Same secrets file (`~/.tap/secrets`), same SMTP / shell-out logic, structured manifest. See [`plugin-runtime-model`](/adrs/) for the interface.

If you maintain `qqmail`, `demand`, `jimeng`, `dreamina`, or `mail-send` plugins — the core team is opening rewrite PRs against your repos during the migration window. Merge or fork as you prefer.

---

## Timeline

| When | What |
|---|---|
| Day 0 | v1.0.0 packages publish; `taprun.dev` rebuild deploys |
| Day +30 | npm `deprecate` warning starts firing on every install of v0.x |
| Day +90 | v0.x receives security patches only |
| Day +180 | v0.x retired (still downloadable; effectively frozen) |

Three weeks of prep before Day 0 — internal dogfood, community-tap migration, blog post — so by the time you read this, the path is well-trodden.

---

## Stuck?

- [Why v2](/blog/why-v2.html) — the design rationale
- [ADR-driven design](/adrs/) — every decision under `2026-05-04-*` is public
- [tap-skills](https://github.com/LeonTing1010/tap-skills) — file an issue tagged `migration-help`
- Or email <hello@taprun.dev>
