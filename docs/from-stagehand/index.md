---
title: "@taprun/from-stagehand — deprecated"
description: "from-stagehand is deprecated as of v2. Stagehand requires Browserbase (cloud-coupled), which contradicts v2's local-first stance. Use @taprun/from-playwright instead."
permalink: /from-stagehand/
layout: default
robots: noindex
---

# @taprun/from-stagehand — deprecated

> The `@taprun/from-stagehand` adapter is **deprecated as of the v2 release** (2026-05-04). No `v1.0` will be published. The `v0.x` line stays installable forever; existing lockfiles continue to resolve. This page exists for users following old links.

## Why

Stagehand requires Browserbase to run — its `act()` / `extract()` / `observe()` primitives are bound to a cloud-hosted browser. Tap v2 is **local-first by architecture** (see the parent [unified-tap-primitive ADR](/adrs/) §1.1): cookies and credentials never leave the user's machine. Rewriting `from-stagehand` to emit v2 Plans would force the Tap substrate interface to grow a cloud implementation alongside the local one, dragging the cloud-coupling problem into the engine. We drew the line at the adapter boundary instead.

The decision is documented in [`2026-05-04-ecosystem-v2-launch.md`](/adrs/) §6.2.

## What to do instead

Stagehand wraps Playwright. The deterministic page-level calls inside your Stagehand script (`page.goto`, `.click`, `.fill`, `.waitForSelector`) are exactly what [`@taprun/from-playwright`](/from-playwright/) understands. Capture the same flow against your own local Chromium:

```bash
npm install @taprun/from-playwright@^1 @taprun/spec@^1
npx from-playwright path/to/your/stagehand-script.ts > out.plan.json
```

For the natural-language `stagehand.act()` / `.extract()` parts, the recommended path is to re-capture against the live page using `tap capture <url> <site>/<name> --intent "..."` — most sites that work via NL also expose JSON-LD or a public API, so the AI compile usually finds a deterministic source. See the [Migration guide](/migration-guide/).

## Existing v0.x consumers

`v0.x` is not unpublished. If you have a lockfile pinned to a `0.x` version of `@taprun/from-stagehand`, nothing changes; the package keeps resolving from npm. The only difference is the `npm deprecate` notice that points back here.

## Rather buy the outcome than maintain the tool?

If a Stagehand/Browserbase flow you rely on keeps breaking (or the cloud
egress bill stings), we'll set up the local-first Tap automation on your own
machine and keep it working when the site changes — flat monthly, cancel
anytime. [See done-for-you →](/done-for-you/)

## Related

- [Migration guide](/migration-guide/) — full v1 → v2 walkthrough
- [`@taprun/from-playwright`](/from-playwright/) — the recommended replacement
- [ADR: ecosystem v2 launch](/adrs/) — §6.2 Stagehand deprecation rationale
