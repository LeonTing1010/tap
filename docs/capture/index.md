---
title: "Capture — Tap's first plane"
description: "Capture is one of Tap's three primitive planes (Capture / Replay / Verify). Inputs: URL, trajectory, or intent. Output: a deterministic .tap.json plan. Includes forge, Tier 0/1/2/3 source ranking, the trajectory compiler, and the from-* adapters."
permalink: /capture/
layout: default
---

# Capture

> **One of Tap's three primitive planes.** Capture turns *URLs, trajectories, or intents* into deterministic `.tap.json` plans. The plan is the immutable artifact every other plane works on.

## What Capture is for

Capture solves R1 (every conversion loses information) and A2 (LLMs are probabilistic). The plane's job is to *record once, faithfully*, so Replay never has to re-derive and Verify has a stable artifact to check.

## What lives in Capture

| Tool | Source IRI | Input | Output |
|---|---|---|---|
| [`tap forge <url>`](/forge/) | `https://taprun.dev/forge` | live page | structurally-ranked plan |
| [`@taprun/from-playwright`](/from-playwright/) | `https://taprun.dev/from-playwright` | Playwright `.ts/.js` | plan-v1 envelope |
| [`@taprun/from-puppeteer`](/from-puppeteer/) | `https://taprun.dev/from-puppeteer` | Puppeteer `.ts/.js` | plan-v1 envelope |
| [`@taprun/from-stagehand`](/from-stagehand/) | `https://taprun.dev/from-stagehand` | Stagehand `.ts/.js` | hybrid plan |
| [`create-tap-script`](/create-tap-script/) | `https://taprun.dev/create-tap-script` | site/name + URL | starter plan |
| trajectory compiler | (internal) | `browser-use` AgentHistoryList | plan |

## Why Tier 0 lives in Capture

Capture ranks four source layers in descending trust:

1. **Layer 1 — JSON-LD / schema.org / Annotation / RDFa** (canonical, machine-emitted by the site)
2. **Layer 2 — API JSON** (the network response the page itself fetches)
3. **Layer 3 — Semantic HTML** (`<article>`, `<h1>`, `<address>` + ARIA roles)
4. **Layer 4 — CSS / structural classes** (last resort)

When a Layer 1 or Layer 2 source carries the answer, Capture emits a deterministic plan with **zero LLM tokens spent on code generation**. This is "Tier 0" — the optimization pass that skips codegen when source allows. The 12-fact derivation is in [ADR 2026-04-26 — Three-Plane Refactor](https://github.com/LeonTing1010/tap/blob/main/core/docs/adr/2026-04-26-three-plane-refactor.md) (in core).

## Cross-plane composition

- **Heal** = `Verify ∘ Capture` — drift report from Verify becomes input to a new Capture pass.
- **Refresh** = Capture with delta input (rebaseline from current page).

Heal and Refresh are *workflows over the three planes*, not separate primitives.

## Related

- [Replay](/replay/) — the second plane (Plan + identity → rows)
- [Verify](/verify/) — the third plane (Plan + rows → verdict)
- [`plan-v1` reference](/spec/plan-v1/) — the format Capture produces
- [`tap-v1` namespace](/ns/tap-v1/) — the JSON-LD vocabulary
