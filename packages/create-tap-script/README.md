# create-tap-script

> One command. One starter `.tap.json`. Ready to customize.

```bash
npx create-tap-script github/trending https://github.com/trending
```

Creates:

```
github/
├── trending.tap.json     # plan-v1 conformant starter envelope
└── trending.README.md    # next-steps notes
```

## Why

The friction model that won Stagehand 745K weekly downloads is "one command, ready to go." `npx create-tap-script` mirrors that for Tap. Stop hand-writing W3C Annotation envelopes — start with a working stub.

## Usage

```bash
npx create-tap-script <site>/<name> <url> [options]
```

| Option | Default | Notes |
|---|---|---|
| `--intent read\|write` | `read` | Declares whether the plan has side effects |
| `--out DIR` | cwd | Output directory |
| `--force` | off | Overwrite existing files |
| `--help` | — | Show usage |

## What you get

```jsonc
{
  "@context": ["http://www.w3.org/ns/anno.jsonld", "https://taprun.dev/ns/tap-v1"],
  "type": "Annotation",
  "motivation": "tap:executing",
  "target": "https://github.com/trending",
  "body": {
    "type": "tap:ExecutionPlan",
    "site": "github",
    "name": "trending",
    "intent": "read",
    "description": "Starter plan scaffolded by create-tap-script. Customize body.ops.",
    "ops": [
      { "op": "nav", "url": "https://github.com/trending" }
    ]
  },
  "generator": { ... },
  "created": "2026-04-27T..."
}
```

The output passes `runConformance` from `@taprun/spec` out of the box. Add more ops (`extract`, `fetch`, `input`, etc.) — see [the plan-v1 reference](https://taprun.dev/spec/plan-v1/).

## Have an existing script?

Use one of the dedicated adapters instead:
- [`@taprun/from-playwright`](https://jsr.io/@taprun/from-playwright) — convert Playwright `.ts/.js`
- [`@taprun/from-puppeteer`](https://jsr.io/@taprun/from-puppeteer) — convert Puppeteer `.ts/.js`
- [`@taprun/from-stagehand`](https://jsr.io/@taprun/from-stagehand) — convert Stagehand `.ts/.js`

## Part of the Tap ecosystem

[Tap](https://taprun.dev?utm_source=jsr&utm_medium=readme&utm_campaign=create-tap-script) is local-first browser automation — compile your scraper once, run it in your own browser forever, and diff the drift when sites change.

- Format spec: [`@taprun/spec`](https://jsr.io/@taprun/spec) — W3C-compliant validator for `.tap.json`
- Run locally: [Tap Chrome extension](https://taprun.dev?utm_source=jsr&utm_medium=readme&utm_campaign=create-tap-script) — credentials never leave your machine
- Compare to Stagehand / Browserbase: <https://taprun.dev/compare/stagehand/?utm_source=jsr&utm_medium=readme&utm_campaign=create-tap-script>
- Source: <https://github.com/LeonTing1010/tap> · npm: <https://www.npmjs.com/~taprun>

## License

MIT.
