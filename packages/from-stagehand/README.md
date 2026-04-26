# @taprun/from-stagehand

> Convert Stagehand scripts into Tap plan-v1 `.tap.json` files. Complement to Stagehand, not a replacement.

```bash
npm install @taprun/from-stagehand @taprun/spec
```

## What this is for

[Stagehand](https://github.com/browserbase/stagehand) (Browserbase) ships natural-language browser automation on top of Playwright. Two API surfaces coexist in user scripts:

1. **Deterministic Playwright** — `page.goto / click / fill / type / press / waitForSelector / waitForTimeout / screenshot`. These have fixed selectors and stable behavior.
2. **Natural-language Stagehand** — `stagehand.act("...")`, `stagehand.extract("...", schema)`, `stagehand.observe()`, `stagehand.agent().execute("...")`. These resolve to actions only at runtime via an LLM.

This adapter takes a pragmatic stance:

| Stagehand API | → plan-v1 op | Verifiable? |
|---|---|---|
| `page.goto(url)` | `{ op: "nav", url }` | ✓ |
| `page.click(s)` | `{ op: "input", kind: "click", target }` | ✓ |
| `page.fill(s, v)` | `{ op: "input", kind: "fill", target, value }` | ✓ |
| `page.type / press / waitForSelector / waitForTimeout / screenshot` | (same as @taprun/from-playwright) | ✓ |
| `stagehand.act(prompt)` | `{ op: "exec", allowUnverifiable: true }` (prompt preserved in fn comment) | ✗ |
| `stagehand.extract(prompt, schema)` | `{ op: "exec", allowUnverifiable: true }` | ✗ |
| `stagehand.observe(...)` | `{ op: "exec", allowUnverifiable: true }` | ✗ |
| `stagehand.agent().execute(prompt)` | `{ op: "exec", allowUnverifiable: true }` | ✗ |

**Result**: a partially deterministic plan. Tap can `doctor` and `heal` the page.* portions. The NL portions remain a black box that Stagehand re-resolves at runtime — Tap reports them via `allowUnverifiable: true` so consumers know exactly which steps require an LLM.

## Positioning

This is **not** a Stagehand replacement. It's a Tap-side bridge so Stagehand users can:
- Add structural drift detection on the deterministic portions of their scripts
- Audit which steps in their automation actually require an LLM
- Produce a portable `.tap.json` artifact for compliance / reproducibility logs

## Usage

```ts
import { readFile, writeFile } from "node:fs/promises";
import { stagehandToTap } from "@taprun/from-stagehand";
import { runConformance } from "@taprun/spec";

const source = await readFile("scripts/my-stagehand-script.ts", "utf8");
const plan = stagehandToTap(source, {
  site: "github",
  name: "browserbase-search",
  intent: "read",
});

const v = runConformance(plan);
if (!v.pass) throw new Error(JSON.stringify(v.failures));

await writeFile("github/browserbase-search.tap.json", JSON.stringify(plan, null, 2));
```

## Scope notes

- Lifecycle calls (`stagehand.init`, `stagehand.close`, `browser.newPage`, etc.) are silently dropped — they're scaffolding, not user actions.
- Plain Playwright deterministic calls follow exactly the same regex as `@taprun/from-playwright` (no behavioral divergence).
- The MVP regex scanner has the same limitations as the Playwright/Puppeteer adapters: variable-bound selectors, template-string interpolation, and trailing line comments are best-effort.

## Part of the Tap ecosystem

[Tap](https://taprun.dev?utm_source=jsr&utm_medium=readme&utm_campaign=from-stagehand) is local-first browser automation — compile your scraper once, run it in your own browser forever, and diff the drift when sites change. The local-first runtime means your `act()` and `extract()` calls hit your already-logged-in session — no Browserbase egress, no shared cloud browser.

- Format spec: [`@taprun/spec`](https://jsr.io/@taprun/spec) — W3C-compliant validator for `.tap.json`
- Sibling adapters: [`@taprun/from-playwright`](https://jsr.io/@taprun/from-playwright) · [`@taprun/from-puppeteer`](https://jsr.io/@taprun/from-puppeteer)
- Scaffold a fresh plan: `npx create-tap-script <site>/<name> <url>`
- Run locally: [Tap Chrome extension](https://taprun.dev?utm_source=jsr&utm_medium=readme&utm_campaign=from-stagehand) — credentials never leave your machine
- Why Tap vs Stagehand / Browserbase: <https://taprun.dev/compare/stagehand/?utm_source=jsr&utm_medium=readme&utm_campaign=from-stagehand>
- Source: <https://github.com/LeonTing1010/tap> · npm: <https://www.npmjs.com/~taprun>

## License

MIT.
