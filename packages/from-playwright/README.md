# @taprun/from-playwright

> Convert Playwright test scripts into Tap **v2** Plan JSON.

```bash
npm install @taprun/from-playwright @taprun/spec
```

Take any Playwright `.ts/.js` script, get back a v2 `Plan` that `tap verify` and `tap capture` (heal-via-recapture) understand. Reuse the script you already have; add drift detection + repair on top.

## v1.0 — v2 schema

**1.0** ships v2 plan output. Per [ADR 2026-05-04 Ecosystem v2 Launch](https://github.com/LeonTing1010/tap/blob/main/docs/adr/2026-05-04-ecosystem-v2-launch.md), the entire ecosystem moved off the v1 W3C Annotation envelope to a bare `Plan` shape with the 13-op closure. Output of v1.0 is **not** backwards compatible with v0.x — install `@taprun/spec@1.x` alongside.

> v0.x targets the legacy Tap v1 schema. It still compiles for users on existing lockfiles; new installs should use v1.0+.

## Usage

```ts
import { readFile, writeFile } from "fs/promises";
import { playwrightToTap } from "@taprun/from-playwright";

const source = await readFile("tests/github.spec.ts", "utf8");
const { plan, warnings } = playwrightToTap(source, {
  site: "github",
  name: "search",
});

if (warnings.length) {
  console.warn("Conversion warnings:", warnings);
}

await writeFile("github/search.flow.json", JSON.stringify(plan, null, 2));
```

## Mapping (v1.0)

| Playwright API | → v2 Op | Status |
|---|---|---|
| `page.goto(url)` | `{ op: "nav", url }` | supported |
| `page.click(selector)` | `{ op: "input", kind: "click", target }` | supported |
| `page.fill(s, v)` | `{ op: "input", kind: "fill", target, value }` | supported |
| `page.type(s, v)` | `{ op: "input", kind: "type", target, value }` | supported |
| `page.press(s, k)` | `{ op: "input", kind: "press", target, value }` | supported |
| `page.waitForSelector(s)` | `{ op: "wait", selector }` | supported |
| `page.waitForTimeout(ms)` | `{ op: "wait", ms }` | supported |
| `page.context().cookies()` | `{ op: "cookies" }` | supported |
| `page.evaluate(fn)` | `{ op: "eval", fn, returns: { type: "object" } }` | supported (verify `returns.type`) |
| `page.locator(sel).<action>()` | passthrough on `target` | supported |
| `page.getByRole/Text/TestId/Label/Placeholder/AltText/Title(...)` | normalised selector | supported |
| `page.screenshot()` | dropped (no v2 op); warning emitted | retired |
| anything else | `{ op: "eval", ..., returns: { type: "object" } }` placeholder + warning | escape hatch |

The 13-op v2 closure has no `op:exec`. The eval escape hatch must declare `returns.type` per ADR 2026-05-03 §11.5 #47, so AI / human review is required to finalise an eval-fallback plan.

## Read vs write variant

The v2 Plan is a discriminated union. The adapter heuristically picks:

- **read** (default) — output has `observe: [...]`, no `act`, no `key`.
- **write** — output has `act: [...]` plus a placeholder `key: "TODO_DECLARE_KEY"`. Triggered when a click target matches a submit-like pattern (`[type=submit]`, role=button + name~"submit|post|send|publish|save|...").

Override with `options.variant: "read" | "write"` if the heuristic guesses wrong. Hand-rolling a real CEL `key` (the dedup contract) is out of scope for this deterministic adapter; expect to fill it in manually after conversion.

## Limitations

The v1.0 scanner is the same regex-then-string-literal walker as v0.x. Known gotchas:

- Variable-bound selectors fall through to `op:eval` placeholder.
- Template-string interpolation works only when the entire string is a literal.
- Trailing line comments stay in the source visible to regex.

These will be addressed when the scanner upgrades to a TypeScript AST walk.

Out of scope (escaped via `op:eval` placeholder):
- Custom test fixtures
- `expect()` assertions (use authoritative-source verification in the v2 Plan instead)
- Multi-context / multi-page setups
- Playwright trace files (separate adapter)

## Part of the Tap ecosystem

[Tap](https://taprun.dev?utm_source=npm&utm_medium=readme&utm_campaign=from-playwright) is local-first browser automation — compile your scraper once, run it in your own browser forever, and diff the drift when sites change.

- Format spec: [`@taprun/spec`](https://www.npmjs.com/package/@taprun/spec) — TypeScript types + JSON Schema for v2 plans
- Sibling adapter: [`@taprun/from-puppeteer`](https://www.npmjs.com/package/@taprun/from-puppeteer)
- Scaffold a fresh plan: `npx create-tap-script <site>/<name> <url>`
- Run locally: [Tap Chrome extension](https://taprun.dev?utm_source=npm&utm_medium=readme&utm_campaign=from-playwright) — credentials never leave your machine
- Source: <https://github.com/LeonTing1010/tap> · npm: <https://www.npmjs.com/~taprun>

## Rather have it run for you?

If your scraper keeps breaking and you'd rather buy the outcome than
maintain the tool, we set up the automation on *your* machine and keep it
working when sites change — flat monthly, cancel anytime:
**[taprun.dev/done-for-you](https://taprun.dev/done-for-you/?utm_source=npm&utm_medium=readme&utm_campaign=from-playwright)**.

## License

MIT.
