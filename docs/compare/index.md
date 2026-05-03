---
title: "Where Tap fits among adjacent tools"
description: "How Tap composes with browser-use, Stagehand, Browserbase, Libretto, and Replay MCP. Architecture diagram + per-project section showing where each lives in the stack and where Tap's compile-once layer fits."
permalink: /compare/
---

# Where Tap fits among adjacent tools

**Format choice**: per Leo's W1-end suggestion, replace 5-column table with **one architecture diagram + per-project section**. The diagram does the heavy lifting; rows are honest detail.

---

## Page outline (as it would render)

### Hero (above fold)

> **Compile once. Run forever. Diff the drift.**
>
> Five tools that touch the same problem from different angles. Here's where each lives, where they overlap, and where they compose.

(Existing taprun.dev hero copy. Keep verbatim — already user-voice anchored per `tap_evidence_positioning_2026-04-21.md`.)

### Architecture diagram (single image, ~600px wide)

ASCII sketch of what the rendered SVG should show:

```
                  AGENT  (Claude Code · Cursor · LangChain · browser-use)
                            │
                            ▼
           ┌────────────────────────────────────┐
           │           PROGRAM FORMAT           │   ← Tap lives here
           │   bare Plan (11-op closed union)   │
           └─────┬─────────┬─────────┬──────────┘
                 │         │         │
                 ▼         ▼         ▼
           ┌─────────┐ ┌─────────┐ ┌─────────┐
           │ Adapter │ │ Adapter │ │ Adapter │   ← html / rss / jsonld /
           │  html   │ │   rss   │ │ jsonld  │      mcp / openapi (A1+)
           └─────┬───┘ └─────────┘ └─────────┘
                 │
                 ▼
        ┌────────────────────────────────┐
        │           RUNTIME              │     ← extension / playwright
        │  Chrome ext · Playwright · AX  │        / macos
        └──────────┬─────────────────────┘
                   │
                   ▼
              ╔══════════╗
              ║ Real web ║
              ╚══════════╝
```

Five competitor "blast zones" overlaid on this diagram (in caption / interactive form):

- **browser-use** = AGENT layer (LLM-at-runtime, no compile step)
- **Libretto** = compiles to PROGRAM FORMAT, but format = arbitrary Playwright JS (not closed union)
- **Browserbase / Steel** = RUNTIME layer (hosted Chrome / sessions / anti-bot)
- **Playwright** = RUNTIME layer + bring-your-own program (humans hand-write the program)
- **Tap** = PROGRAM FORMAT + ADAPTER + RUNTIME selector (only project that owns all three layers + open the format spec)

### Per-project rows (5 sections)

Each section reuses the ⟨Their layer · Tap layer · Where they don't overlap · Where they compose⟩ blocks from `core/docs/positioning-matrix.md`. Trimmed to ~80 words each. Includes the "honest weakness" sentence — non-negotiable.

#### vs Libretto

> Libretto and Tap both compile-once with LLMs. Libretto emits Playwright JS; Tap emits a closed 11-op bare Plan that doctor statically verifies against Layer 1 sources.
>
> *Where they don't overlap*: Libretto's output is unbounded JS; Tap's output is a closed-union JSON document `doctor` can statically verify. *Where they compose*: Libretto's compile step could emit `.tap.json` instead of Playwright scripts — same compile-once frame, narrower output, free static verifiability.
>
> *Honest weakness*: Libretto has 100× the GitHub stars. Tap's 4-layer priority is structurally better but is unknown vocabulary outside Tap. Pick Libretto if your team already lives in Playwright.

#### vs Browserbase + Stagehand

> [Deep comparison →](/compare/stagehand/) — full architectural breakdown, where each wins, when they compose.
>
> Browserbase hosts the browser; Tap defines the program. A `.tap.json` plan can run on Browserbase the same way it runs on local Chrome — the plan is the substrate.
>
> *Where they don't overlap*: Browserbase's value is infra (hosted execution, replay, sessions); Tap's value is the program format (compile-once `.tap.json` + doctor + heal). *Where they compose*: Tap's `--runtime playwright` runs against any Playwright endpoint, including Browserbase-hosted browsers. Browserbase becomes a deployment target.
>
> *Honest weakness*: Browserbase has $20M+ funding, hosted control plane, and replay tooling Tap doesn't ship. Tap doesn't compete on infrastructure.

#### vs browser-use

> browser-use runs an LLM at every step; Tap runs an LLM once at compile time and never again. Inside a browser-use agent, `tap.run` is the no-think sub-routine layer.
>
> *Where they don't overlap*: browser-use solves "what should the agent do given the current page"; Tap solves "what is the deterministic program for this declared task". *Where they compose*: a browser-use agent that needs deterministic sub-tasks (paginated extraction, scrape, periodic check) calls `tap.run` instead of re-deciding at runtime.
>
> *Honest weakness*: browser-use handles novel pages with no prior compile step. For one-shot tasks, browser-use is faster to first execution.

#### vs Steel.dev

> Steel keeps the session alive; Tap keeps the program correct. Both solve different halves of "agents that don't break in production."
>
> *Where they don't overlap*: Steel solves session reliability and anti-bot; Tap solves selector/extraction stability over time (drift, heal). *Where they compose*: Tap's read-variant Plans running against Steel-hosted browsers gets Tap's compile-once + Steel's anti-detection.
>
> *Honest weakness*: Steel has YC backing and infrastructure depth Tap doesn't replicate. Tap is the program; Steel is one possible runtime target.

#### vs Playwright

> Playwright is the runtime; Tap is the program. Tap programs run on Playwright, but they're authored by `forge` and healed by `doctor` — not hand-edited.
>
> *Where they don't overlap*: Playwright requires a human author writing selectors; Tap auto-compiles selectors at forge time and heals them on drift. *Where they compose*: existing Playwright codebases can adopt Tap incrementally — keep imperative tests, add Tap for the brittle scrape/extract paths.
>
> *Honest weakness*: Playwright has 70k+ stars and is in production at thousands of companies. Tap is a compile-and-heal layer above Playwright, not a replacement.

### Benchmark teaser (link, not embed)

One paragraph + chart preview pointing to `taprun.dev/benchmark/` (W3 deliverable, not yet shipped):

> **Concrete number**: on a synthetic HN class-rename drift, a Claude Code sub-agent spends 45,064 tokens to recover the broken extractor. Tap heals the same drift in 1,134 tokens (sonnet) — and 0 tokens on cache replay. [See full benchmark →]

Don't embed the full chart here — keep this page focused on positioning. Benchmark page has the data.

### Footer

> Tap is closed-source / proprietary; the 11-op bare Plan format is open and documented at [taprun.dev/spec/plan-v1/](https://taprun.dev/spec/plan-v1/). The v1 W3C Annotation vocabulary at [/ns/tap-v1/](https://taprun.dev/ns/tap-v1/) is preserved as a historical archive.
>
> Found an error in this page? [Open an issue](https://github.com/LeonTing1010/tap/issues).

(Per CLAUDE.md content rules: never call Tap "open-source"; phrasing here uses "closed-source / proprietary" with "the format is open" as the contrast — accurate per the source/license matrix.)

---

## Implementation plan for actual page

This draft is markdown for review. Render path when published:

1. **Location**: `public/compare/index.html` in `LeonTing1010/tap` repo (MIT public, GH Pages → taprun.dev)
2. **Template**: copy structure from existing `public/blog/` post template; reuse the Bricolage Grotesque + Fraunces font stack from `taprun.dev/ns/tap-v1/`
3. **Architecture diagram**: SVG hand-written, not generated. Single-file, no JS dependencies. ~600px max width.
4. **SEO meta**:
   - `<title>Tap vs Libretto vs Browserbase vs Steel vs Playwright — compile-time browser automation</title>`
   - `<meta description>` covers all 5 projects + comparison frame in 155 chars
   - Schema.org `ComparisonTable` JSON-LD for structured-data crawlers
5. **UTM tagging on outbound links** — internal `/blog/` and `/ns/` links untagged; competitor homepage links tagged `utm_source=taprun-compare`
6. **GA4 event**: `compare_page_view` on load + `compare_section_visible` on scroll into each per-project block (helps decide which competitor's section drives most attention)

## Non-implementation considerations

- **Risk: competitor backlash**. Honest comparisons get shared, but a competitor reading their own "honest weakness" sentence may dispute. Mitigation: every weakness sentence cites a verifiable fact (star count, funding, feature name). No subjective claims.
- **Risk: looking small/needy**. A small project publishing comparisons against bigger projects can read as desperate. Mitigation: lead with architecture diagram (assertion of equal-scope discussion), not feature checklist.
- **Updating cadence**: competitive landscape moves; commit to quarterly review. Add `<!-- last-reviewed: YYYY-MM-DD -->` HTML comment.

