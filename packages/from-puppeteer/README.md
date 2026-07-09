# @taprun/from-puppeteer

> Convert Puppeteer scripts into Tap **Plan v2** (`@taprun/spec@^1.0`).

```bash
npm install @taprun/from-puppeteer @taprun/spec
```

Take any Puppeteer `.ts/.js` script, get back a v2 `Plan` object that
`tap verify` and `tap <site>/<name>` understand.

## Status

**1.0.0 — v2 schema.** Per
[ADR 2026-05-04 Ecosystem v2 launch](https://taprun.dev/blog/v2-launch/),
this package emits the v2 `Plan` shape (NOT the legacy W3C-Annotation
envelope; NOT `op:exec`). If you depend on the v0.x output format, pin
`@taprun/from-puppeteer@^0.1` — that branch is deprecated and will not
receive updates.

| Puppeteer API | → v2 op |
|---|---|
| `page.goto(url)` | `{ op: "nav", url }` |
| `page.click(s)` | `{ op: "input", kind: "click", target: s }` |
| `page.type(s, v)` | `{ op: "input", kind: "type", target: s, value: v }` |
| `page.keyboard.press(k)` | `{ op: "input", kind: "press", value: k }` ¹ |
| `page.waitForSelector(s)` | `{ op: "wait", selector: s }` |
| `page.waitForTimeout(ms)` | `{ op: "wait", ms }` ² |
| `page.cookies()` | `{ op: "cookies" }` |
| `page.$$eval(s, fn)` | `{ op: "eval", fn, returns: { type: "array" } }` ³ |
| `page.evaluate(fn)` | `{ op: "eval", fn, returns: { type: "object" } }` ³ |

¹ `keyboard.press` operates on the focused element — the resulting op
has no `target`. Combine with a preceding `click(selector)` to land
focus first.

² Deprecated in modern Puppeteer but still common in legacy scripts.

³ v2 has no `op:exec`. Free-form JS routes through `op:eval` with a
**mandatory `returns.type`** declaration. The adapter emits a TODO
placeholder — you MUST paste the real function body and refine
`returns.type` (string / number / boolean / object / array) before the
plan will pass `tap`'s save-time lint.

## Read vs Write variant

The v2 schema discriminates `Plan` into two variants (per ADR §10):

- **Read variant** — `observe` only; pure observation.
- **Write variant** — `act` + `key` (CEL dedup expression) both required.

The adapter auto-classifies: a script that types into a password field
or clicks a `submit/login/signup/checkout/...` selector is treated as
write; everything else is read. The synthesized `key` is a placeholder
you should refine to a real CEL expression. Override with
`{ intent: "read" | "write" }` in options.

## Usage

```ts
import { readFile, writeFile } from "node:fs/promises";
import { puppeteerToTap } from "@taprun/from-puppeteer";

const source = await readFile("scripts/login.js", "utf8");
const plan = puppeteerToTap(source, {
  site: "example",
  name: "login",
  // intent auto-detected: "write" because of the password type + submit click
});

await writeFile("example/login.plan.json", JSON.stringify(plan, null, 2));
```

Anything outside the supported APIs becomes a permissive
`{ op: "eval", returns: { type: "object" }, fn: "/* TODO ... */" }`
placeholder — you fix it up. With `strict: true` the adapter throws
`PuppeteerConversionError` instead.

## Limitations

Same shape as `@taprun/from-playwright`:
- Variable-bound selectors (`const sel = "..."; page.click(sel)`) — adapter sees the variable name. Use literals.
- Template-string interpolation works only for fully-literal back-tick strings.
- Trailing line comments are visible to the regex matchers.
- `page.screenshot()` from v0.x is **dropped** in v2 — it isn't in the
  v2 13-op closure (per `core/types.ts`).

Future versions will replace the regex scanner with an AST walk.

## Migrating from 0.x

The output type changed from `TapAnnotation` (v1 W3C envelope) to v2
`Plan` (bare object). Field-by-field changes:

| 0.x output | 1.0 output |
|---|---|
| `body.type: "tap:ExecutionPlan"` | (gone — Plan is bare) |
| `body.site` / `body.name` | `id.site` / `id.name` |
| `body.intent: "read" \| "write"` | discriminated by `observe` vs `act + key` |
| `body.ops` | `observe` (read variant) or `act` (write variant) |
| `body.allowUnverifiable: true` | (gone — v2 has no op:exec to flag) |
| `op: "exec", fn, allowUnverifiable` | `op: "eval", fn, returns: { type }` |
| `op: "screenshot"` | (gone — not in v2 13-op closure) |

## Part of the Tap ecosystem

[Tap](https://taprun.dev?utm_source=npm&utm_medium=readme&utm_campaign=from-puppeteer) is local-first browser automation — compile your scraper once, run it in your own browser forever, and diff the drift when sites change.

- Spec: [`@taprun/spec@^1.0`](https://www.npmjs.com/package/@taprun/spec)
- Sibling adapter: [`@taprun/from-playwright`](https://www.npmjs.com/package/@taprun/from-playwright)
- Scaffold a fresh plan: `npx create-tap-script <site>/<name> <url>`
- Run locally: [Tap Chrome extension](https://taprun.dev?utm_source=npm&utm_medium=readme&utm_campaign=from-puppeteer)
- Source: <https://github.com/LeonTing1010/tap>

## Rather have it run for you?

If your scraper keeps breaking and you'd rather buy the outcome than
maintain the tool, we set up the automation on *your* machine and keep it
working when sites change — flat monthly, cancel anytime:
**[taprun.dev/done-for-you](https://taprun.dev/done-for-you/?utm_source=npm&utm_medium=readme&utm_campaign=from-puppeteer)**.

## License

MIT.
