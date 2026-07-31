# Tap public packages

Five npm packages that together form the Tap distribution flywheel. All
MIT, published to npm under `@taprun/*`.

| Package | Version | What it is |
|---|---|---|
| [`@taprun/spec`](./spec) | `1.6.0` | **Public protocol surface.** TypeScript types for the v2 Plan format (13-op closed union + discriminated read/write Plan union), JSON Schema 2020-12 with `$id` resolvable at `taprun.dev/spec/plan-v1/schema.json`, lint rule names, namespace vocabulary terms. No runtime engine — pure type + schema package. Source-of-truth for third-party tooling. |
| [`@taprun/from-playwright`](./from-playwright) | `1.0.0` | Convert Playwright `.ts/.js` source → v2 `.flow.json` (bare Plan, no envelope). Deterministic mapping of `page.goto/click/fill/waitFor/...` → `op:nav/input/wait/...`; falls back to `op:eval` for unsupported calls (with `returns.type` declaration). |
| [`@taprun/from-puppeteer`](./from-puppeteer) | `1.0.0` | Convert Puppeteer `.ts/.js` source → v2 `.flow.json`. Mirrors from-playwright with Puppeteer-specific API tweaks. |
| [`@taprun/from-stagehand`](./from-stagehand) | `1.0.0` | Convert Stagehand `.ts/.js` source → v2 `.flow.json`. Deterministic Playwright calls map to plan ops; NL `stagehand.act/extract/observe` fall through to `op:eval`. |
| [`create-tap-script`](./create-tap-script) | `1.0.1` | `npx create-tap-script <site>/<name> <url>` — one-command scaffolder for a starter `.flow.json` in v2 shape. |

## How they relate

```
@taprun/spec ◄─── peer dep of all adapters; build-time dep of tap-core
       ▲              ▲
       │              │
       │     ┌────────┼────────┐
       │     │        │        │
   from-playwright  from-puppeteer  from-stagehand
       │     │        │        │
       └─────┴────────┴────────┘
                │
            emit v2 .flow.json
                │
                ▼
       create-tap-script scaffolds starters of the same shape
                │
                ▼
       Tap CLI (proprietary, @taprun/cli) consumes via
       `tap capture / verify / mark / run`
       and exposes the @taprun/spec JSON Schema as the
       MCP resource `tap://schema/plan-v1`
```

`@taprun/spec` is the format substrate — every adapter's output validates against `schemas/plan-v1.schema.json`, every consumer (including the proprietary Tap CLI) typechecks against spec types. A bidirectional drift-guard test (`packages/spec/test/schema-drift.test.mjs`) keeps the JSON Schema in lockstep with `src/types.ts`, and the upstream tap-core repo's `src/test/spec_public_subset_test.ts` keeps the TS types a strict subset of the proprietary `core/types.ts`.

## @taprun/spec — what's in scope, what's not

**PUBLIC** (exported, MIT, version-stable):
- `Plan` (discriminated read/write union), `ArgSpec`, `TapId`, `CelExpr`
- `Op` (13-arm closed union) + every member interface (`FetchOp`, `NavOp`, `WaitOp`, `InputOp`, `ExtractOp`, `CookiesOp`, `TapOp`, `IfOp`, `ForeachOp`, `ParallelOp`, `EvalOp`, `TabOp`, `BookmarkOp`)
- `OP_NAMES_V2`, `OpName` (runtime introspection)
- `INTENT_STATES`, `VERDICT_VALUES` (state-machine enums)
- `LintError`, `LintRuleName`, `LINT_RULE_NAMES` (consumer-side typing for lint surfaces)
- `TAP_V1_NS_TERMS` + namespace IRI constants (JSON-LD validators)
- `schemas/plan-v1.schema.json` (subpath import: `@taprun/spec/schema`)

**NOT in scope** (proprietary engine — never published):
- `forge` (URL × intent → Plan compilation)
- `verify` / `doctor` (op-outcome-derived substrate health)
- `heal` (drift-triggered re-capture)
- `Run`, `IntentRecord`, `Transition`, `Fingerprint`, `DoctorOutcome`
- `Substrate`, `OpContext` (runtime dispatch types)

The split keeps third-party integrators able to construct, validate, display, and statically analyze plans **without** depending on the proprietary Tap engine. Governance layers, alternative runtimes, MCP hosts with plan-aware permission scoping, IDE plugins, and cross-language validators (Python ajv-equivalent, Ruby `json-schema`, Go `jsonschema`) all build against the spec package + the canonical `$id` URL.

## Workspace layout

This repo uses npm workspaces. From `public/` root:

```bash
npm install                       # install + symlink workspaces
npm run build                     # build all (tsc per package)
npm test                          # run all (node --test per package)
npm run docs:sync-schema          # mirror packages/spec/schemas/plan-v1.schema.json
                                  # → docs/spec/{plan-v1.schema.json,plan-v1/schema.json}
npm run docs:check-schema-sync    # CI gate: assert both mirrors byte-match the source
```

Per-package commands still work from each package directory:

```bash
cd packages/spec
npm run build                     # tsc → dist/
npm test                          # node --test test/*.test.mjs (drift-guard)
```

Local development uses workspace symlinks (`node_modules/@taprun/spec` → `../../packages/spec`) so `import` resolves to local source. Published `package.json` files declare actual semver constraints — when consumers `npm install`, npm fetches from the registry.

## Format reference

- Plan-v1 spec doc: <https://taprun.dev/spec/plan-v1/>
- JSON Schema (canonical, matches `$id`): <https://taprun.dev/spec/plan-v1/schema.json>
- JSON Schema (flat, back-compat): <https://taprun.dev/spec/plan-v1.schema.json>
- Vocabulary IRI: <https://taprun.dev/ns/tap-v1/>
- Schema is also shipped inside `@taprun/spec` at `schemas/plan-v1.schema.json` (subpath import `@taprun/spec/schema`)

## License

Each package is MIT (see individual `LICENSE` / `README.md`). The proprietary Tap CLI that consumes these packages is closed-source — see [taprun.dev](https://taprun.dev).
