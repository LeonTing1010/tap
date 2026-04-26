# @taprun/spec

> Tap plan-v1 format spec — TypeScript types + W3C Annotation validator for `.tap.json` files.

```bash
npm install @taprun/spec
```

Use this package to typecheck or validate compiled Tap plans (`.tap.json`) without running the full [Tap CLI](https://taprun.dev). It's the public contract third-party tools build against.

## What's in scope

- **`ExecutionPlan`** — the body of a `.tap.json` envelope (site, name, intent, ops, health, authoritative source).
- **`TapAnnotation`** — the W3C Web Annotation envelope wrapping an `ExecutionPlan` body.
- **`OP_NAMES` / `OpName`** — closed union of the plan ops.
- **`validateAnnotation(value)`** — zero-runtime-dep MUST-level W3C validator. Returns `{ valid, errors[], warnings[] }`.
- All op interfaces (`FetchOp`, `NavOp`, `WaitOp`, `ExtractOp`, …), `HealthContract`, `AuthoritativeSpec`, `ArgSpec`.
- **JSON Schema 2020-12** at `@taprun/spec/schema` for non-TypeScript validators (Python / Go / Rust / Ruby).

## Usage — TypeScript

```ts
import { validateAnnotation, OP_NAMES, type ExecutionPlan } from "@taprun/spec";

const plan: ExecutionPlan = JSON.parse(await fs.readFile("plan.tap.json", "utf8"));
const result = validateAnnotation(plan);
if (!result.valid) console.error(result.errors);
```

## Usage — JSON Schema (any language)

The package ships a JSON Schema 2020-12 file alongside the TS types. Any
JSON-Schema-compatible validator works:

```js
import schema from "@taprun/spec/schema" assert { type: "json" };
import Ajv from "ajv/dist/2020";
const ajv = new Ajv();
const validate = ajv.compile(schema);
const valid = validate(planJson);
```

Or fetch from the published spec URL:

```bash
curl https://taprun.dev/spec/plan-v1.schema.json
```

The schema's `$defs.OpName.enum` is drift-guarded against the TS source —
adding a plan op requires editing both, enforced by the `tap-core`
test suite.

## What's NOT in scope

- `forge` (compiling URLs / natural language into plans)
- `doctor` (semantic cross-validation of plan output against authoritative sources)
- `heal` (AI-driven plan repair)
- Authentication, license, and runtime execution

Those live in the proprietary [Tap CLI](https://taprun.dev). This package is the format substrate so anyone can write a plan emitter (e.g. `tap-from-playwright`) without coupling to the closed engine.

## Format reference

- Plan format reference: <https://taprun.dev/spec/plan-v1/>
- Vocabulary IRI (JSON-LD): <https://taprun.dev/ns/tap-v1/>

## Versioning

`v1` is the stable on-disk format.

- Field additions allowed in `v1.x` (default-`undefined` preserves older plans).
- Op-union additions require ADR + minor version bump.
- Field removal or semantic change requires major bump.

## Status

**0.0.0 — Iteration 1 stub.** The exports land in Iteration 2; this README is published with the package skeleton so downstream tooling can pin the wire identifier early.

See `core/docs/reconstruction-plan-2026-04-27-addendum-B.md` (private) for the slice plan.

## License

MIT.
