# @taprun/from-stagehand — Changelog

## 1.0.0 — 2026-05-10

**Breaking — Plan v2 migration.** The adapter now emits `@taprun/spec@^1.0.0`
v2 `Plan` objects instead of the v1 `TapAnnotation` envelope. Aligns with
ADR `2026-05-04-ecosystem-v2-launch.md` and the sibling `from-puppeteer` /
`from-playwright` packages.

What changed:

- Output type is `Plan` (discriminated union: `read` variant with
  `observe` ops, or `write` variant with `act` + `key`). The W3C
  Annotation envelope (`@context`, `motivation`, `target`, `body`,
  `generator`) is gone — that lived in v1 only.
- Stagehand NL calls (`act` / `extract` / `observe` / `agent.execute`)
  now compile to `op:eval` with a mandatory `returns.type` and the
  prompt preserved as a TODO comment in `fn`. Previously emitted
  `op:exec` (retired in v2) and set `allowUnverifiable:true` (also
  retired in v2 — the field is gone from `Plan`).
- `op:screenshot` was retired in v2; `page.screenshot()` now compiles
  to an `op:eval` TODO stub instead of being silently dropped.
- New `strict` option (mirrors `from-puppeteer`) — throws
  `StagehandConversionError` on unsupported calls instead of falling
  back to `op:eval`.
- Auto-detected `intent`: write variant when click selector / NL prompt
  matches `submit|login|signin|signup|register|checkout|buy|publish|...`,
  or any `fill`/`type` targets a password field, or `agent.execute(...)`
  is present. Otherwise read variant.
- Peer-dep bumped to `@taprun/spec@^1.0.0`.

Migration: any consumer that read `result.body.ops` should switch to
`result.observe ?? result.act`. Drop any code that branched on
`body.allowUnverifiable` — surface the same information by inspecting
op types (`op:eval` with TODO marker = LLM-resolved at runtime).

## 0.1.1 — 2026-04-26

- README: add "Part of the Tap ecosystem" footer with UTM-tagged links to taprun.dev (homepage, Chrome extension, comparison page) plus cross-links to sibling JSR packages.

## 0.1.1 — unreleased

- Cleanup: `devDependencies["@taprun/spec"]` switched from `file:../spec` to `^0.3.0`. Workspace symlinks at the public/ root keep dev resolution local; published `package.json` is now self-contained.

## 0.1.0 — 2026-04-26

Initial MVP release. Hybrid converter for Stagehand scripts.

**Deterministic Playwright APIs** (via `stagehand.context.pages()[0]`):

- `page.goto / click / fill / type / press / waitForSelector / waitForTimeout / screenshot` → standard plan-v1 ops, same mapping as `@taprun/from-playwright`.

**Natural-language Stagehand APIs**:

- `stagehand.act(prompt)` → `{ op: "exec", allowUnverifiable: true }` with prompt preserved in `fn` comment
- `stagehand.extract(prompt, schema)` → same
- `stagehand.observe(...)` → `{ op: "exec", allowUnverifiable: true, fn: "// observe" }`
- `stagehand.agent().execute(prompt)` → exec with prompt

When any NL call is present, the entire plan is marked `allowUnverifiable: true` so consumers (Tap doctor / external validators) know which steps require an LLM.

Lifecycle methods extended: `init`, `pages`, `context`, `page`, `browser` (Stagehand-specific accessors) silently dropped in addition to the standard set.

Single-line prompt style required (multi-line falls through to `[unmatched]` exec).
