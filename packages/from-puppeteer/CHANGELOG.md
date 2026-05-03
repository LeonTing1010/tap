# @taprun/from-puppeteer — Changelog

## 1.0.0 — 2026-05-04

**BREAKING.** Output format flipped from v1 (W3C-Annotation envelope wrapping `tap:ExecutionPlan` body, with `op:exec` escape hatch) to **Tap Plan v2** (bare `Plan` object per `@taprun/spec@^1.0`). Per
[ADR 2026-05-04 Ecosystem v2 launch](../../core/docs/adr/2026-05-04-ecosystem-v2-launch.md).

Field-by-field changes:

| 0.x output | 1.0 output |
|---|---|
| `body.type: "tap:ExecutionPlan"` | (gone — Plan is bare) |
| `body.site` / `body.name` | `id.site` / `id.name` |
| `body.intent: "read" \| "write"` | discriminated by `observe` (read) vs `act + key` (write) |
| `body.ops` | `observe` or `act` |
| `body.allowUnverifiable: true` | (gone — v2 has no op:exec to flag) |
| `op: "exec"` | `op: "eval"` with mandatory `returns: { type }` |
| `op: "screenshot"` | (dropped — not in v2 11-op closure) |
| `@context` / `motivation` / `target` / `generator` | (gone — moved to Plan-level metadata or removed) |

Op mapping additions:

- `page.cookies()` → `{ op: "cookies" }` (new in v2; legacy adapter dropped these)
- `page.$$eval(s, fn)` → `{ op: "eval", returns: { type: "array" } }` with TODO placeholder
- `page.evaluate(fn)` → `{ op: "eval", returns: { type: "object" } }` with TODO placeholder
- `page.type(s, v)` now maps to `kind: "type"` (was `kind: "fill"` in v0.x for cross-adapter consistency; v2 keeps the Puppeteer-native verb)

Variant auto-detection (NEW): a script with a password field type or a click on a `submit/login/signup/checkout/...`-matching selector is emitted as the `write` variant (`act + key`); other scripts emit as `read` (`observe`). Override with `{ intent }` in options.

Users on `0.1.x` lockfiles continue to work (npm doesn't break installed lockfiles); new installs get `1.0.0`. The `0.x` line is deprecated via `npm deprecate` and will not receive bug fixes.

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
