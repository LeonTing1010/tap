# @taprun/from-playwright — Changelog

## 0.1.1 — unreleased

- Cleanup: `devDependencies["@taprun/spec"]` switched from `file:../spec` to `^0.3.0`. Workspace symlinks at the public/ root keep dev resolution local; published `package.json` is now self-contained.

## 0.1.0 — 2026-04-26

Initial MVP release. Regex-then-string-literal scanner converting Playwright source into plan-v1 envelopes.

Supported Playwright APIs (mapped to plan-v1 ops):

- `page.goto(url)` → `{ op: "nav", url }`
- `page.click(selector)` → `{ op: "input", kind: "click", target }`
- `page.fill(selector, value)` → `{ op: "input", kind: "fill", target, value }`
- `page.type(selector, value)` → `{ op: "input", kind: "type", target, value }`
- `page.press(selector, key)` → `{ op: "input", kind: "press", target, value: key }`
- `page.waitForSelector(selector)` → `{ op: "wait", selector }`
- `page.waitForTimeout(ms)` → `{ op: "wait", ms }`
- `page.screenshot()` → `{ op: "screenshot" }`

Permissive mode (default) emits `{ op: "exec", allowUnverifiable: true }` for unhandled calls; strict mode throws `PlaywrightConversionError`.

Lifecycle methods (`launch`, `newPage`, `newContext`, `defaultBrowserContext`, `close`, `disconnect`) silently dropped — they're test scaffolding, not user actions.

Known limitations (planned 0.2 — AST walk):

- Variable-bound selectors fall through to permissive exec.
- Template-string interpolation works only for fully-literal back-tick strings.
- Trailing line comments visible to regex matchers.
