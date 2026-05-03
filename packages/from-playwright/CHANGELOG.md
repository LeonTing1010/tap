# @taprun/from-playwright — Changelog

## 1.0.0 — 2026-05-04

**BREAKING**: emits Tap v2 Plan format. v1 W3C Annotation envelope output is gone. Requires `@taprun/spec@^1.0.0`.

Per [ADR 2026-05-04 Ecosystem v2 Launch](https://github.com/LeonTing1010/tap/blob/main/docs/adr/2026-05-04-ecosystem-v2-launch.md):

- Output is now a bare `Plan` (discriminated union of read variant / write variant) — no `@context`, no `motivation`, no `target`, no `body`, no `generator`.
- Op closure narrowed from 24 to 11 (fetch / nav / wait / input / extract / cookies / tap / if / foreach / parallel / eval). `op:exec` is retired.
- `op:eval` is the escape hatch for unmapped Playwright APIs and `page.evaluate(...)`. `returns.type` is mandatory; defaults to `"object"` with a warning to verify.
- New `page.context().cookies()` mapping → `{ op: "cookies" }`.
- `page.screenshot()` is now dropped with a warning (no v2 equivalent).
- New return shape: `{ plan, warnings }` instead of bare `TapAnnotation`. Warnings are structured (`kind: "eval-fallback" | "todo-key" | "screenshot-dropped" | "lifecycle-dropped"`).
- New `options.variant: "read" | "write"` override; heuristic infers write iff a submit-like click is seen.
- Write variant emits placeholder `key: "TODO_DECLARE_KEY"` — the user must fill in a CEL expression before relying on dedup semantics.

Deprecation: v0.x is permanently downloadable but no longer maintained. Run `npm install @taprun/from-playwright@latest` to pick up v1.0.

## 0.2.0 — 2026-05-01

Locator-chain support (Playwright codegen output).

## 0.1.1 — 2026-04-26

- README: add "Part of the Tap ecosystem" footer with UTM-tagged links.
- Cleanup: `devDependencies["@taprun/spec"]` switched from `file:../spec` to `^0.3.0`.

## 0.1.0 — 2026-04-26

Initial MVP release. Regex-then-string-literal scanner converting Playwright source into plan-v1 envelopes.
