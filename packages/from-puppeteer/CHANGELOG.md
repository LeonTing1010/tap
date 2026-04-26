# @taprun/from-puppeteer — Changelog

## 0.1.1 — 2026-04-26

- README: add "Part of the Tap ecosystem" footer with UTM-tagged links to taprun.dev (homepage, Chrome extension, comparison page) plus cross-links to sibling JSR packages.

## 0.1.1 — unreleased

- Cleanup: `devDependencies["@taprun/spec"]` switched from `file:../spec` to `^0.3.0`. Workspace symlinks at the public/ root keep dev resolution local; published `package.json` is now self-contained.

## 0.1.0 — 2026-04-26

Initial MVP release. Mirror of `@taprun/from-playwright` with Puppeteer-specific adjustments.

Supported Puppeteer APIs:

- `page.goto(url)` → `{ op: "nav", url }`
- `page.click(selector)` → `{ op: "input", kind: "click", target }`
- `page.type(selector, value)` → `{ op: "input", kind: "fill", target, value }` (Puppeteer's `type` semantically fills — mapped to plan-v1 `fill` for cross-adapter consistency)
- `page.keyboard.press(key)` → `{ op: "input", kind: "press", value: key }` (no `target` — focused element)
- `page.waitForSelector(selector)` → `{ op: "wait", selector }`
- `page.waitForTimeout(ms)` → `{ op: "wait", ms }`
- `page.screenshot()` → `{ op: "screenshot" }`

Lifecycle methods (`launch`, `newPage`, `newContext`, `defaultBrowserContext`, `close`, `disconnect`) silently dropped.

Same regex-scanner limitations as `@taprun/from-playwright`.
