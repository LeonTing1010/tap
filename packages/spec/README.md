# @taprun/spec

> Tap v2 plan format — public TypeScript types for `.tap.json` plans.

```bash
npm install @taprun/spec
```

Use this package to type-narrow or construct Tap v2 plans without
depending on the proprietary [Tap CLI](https://taprun.dev). It's the
public contract third-party tools build against.

## v1.0 — schema break vs v0.x

This is the v2 schema. v0.x targeted the legacy plan format (W3C
Annotation envelope, 24-op union, op:exec body). v2 ships:

- **11-op closed union** (was 24 ops) — `fetch`, `nav`, `wait`, `input`,
  `extract`, `cookies`, `tap`, `if`, `foreach`, `parallel`, `eval`.
- **Plan discriminated union** — read variant vs write variant
  (act + key required at the type level when act is non-empty).
- **State-machine enums** — `Verdict` (4 arms) and `IntentState` (5 arms).
- **CEL expressions** — `CelExpr` replaces JSONata for predicates.

Migrate via the `tap migrate scan` CLI. Lockfiles on `^0.4.x`
continue to resolve; new installs get v1.0.

Full design: [ADR 2026-05-04-ecosystem-v2-launch](https://github.com/LeonTing1010/tap/blob/main/docs/adr/2026-05-04-ecosystem-v2-launch.md).

## What's in scope (PUBLIC)

- `Plan`, `ArgSpec`, `TapId`
- `Op` (11-arm closed union) + every member interface
  (`FetchOp`, `NavOp`, `WaitOp`, `InputOp`, `ExtractOp`, `CookiesOp`,
  `TapOp`, `IfOp`, `ForeachOp`, `ParallelOp`, `EvalOp`)
- `OP_NAMES_V2`, `OpName`
- `Verdict`, `VERDICT_VALUES` — doctor outcome enum
- `IntentState`, `INTENT_STATES` — write-tap state machine
- `CelExpr`, `Json` — primitive aliases
- `LintError`, `LintRuleName`, `LINT_RULE_NAMES` — consumer-side typing

## Usage

```ts
import type { Plan, Op, Verdict } from "@taprun/spec";
import { OP_NAMES_V2 } from "@taprun/spec";

const plan: Plan = {
  id: { site: "example", name: "list" },
  observe: [{ op: "fetch", url: "https://api.example.com/items", save: "rows" }],
  return: "$rows",
};
```

## What's NOT in scope

- `forge` (compile URLs / NL into plans)
- `doctor` (semantic cross-validation)
- `heal` (AI-driven plan repair)
- Engine-internal types: `Run`, `IntentRecord`, `Transition`,
  `Fingerprint`, `DoctorOutcome`, `Substrate`, `OpContext`

Those live in the proprietary [Tap CLI](https://taprun.dev). Drift
between this package and the upstream is enforced by an architecture
test in tap-core that runs in CI before every release.

## Versioning

`v1.x` is the stable v2 schema. Field additions allowed in `v1.x`
(default-`undefined` preserves older plans). Op-union additions or
field semantic changes require a major bump.

## License

MIT.
