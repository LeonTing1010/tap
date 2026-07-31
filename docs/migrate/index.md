---
title: "migrate — v1 → v2 corpus migration"
description: "tap migrate is the one-shot CLI that scans a v1 W3C-envelope corpus and promotes auto-migratable plans into the v2 bare-Plan format."
permalink: /migrate/
layout: default
---

# migrate

> Stable identifier for the **migrate** module. Migrate is a one-shot Capture-plane utility (one of Tap's three primitive planes: [Capture](/capture/) / [Replay](/replay/) / [Verify](/verify/)) that lifts v1 W3C-envelope plans into the v2 bare `Plan` format. It exists only during the v1→v2 deprecation window and deletes when the window closes.

## What this CLI does

`tap migrate` is the bulk migration entry point. Two verbs:

- `scan` — read-only inventory. Walks `~/.tap/taps/` and classifies each `.tap.json` into **auto-migratable** (W3C envelope wrapping a body that already happens to use only v2 ops + no deleted fields), **needs-rewrite** (uses `op:exec`, `op:pipe`, `op:parseXML`, `legacy:true`, `allowUnverifiable`, etc.), or **corrupt**.
- `migrate` — applies the conversion. For each auto-migratable plan: strips the W3C wrapper, drops deleted top-level fields, synthesises `id: { site, name }`, treats `ops` as `observe` for read taps, runs `lintPlan`, and writes to `~/.tap/flows/<site>/<name>.flow.json`. Originals stay untouched in `~/.tap/taps/`.

```bash
tap migrate scan                       # all sites, dry inventory
tap migrate scan --site github         # one site
tap migrate migrate --dry-run          # preview the apply
tap migrate migrate                    # apply
```

The migration tool dogfooded itself against the 72-tap [tap-skills](https://github.com/LeonTing1010/tap-skills) corpus before this docs site shipped.

## Coverage expectation

Be realistic: most v0.x plans were compiled with a universal `op:exec` body (the v1 catch-all escape hatch). Auto-migration coverage on real legacy corpora is therefore close to 0% — not because `migrate` is incomplete but because v1 leaned on free-form JS. Most plans land in the **needs-rewrite** bucket, which calls for a fresh `tap capture <url> <site>/<name> --intent "..."` against the original target rather than a hand port.

## Where it ships

`migrate` is part of the proprietary Tap CLI (closed engine). It is a one-shot administrative tool with a known retirement date — when the v1 deprecation window closes (Day +180), the entire module deletes from the source tree.

- Install Tap: <https://taprun.dev>
- Format types: <https://www.npmjs.com/package/@taprun/spec>

## Output shape

A migrated read tap looks like this:

```json
{
  "id": { "site": "github", "name": "trending" },
  "observe": [
    { "op": "fetch", "url": "https://api.github.com/search/repositories?q=stars:>1000", "format": "json", "save": "raw" }
  ],
  "return": "$.raw.items"
}
```

No `@context`, no `body`, no `motivation`, no `generator` field. The bare `Plan` is the canonical v2 shape; everything else is a derived projection.

## Related

- [Migration guide](/migration-guide/) — full v1 → v2 walkthrough including the npm package upgrade
- [Plan format](/spec/plan-v1/) — bare `Plan` reference
- [forge](/forge/) — for plans that don't auto-migrate, re-capture from the source
- [verify](/doctor/) — verify a migrated plan still produces the expected snapshot
