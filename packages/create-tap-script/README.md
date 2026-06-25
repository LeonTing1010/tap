# create-tap-script

> One command. One starter `.plan.json`. Ready to customize.

```bash
npx create-tap-script@latest github/issues "List issues for a repo"
```

Creates:

```
github/
├── issues.plan.json     # Tap v2 Plan starter
└── issues.README.md     # next-steps notes
```

## Why

The friction model that won Stagehand 745K weekly downloads is "one command, ready to go." `npx create-tap-script` mirrors that for Tap v2. Stop hand-writing Plan documents — start with a working stub that already uses the user's authenticated browser session via `credentials: "page-session"`.

## Usage

```bash
npx create-tap-script@latest <site>/<name> ["description"] [options]
```

| Option | Default | Notes |
|---|---|---|
| `--write` | off | Scaffold a write-variant plan (adds `act` + `key`) |
| `--variant read\|write` | `read` | Equivalent to `--write` |
| `--out DIR` | cwd | Output directory |
| `--force` | off | Overwrite existing files |
| `--help` | — | Show usage |

## What you get

A read-variant starter (the default):

```jsonc
{
  "id": { "site": "github", "name": "issues" },
  "description": "List issues for a repo",
  "args": {
    "someArg": {
      "type": "string",
      "required": true,
      "description": "Example argument referenced by the templated fetch URL."
    }
  },
  "requires": { "runtime": "extension" },
  "observe": [
    {
      "op": "fetch",
      "url": "https://api.github.example.com/{{ args.someArg }}",
      "method": "GET",
      "format": "json",
      "credentials": "page-session",
      "save": "$1"
    }
  ],
  "return": "$1.body"
}
```

Pass `--write` to scaffold a mutation tap with `act` + `key` (intent dedup) instead.

## Spec & op set

The output is a bare Tap v2 Plan (`@taprun/spec` v1.0+) — the W3C Annotation envelope and `op:exec` from v0.x are gone. Plans use the closed 13-op union: `fetch` · `nav` · `wait` · `input` · `extract` · `cookies` · `tap` · `if` · `foreach` · `parallel` · `eval` · `tab` · `bookmark`. CEL handles all data shaping; there is no `intent: "read"|"write"` field — read vs write is encoded as the Plan discriminated union (presence of `act` + `key`).

See <https://taprun.dev/spec/> for the full reference.

## Have an existing script?

Use one of the dedicated adapters instead:

- [`@taprun/from-playwright`](https://www.npmjs.com/package/@taprun/from-playwright) — convert Playwright `.ts/.js`
- [`@taprun/from-puppeteer`](https://www.npmjs.com/package/@taprun/from-puppeteer) — convert Puppeteer `.ts/.js`

(Stagehand is cloud-coupled and is not supported in v2 — see ADR 2026-05-04 §6.2.)

## Part of the Tap ecosystem

[Tap](https://taprun.dev?utm_source=npm&utm_medium=readme&utm_campaign=create-tap-script) is local-first browser automation — compile your scraper once, run it in your own browser forever, and diff the drift when sites change.

- Format spec: [`@taprun/spec`](https://www.npmjs.com/package/@taprun/spec) — TypeScript types + JSON Schema validator for `.plan.json`
- Run locally: [Tap Chrome extension](https://taprun.dev) — credentials never leave your machine
- Source: <https://github.com/LeonTing1010/tap> · npm: <https://www.npmjs.com/~taprun>

## License

MIT.
