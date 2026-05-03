---
title: "Replay — Tap's second plane"
description: "Replay is one of Tap's three primitive planes (Capture / Replay / Verify). Inputs: a captured plan + your identity (cookies / API keys). Output: the rows. Replay runs at zero LLM tokens — the plan is already compiled."
permalink: /replay/
layout: default
---

# Replay

> **One of Tap's three primitive planes.** Replay takes an immutable bare v2 Plan plus your identity context and produces rows. **Zero LLM tokens** — the plan is already compiled. This is the plane that ships in every Tap install and runs forever.

## What Replay is for

Replay solves A2 (LLMs are probabilistic) by separating compile-time AI use from run-time execution: AI participates in [Capture](/capture/), never in Replay. It also solves R2 (copies drift) — the plan is a single artifact every runtime targets, so there's only one source of truth to keep in sync.

## What lives in Replay

| Component | Role |
|---|---|
| `plan-runtime` | the op-handler dispatcher (INV-P3 pure: no `new Worker`, no `new Function`, no bare `eval`, no dynamic import) |
| `plan-dispatch` | the `tapToPlanHandle` adapter + the bounded `exec` op bridge |
| `plan-lint` | static lint at save / capture / resolvePlan time |
| Op handlers | one per op-name; the closed [11-op v2 union](/spec/plan-v1/) (7 substrate · 3 control flow · 1 typed-eval) |

## The closed-op invariant

Replay can only execute ops in the closed `OP_NAMES_V2` set defined by [`@taprun/spec`](https://www.npmjs.com/package/@taprun/spec) v1.0+. Adding an op requires:

1. The semantics aren't expressible via fewer existing ops, or composition is unsafe.
2. The op traces to one of five source-domain primitives (read DOM · call API · wait · interact · extract structured data).
3. An ADR amendment to the parent v2 schema decision (`2026-05-03-unified-tap-primitive`).

This keeps Replay's surface stable and re-implementable across runtimes (Chrome extension / Playwright / macOS).

## Three runtimes, one plane

Replay is the runtime-neutral substrate. Concrete runtimes implement the op handlers:

| Runtime | Where | Default for |
|---|---|---|
| Chrome extension | the user's logged-in browser | MCP tools, write actions |
| Playwright | local headless / headed Chromium | `--runtime playwright` |
| macOS | AX API + JXA + CGEvent | `--runtime macos` |

All three replay the same `.tap.json` against the same op semantics. Identity (cookies / API keys / OS-level auth) flows through the **identity cross-cut**, never embedded in the plan.

## Cross-plane composition

- **Replay** is the only plane safe to invoke automatically on every cron / refresh / fleet sweep — it has no side effects beyond the ones the plan declares (read variant has only `observe`; write variant declares `act`+`confirm`).
- **Heal** and **Refresh** workflows route around a Replay step that returned drift signals, but never modify Replay itself.

## Related

- [Capture](/capture/) — the first plane (URL → plan)
- [Verify](/verify/) — the third plane (plan + rows → verdict)
- [`plan-v1` reference](/spec/plan-v1/) — the format Replay executes
- [Local-first by architecture](/local-first/) — why Replay runs in your browser, not someone else's cloud
