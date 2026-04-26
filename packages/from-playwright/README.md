# @taprun/from-playwright

> Convert Playwright test scripts into Tap plan-v1 `.tap.json` files.

```bash
npm install @taprun/from-playwright @taprun/spec
```

Take any Playwright `.ts/.js` script, get back a `.tap.json` envelope that `tap doctor` and `tap heal` understand. Reuse the script you already have; add monitoring + self-healing on top.

## Status

**0.0.0 — Iteration 1 stub.** API and types are pinned; conversion lands in Iteration 2. Throws `PlaywrightConversionError("not-implemented")` until then.

## Usage (planned)

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

| Playwright API | → plan-v1 op | Iteration |
|---|---|---|
| `page.goto(url)` | `{ op: "nav", url }` | 2 |
| `page.click(selector)` | `{ op: "input", kind: "click", target }` | 2 |
| `page.fill(s, v)` | `{ op: "input", kind: "fill", target, value }` | 2 |
| `page.type(s, v)` | `{ op: "input", kind: "type", target, value }` | 2 |
| `page.press(s, k)` | `{ op: "input", kind: "press", target, value: k }` | 2 |
| `page.locator(s).textContent()` | `{ op: "extract", root, per_item: { text: "" } }` | 3 |
| `page.waitForSelector(s)` | `{ op: "wait", selector }` | 2 |
| `page.waitForTimeout(ms)` | `{ op: "wait", ms }` | 2 |
| `page.screenshot()` | `{ op: "screenshot" }` | 3 |

Out of scope (escaped via `{ op: "exec", fn: <original code>, allowUnverifiable: true }`):
- Custom test fixtures
- `expect()` assertions (use `health.non_empty` / `authoritative` instead)
- Multi-context / multi-page setups
- Playwright trace files (separate adapter)

## License

MIT.
