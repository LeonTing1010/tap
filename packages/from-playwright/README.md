# @taprun/from-playwright

> Convert Playwright test scripts into Tap plan-v1 `.tap.json` files.

```bash
npm install @taprun/from-playwright @taprun/spec
```

Take any Playwright `.ts/.js` script, get back a `.tap.json` envelope that `tap doctor` and `tap heal` understand. Reuse the script you already have; add monitoring + self-healing on top.

## Status

**0.1.0** — MVP works. `page.goto / click / fill / type / press / waitForSelector / waitForTimeout / screenshot` are mapped to plan-v1 ops. Anything else permissively becomes `{ op: "exec" }` preserving the original line, or throws under `strict: true`.

## Usage

```ts
import { readFile, writeFile } from "fs/promises";
import { playwrightToTap } from "@taprun/from-playwright";
import { runConformance } from "@taprun/spec";

const source = await readFile("tests/github.spec.ts", "utf8");
const plan = playwrightToTap(source, {
  site: "github",
  name: "search",
  intent: "read",
});

const v = runConformance(plan);
if (!v.pass) throw new Error("adapter output not conformant: " + JSON.stringify(v.failures));

await writeFile("github/search.tap.json", JSON.stringify(plan, null, 2));
```

## Scope

| Playwright API | → plan-v1 op | Status |
|---|---|---|
| `page.goto(url)` | `{ op: "nav", url }` | ✓ 0.1 |
| `page.click(selector)` | `{ op: "input", kind: "click", target }` | ✓ 0.1 |
| `page.fill(s, v)` | `{ op: "input", kind: "fill", target, value }` | ✓ 0.1 |
| `page.type(s, v)` | `{ op: "input", kind: "type", target, value }` | ✓ 0.1 |
| `page.press(s, k)` | `{ op: "input", kind: "press", target, value: k }` | ✓ 0.1 |
| `page.waitForSelector(s)` | `{ op: "wait", selector }` | ✓ 0.1 |
| `page.waitForTimeout(ms)` | `{ op: "wait", ms }` | ✓ 0.1 |
| `page.screenshot()` | `{ op: "screenshot" }` | ✓ 0.1 |
| `page.locator(s).textContent()` | `{ op: "extract", root, per_item: { text: "" } }` | planned 0.2 |
| `page.evaluate(...)` | `{ op: "exec", allowUnverifiable: true }` (permissive) or throws (strict) | ✓ 0.1 |

### MVP limitations

The Iter-2 MVP uses a regex-then-string-literal scanner. Known gotchas:
- Variable-bound selectors (`const sel = "..."; page.click(sel)`) — the scanner sees the variable name, not the value. Inline literals work; variables don't.
- Template-string interpolation works only when the entire string is a literal. `\`${dynamic}\`` falls through to permissive `exec`.
- Trailing line comments stay in the source visible to regex (they don't affect successful matches but may cause the unhandled-line warning to fire on commented-out calls).

These will be addressed in 0.2 when the scanner upgrades to a real TypeScript AST walk.

Out of scope (escaped via `{ op: "exec", fn: <original code>, allowUnverifiable: true }`):
- Custom test fixtures
- `expect()` assertions (use `health.non_empty` / `authoritative` instead)
- Multi-context / multi-page setups
- Playwright trace files (separate adapter)

## Part of the Tap ecosystem

[Tap](https://taprun.dev?utm_source=jsr&utm_medium=readme&utm_campaign=from-playwright) is local-first browser automation — compile your scraper once, run it in your own browser forever, and diff the drift when sites change.

- Format spec: [`@taprun/spec`](https://jsr.io/@taprun/spec) — W3C-compliant validator for `.tap.json`
- Sibling adapters: [`@taprun/from-puppeteer`](https://jsr.io/@taprun/from-puppeteer) · [`@taprun/from-stagehand`](https://jsr.io/@taprun/from-stagehand)
- Scaffold a fresh plan: `npx create-tap-script <site>/<name> <url>`
- Run locally: [Tap Chrome extension](https://taprun.dev?utm_source=jsr&utm_medium=readme&utm_campaign=from-playwright) — credentials never leave your machine
- Compare to Stagehand / Browserbase: <https://taprun.dev/compare/stagehand/?utm_source=jsr&utm_medium=readme&utm_campaign=from-playwright>
- Source: <https://github.com/LeonTing1010/tap> · npm: <https://www.npmjs.com/~taprun>

## License

MIT.
