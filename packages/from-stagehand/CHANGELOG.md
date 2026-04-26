# @taprun/from-stagehand — Changelog

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
