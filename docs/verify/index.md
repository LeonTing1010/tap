---
title: "Verify — Tap's third plane"
description: "Verify is one of Tap's three primitive planes (Capture / Replay / Verify). Inputs: a plan plus the rows it produced. Output: a verdict + drift report. Verify is what catches silent rot — when a scraper still 'works' but the data is wrong."
permalink: /verify/
layout: default
---

# Verify

> **One of Tap's three primitive planes.** Verify takes a plan and the rows it produced and answers: *is this still right?* Without Verify, Replay is just a compiler that quietly emits the wrong answer when the world changes.

## What Verify is for

Verify solves T3 (a system can't detect its own staleness) and D3 (rules evolve), and enforces eternal-principle 1 (correctness must not depend on any single entity). Replay alone is not enough — Replay only knows what its plan says, and the plan can become quietly wrong.

The framing in [ADR 2026-04-26 — Three-Plane Refactor](https://github.com/LeonTing1010/tap/blob/main/core/docs/adr/2026-04-26-three-plane-refactor.md):

> *Tap is a differential-testing-equipped compiler for stateful external systems whose outputs decay over time.*

Verify is the "differential-testing-equipped" half of that sentence.

## What lives in Verify

| Tool | Source IRI | Role |
|---|---|---|
| [`tap doctor [<site>/<name>]`](/doctor/) | `https://taprun.dev/doctor` | 4-layer cross-validation against the live page |
| `V` (verifier) | (internal) | strict pass/fail against an authoritative source (fetch-json / fetch-json-2step / fetch-atom) |
| `fingerprint` | (internal) | site-shape baseline; flags STALE state on diff |
| `heal-cache` | (internal) | site-scoped cache of `{old_fragment, new_fragment}` patches replayed at 0 LLM tokens |
| `schedule` / `watch` | (internal) | continuous monitoring; fires Verify on a cadence |

## The 4-layer cross-validation

[`tap doctor`](/doctor/) runs the plan output against four independent sources in descending trust:

1. **JSON-LD / schema.org / Annotation / RDFa** — canonical machine-emitted data
2. **API JSON** — the network response the page itself fetches
3. **Semantic HTML** — `<article>`, `<h1>`, `<address>`, ARIA roles
4. **CSS / structural classes** — last resort

When higher-trust layers disagree with the layer the plan currently uses, Verify emits a `tap:DriftReport` annotation. The drift report is itself a W3C Annotation envelope that any tool can consume.

## The lifecycle Verify owns

| State | `tap.health` | fingerprint | Verify action |
|---|---|---|---|
| HEALTHY | PASS | match | none |
| BROKEN | FAIL | any | **heal** (= `Verify ∘ Capture`) |
| STALE | PASS | diff | **refresh** (= Capture with delta input) |

Heal and refresh are *workflows over the three planes*, not separate primitives.

## Why competitors can't bolt this on

Layer 1 / Layer 2 sources have to be **captured at compile time**. Cloud-first browser SDKs (Stagehand+Browserbase, Apify, Browserless) call the LLM at runtime against whatever the page currently shows — they have no captured baseline to verify against. Information-theoretically, they can detect that the LLM-extracted output *changed*; they cannot detect that the output *became wrong*. Detail in [/compare/stagehand/](/compare/stagehand/).

## Related

- [Capture](/capture/) — the first plane (the source of the plans Verify checks)
- [Replay](/replay/) — the second plane (the executor whose output Verify validates)
- [`plan-v1` reference](/spec/plan-v1/) — the plan format Verify operates on
- [`tap-v1` namespace](/ns/tap-v1/) — including `tap:DriftReport`, `tap:layerDisagreement`, `tap:suggestions`
