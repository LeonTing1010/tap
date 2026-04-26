# Tap public packages

Five npm packages that together form the Tap distribution flywheel:

| Package | Version | What it is |
|---|---|---|
| [`@taprun/spec`](./spec) | `0.3.0` | TypeScript types + W3C Annotation MUST-validator + JSON Schema 2020-12 + 10-fixture conformance suite. Source-of-truth for the `.tap.json` plan-v1 format. |
| [`@taprun/from-playwright`](./from-playwright) | `0.1.0` | Convert Playwright `.ts/.js` source → `.tap.json` envelopes. Maps 8 page.* APIs deterministically. |
| [`@taprun/from-puppeteer`](./from-puppeteer) | `0.1.0` | Convert Puppeteer `.ts/.js` source → `.tap.json`. Mirrors from-playwright with Puppeteer-specific tweaks. |
| [`@taprun/from-stagehand`](./from-stagehand) | `0.1.0` | Convert Stagehand `.ts/.js` source → `.tap.json`. Hybrid: deterministic Playwright calls map to plan ops; NL `stagehand.act/extract/observe` → `allowUnverifiable: true` exec ops. |
| [`create-tap-script`](./create-tap-script) | `0.1.0` | `npx create-tap-script <site>/<name> <url>` — one-command scaffolder for a starter `.tap.json`. |

## How they relate

```
@taprun/spec ◄─── peer dep of all adapters
       ▲              ▲
       │              │
       │     ┌────────┼────────┐
       │     │        │        │
   from-playwright  from-puppeteer  from-stagehand
       │     │        │        │
       │     │        │        │
       └─────┴────────┴────────┘
                │
            outputs .tap.json
                │
                ▼
       create-tap-script scaffolds starters of the same shape
                │
                ▼
       Tap CLI (proprietary) consumes via `tap run / doctor / heal`
```

`@taprun/spec` is the format substrate — every adapter emits envelopes that pass `runConformance` from spec, every consumer (including the proprietary Tap CLI) typechecks against spec types.

## Workspace layout

This repo uses npm workspaces. From the public/ root:

```bash
npm install                 # install + symlink workspaces
npm run build               # build all (tsc per package)
npm test                    # run all (node --test per package)
```

Per-package commands still work from the package directory:

```bash
cd packages/from-playwright
npm run build
npm test
```

Local development uses workspace symlinks (`node_modules/@taprun/spec` → `../../packages/spec`) so `import` resolves to local source. Published `package.json` files use the `^0.3.0` constraint — when consumers `npm install`, npm fetches from the registry.

## Format reference

- Plan-v1 spec doc: <https://taprun.dev/spec/plan-v1/>
- Vocabulary IRI: <https://taprun.dev/ns/tap-v1/>
- JSON Schema: <https://taprun.dev/spec/plan-v1.schema.json> (also shipped at `@taprun/spec/schema`)

## License

Each package is MIT (see individual `LICENSE` / `README.md`). The proprietary Tap CLI that consumes these packages is closed-source — see [taprun.dev](https://taprun.dev).
