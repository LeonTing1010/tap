# @taprun/from-puppeteer

> Convert Puppeteer scripts into Tap plan-v1 `.tap.json` files.

```bash
npm install @taprun/from-puppeteer @taprun/spec
```

Take any Puppeteer `.ts/.js` script, get back a `.tap.json` envelope that `tap doctor` and `tap heal` understand.

## Status

**0.1.0 — MVP.** Covers the 7 most common page-level APIs:

| Puppeteer API | → plan-v1 op |
|---|---|
| `page.goto(url)` | `{ op: "nav", url }` |
| `page.click(s)` | `{ op: "input", kind: "click", target }` |
| `page.type(s, v)` | `{ op: "input", kind: "fill", target, value }` ¹ |
| `page.keyboard.press(k)` | `{ op: "input", kind: "press", value: k }` ² |
| `page.waitForSelector(s)` | `{ op: "wait", selector }` |
| `page.waitForTimeout(ms)` | `{ op: "wait", ms }` ³ |
| `page.screenshot()` | `{ op: "screenshot" }` |

¹ Puppeteer's `type` semantically fills the field — mapped to plan-v1 `fill` for cross-adapter consistency. If you want true keyboard-event simulation use `page.keyboard.press` per character.

² `keyboard.press` operates on the focused element — the resulting op has no `target`. Combine with a preceding `click(selector)` to land focus first.

³ Deprecated in modern Puppeteer but still common in legacy scripts. The adapter accepts it and emits `{ op: "wait", ms }`.

## Usage

```ts
import { readFile, writeFile } from "node:fs/promises";
import { puppeteerToTap } from "@taprun/from-puppeteer";
import { runConformance } from "@taprun/spec";

const source = await readFile("scripts/login.js", "utf8");
const plan = puppeteerToTap(source, {
  site: "example",
  name: "login",
  intent: "write",
});

const v = runConformance(plan);
if (!v.pass) throw new Error("not conformant: " + JSON.stringify(v.failures));
await writeFile("example/login.tap.json", JSON.stringify(plan, null, 2));
```

Anything outside the 7 supported APIs becomes `{ op: "exec", allowUnverifiable: true }` preserving the original line, or throws `PuppeteerConversionError` under `strict: true`.

## Limitations

Same shape as `@taprun/from-playwright`:
- Variable-bound selectors (`const sel = "..."; page.click(sel)`) — adapter sees the variable name. Use literals.
- Template-string interpolation works only for fully-literal back-tick strings.
- Trailing line comments are visible to the regex matchers (don't affect successful matches).

These will be addressed in 0.2 with an AST walk replacing the regex scanner.

## Part of the Tap ecosystem

[Tap](https://taprun.dev?utm_source=jsr&utm_medium=readme&utm_campaign=from-puppeteer) is local-first browser automation — compile your scraper once, run it in your own browser forever, and diff the drift when sites change.

- Format spec: [`@taprun/spec`](https://jsr.io/@taprun/spec) — W3C-compliant validator for `.tap.json`
- Sibling adapters: [`@taprun/from-playwright`](https://jsr.io/@taprun/from-playwright) · [`@taprun/from-stagehand`](https://jsr.io/@taprun/from-stagehand)
- Scaffold a fresh plan: `npx create-tap-script <site>/<name> <url>`
- Run locally: [Tap Chrome extension](https://taprun.dev?utm_source=jsr&utm_medium=readme&utm_campaign=from-puppeteer) — credentials never leave your machine
- Compare to Stagehand / Browserbase: <https://taprun.dev/compare/stagehand/?utm_source=jsr&utm_medium=readme&utm_campaign=from-puppeteer>
- Source: <https://github.com/LeonTing1010/tap> · npm: <https://www.npmjs.com/~taprun>

## License

MIT.
