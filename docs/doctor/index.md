---
title: "doctor — drift detection with per-tap CEL"
description: "doctor emits one of four verdicts (equivalent · drifted · baseline-set · unreachable) using a per-tap CEL fingerprint_equivalent predicate. You declare what counts as drift; doctor never guesses."
permalink: /doctor/
layout: default
---

# doctor

> Stable identifier (`SoftwareAgent.id`) for the **doctor** agent. Doctor is the headline tool of the **Verify** plane — one of Tap's three primitive planes (Capture / Replay / Verify). Drift-detection records carry `compiled_by` metadata so consumers can dereference the producer.

## What this agent does

`tap-v2 doctor <site>/<name>` runs the plan's `observe` phase, hashes the substrate state into a `Fingerprint`, and compares against the prior fingerprint stored on disk. The comparison is governed by **a per-tap CEL `fingerprint_equivalent` predicate** that you author — doctor does not hard-code "what counts as the same answer."

The verdict is one of four:

| Verdict | Meaning |
|---|---|
| `equivalent` | Predicate returned true: today's fingerprint matches the baseline |
| `drifted` | Predicate returned false: substrate state changed in a way the predicate cares about |
| `baseline-set` | First run on this tap; baseline established, no comparison possible |
| `unreachable` | Substrate could not produce a fingerprint (network error, page gone, runtime mismatch) |

Compared with the v1 6-arm verdict (`healthy` / `broken` / `stale` / `layer-mismatch` / `unreachable` / `unverified`), the v2 enum is smaller because the per-tap predicate absorbs the layer-mismatch and stale arms — those distinctions are now your call to make in CEL, not the engine's call to make for you. PoC measurement on the first 20 community taps that adopted the predicate: **40% false-positive reduction**.

## Where it ships

`doctor` is part of the proprietary Tap CLI (closed engine). The verdict enum and `DoctorOutcome` shape are public types in [`@taprun/spec`](https://www.npmjs.com/package/@taprun/spec) so third-party tooling (CI dashboards, fleet UIs) can consume the output without depending on the engine.

- Install Tap: <https://taprun.dev>
- Format types: <https://www.npmjs.com/package/@taprun/spec>

## Per-tap CEL predicate

A read tap that fetches GitHub trending might declare:

```json
{
  "id": { "site": "github", "name": "trending" },
  "observe": [
    {
      "op": "fetch",
      "url": "https://api.github.com/search/repositories?q=stars:>1000",
      "format": "json",
      "save": "raw"
    }
  ],
  "fingerprint_equivalent": "size($.raw.items) >= 25 && all($.raw.items, item, has(item.full_name))",
  "return": "$.raw.items"
}
```

The predicate says: doctor reports `equivalent` as long as the fetch returned at least 25 items and every item has a `full_name`. Adding a new field to GitHub's API response, reordering items, or trivial value churn does not flip the verdict. Losing the `full_name` field — the only thing the tap actually uses downstream — does.

When `fingerprint_equivalent` is omitted, doctor falls back to a structural diff over the raw substrate state. That fallback is the engine's best guess and will produce the v1-style false-positive rate; declaring the predicate is the recommended path.

## Sample DoctorOutcome

```json
{
  "verdict": "drifted",
  "fingerprint": {
    "plan_site": "github",
    "plan_name": "trending",
    "observed_at": "2026-05-04T14:32:00Z",
    "source": "doctor",
    "substrate_state": { "items": [/* 18 entries */] }
  },
  "prior": {
    "plan_site": "github",
    "plan_name": "trending",
    "observed_at": "2026-04-30T09:15:00Z",
    "source": "doctor",
    "substrate_state": { "items": [/* 25 entries */] }
  },
  "reason": "fingerprint_equivalent returned false: size($.raw.items) >= 25 evaluated to false (got 18)"
}
```

`DoctorOutcome` is a public type — third-party CI dashboards parse it directly.

## Related

- [Plan format](/spec/plan-v1/) — `Plan.fingerprint_equivalent` field
- [Migration guide](/migration-guide/) — verdict enum changes from v1
- [ADR-driven design](/adrs/) — full rationale for the verdict collapse
