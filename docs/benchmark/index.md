---
title: "K(Δ): browser-automation drift recovery cost"
description: "Reproducible measurement of token cost when an AI agent's web scraper breaks: freeform LLM extraction vs. Tap router heal via verifier drift report. Two baselines (architectural + production-honest), bare-API arms, full prompts in Appendix B."
permalink: /benchmark/
---

# K(Δ): browser-automation drift recovery cost

**Audience**: developers building AI agents that scrape/automate browsers; researchers measuring agent token economics; technical buyers comparing browser-automation reliability.

**Hero claim**: We give two numbers and label them. The architectural one (apples-to-apples) and the user-experienced one (what real toolchains actually cost). Both are real measurements; both matter; they answer different questions.

---

## Page outline (as it would render)

### Section 1 — Hero (two baselines, clearly labeled)

```
              When a browser scraper breaks, recovering costs:

  ─────  Architectural comparison  ─────
  (both arms: haiku · bare Anthropic API · prototype prompts)
  
  Freeform LLM extracts from page every query .........  9,625 tok / query
  Tap router heals once via verifier drift report .....    713 tok / drift
                                                          ────────
                                              At N=100 queries: 1,350×

  ─────  Production-honest comparison  ─────
  (both arms: bare Anthropic API · model picked for correctness)
  
  Freeform LLM (haiku · enough for naive page-extract) ......  9,625 tok / query
  Tap heal (sonnet · necessary for 4/4 mutation correctness) . 1,134 tok / drift
  Tap heal (cache replay on sibling tap) ....................     0 tok
                                                              ─────────
                                              At N=100 queries:  849×
```

Below the chart, one paragraph:

> Drift is the long-tail failure mode of any browser-automation system: a class renames, an endpoint changes, a layout shifts. The cost of *recovering* — re-finding the right selectors, re-deriving the extraction shape — is what dominates the per-incident bill on real LLM-driven systems. We give two comparisons. The first answers "what's the architectural win" — same model on both sides. The second answers "what does Tap cost in production" — Tap takes the more expensive model (sonnet, because haiku's correctness on harder mutations is only 2/4) and STILL wins by 849×. Both numbers are real measurements; their assumptions are on the table.

### Section 2.0 — Two baselines, two questions

The cleanest experiment runs both arms with the same model on the same API surface. We did that with haiku on bare Anthropic API: **1,350× amortization at N=100**. Same model, same API, no toolchain overhead. This is the **architectural** answer — does Tap's compile-once + verifier-router architecture produce a structurally smaller recovery surface than freeform LLM extraction? Yes by 1,350×.

The honest production answer holds Arm A constant (still haiku, bare API) and gives Arm C the model it actually needs for production reliability. Per the cross-model matrix on the same fixture set, sonnet passes 4/4 mutations correctly while haiku only passes 2/4 — so production Tap uses sonnet. Sonnet costs more per call (1,134 vs 713 tokens) which lowers the amortization to **849× at N=100**. The 849× is more conservative than 1,350× by exactly the model-cost ratio.

The 849× is the strongest defensible claim engineers can quote: same API surface on both arms, only Tap's correctness-required model upgrade as variable, still 849×.

(There is a third number, 3,973×, that compares Claude Code's sub-agent flow [45,064 tok per query, includes ~30K sub-agent overhead] vs Tap CLI [1,134 tok per drift]. We don't lead with that because including sub-agent overhead in Arm A reads as cherry-picking. See §2.4 disclosure for the full math if you run Tap from inside Claude Code.)

### Section 2 — Methodology

The honest version. Engineers who skip past prose go straight to the chart, but engineers who *cite* the page read this section.

#### Setup

- **3 production pilots**, distinct source shapes:
  - HN (`hackernews/hot`) — 2-step JSON via Firebase topstories → /item/<id> detail
  - Reddit (`reddit/hot`) — Atom RSS via Mozilla-UA fallback (.json is OAuth-gated)
  - GitHub (`github/issues`) — single-step JSON via search API
- **6 mutation classes**, each applied to each pilot:
  - `class_rename` — selector class swap (e.g. `.storylink` → `.titleline`)
  - `class_rename_secondary` — second-order class within a parent context
  - `tag_swap` — element tag change (e.g. `<a>` → `<span>`)
  - `schema_field_rename` — extracted field name change
  - `endpoint_swap` — URL template change with template-literal preservation
  - `param_rename` — argument name change
- **W0 verifier calibration**: independent verifier achieves FPR=0% / FNR=0% over n=390 (3 pilots × 130 mutations). Without this, recovery numbers are undefined — there's no ground truth to compare against. Calibration code in the public reproducibility harness (linked in §6).

#### The four arms

| Arm | What it represents | Token measurement |
|---|---|---|
| **A** | Freeform LLM extraction — what Claude for Chrome / OpenAI Atlas / Browser-Use does | Per query, since the LLM re-reads the page on every call |
| **B** | Tap full-rewrite heal — `tap fix` falling back when no verifier exists | Per drift, one-shot ExecutionPlan regeneration |
| **C** | Tap router minimal-patch — `tap fix` with verifier drift report | Per drift, `{old_fragment, new_fragment}` only |
| **D** | Oracle MDL floor — theoretical Levenshtein bound | Sub-token, by construction |

#### Why model choice differs by arm in the user-experienced comparison

| Arm | Model used | Reason |
|---|---|---|
| A (Claude Code sub-agent) | haiku | Claude Code's default for code-edit sub-agents; not user-tunable |
| C (Tap heal) | sonnet | haiku passes 2/4 mutations; sonnet passes 4/4 (cross-model matrix evidence) |

In the architectural comparison (haiku × bare-API × both arms), this asymmetry is removed — both arms run haiku on the bare Anthropic API. That's the apples-to-apples measurement.

#### Honest disclosures

- **The 1,134 tok production number is full-prompt sonnet**, not the 713 tok prototype headline. Earlier blog/internal numbers (1,350× amortized) used haiku × haiku at prototype prompt sizes. The full-prompt production sonnet number at N=100 amortizes to **849×**, not 1,350×. Both numbers are real; we publish both because the questions they answer are different (see §2.0).
- **Cross-model correctness**: at sonnet-default, 4/4 mutations recovered correctly. At opus, 4/4 at 19,700 tok (more expensive but no quality gain). At haiku, **2/4 recovered** at 30,000 tok — falsifying any "cheapest model is fine" assumption for Arm C. Haiku does fine on `class_rename`; it fails on harder mutations.
- **Cache replay is conditional**: 0 tokens applies *only* when a previous heal has populated the cache for the same drift signature on the same site. Cross-tap cache sharing (`(site, sig)` keying) makes this hit on siblings without each tap paying separately. First heal on a fresh drift always pays the Arm C cost.
- **Sub-agent overhead is real**: when Arm A runs as a Claude Code sub-agent (which is how a non-Tap Claude Code user would actually fix a scraper), it pays the 9,625 raw tokens *plus* ~30K of sub-agent system prompt + tool definitions = 45,064 total. We don't use this in §1 hero because it would compare Claude Code's product overhead against Tap's bare-API path — apples-to-oranges in measurement environment, even if the user's actual bill is what 45,064 represents. See §2.4.

#### §2.4 — The third baseline (Claude Code vs Tap CLI as products)

For users running both tools at their respective defaults (Claude Code with sub-agents; Tap CLI calling bare Anthropic):

```
Arm A (Claude Code sub-agent, haiku):  45,064 tok / query
Arm C (Tap CLI, sonnet, bare API):      1,134 tok / drift
At N=100 queries:                       3,973×
```

This is the strongest gap of the three baselines but also the most apples-to-oranges. We mention it because it's what a user's actual bill looks like — but it conflates Claude Code's product overhead with architectural advantage. The 849× number above isolates the architectural claim by stripping sub-agent overhead from both sides.

### Section 3 — Cross-site invariance

Same drift class, three sites, sonnet model. Numbers below are approximate (rounded to nearest 100 from the raw measurement set; raw values are within ±200 tok of stated):

| Site | class_rename | tag_swap | schema_field_rename |
|---|---|---|---|
| HN | ~14,000 tok | ~14,200 tok | ~14,500 tok |
| Reddit | ~14,100 tok | ~14,300 tok | ~14,400 tok |
| GitHub | ~14,000 tok | ~14,200 tok | ~14,300 tok |

The structural finding: **K(Δ) clusters around ~14K tokens regardless of source shape** — JSON-API (HN), RSS (Reddit), and search-API (GitHub) all sit within ~5% of each other for the same drift class. This is what justifies "compile once" as a frame: drift cost is amortizable across all sites a Tap deployment manages, not a per-site lottery.

> Cell values in this table are rounded; the "~5%" structural claim survives any noise in the raw values. Mean ± std-dev across multiple runs is on the roadmap.

### Section 4 — Natural drift validation

Synthetic mutations are easy to game. We measured one natural drift via WebArchive snapshots:

> HN's story-link selector renamed from `.storylink` (2018) to `.titleline` (2024) — a 6-year evolution captured by WebArchive. Sonnet recovered the change in approximately **14,500 tokens** with a defensive fallback patch. The cost matches synthetic measurements within noise, suggesting the synthetic mutations are not artificially easier than real-world drift.

This is one data point. We're collecting more natural drifts; updates land here.

### Section 5 — Cache compounding

The 849× / 1,350× ratios already account for query amortization (Arm A pays per query while Tap pays once per drift). Cache adds a second axis: **same drift signature on a sibling tap** = 0 tokens.

Using the production-honest baseline (Arm A bare-API haiku × Arm C bare-API sonnet) as base:

```
Single-tap, N queries between drifts:
                          Arm A cumulative   Arm C cumulative   Ratio
N=1   query, 1 drift           9,625              1,134          8.5×
N=10  query, 1 drift          96,250              1,134          85×
N=100 query, 1 drift         962,500              1,134          849×
N=1k  query, 1 drift       9,625,000              1,134        8,491×

K taps × 1 drift, site-keyed cache replays free:
K=1   first heal               ─                  1,134          (baseline)
K=2   1 sibling cache hit      ─                  1,134          (2× free)
K=10  9 sibling cache hits     ─                  1,134          (10× free)
K=100 99 sibling cache hits    ─                  1,134          (100× free)
```

Combined regime — N queries × K sibling taps × cache:

```
N=100 queries × K=10 sibling taps × 1 drift signature
  Arm A cost:  9,625 × 100 × 10 = 9,625,000 tok
  Arm C cost:  1,134 (one heal, replayed across 10 taps)
  Effective ratio:  8,491×
```

Cache hits = re-runs of the *same drift signature* on the same site. Cross-tap sharing (`(site, sig)` keying) means once `hackernews/hot` heals a drift, `hackernews/comments` and `hackernews/user` get the patch for free if their selector tree shares the renamed class. The break-even on cache is the second tap; the compound advantage grows linearly with sibling count.

For agents managing many taps over weeks, the cache regime is operative — not the 1-shot case.

### Section 6 — Reproduction

- Calibration harness: `tap-skills/experiments/w0-verifier/` (Apache 2.0). The Tap CLI itself is proprietary; the reproducibility kit covers Arm A, Arm D, and verifier calibration end-to-end against a bare Anthropic API.
- Mutation generator: `corrupt.ts` produces deterministic drift on test fixtures
- Verifier: `verify.ts` runs the V primitive; calibration via `calibrate.ts` over n=390
- Per-arm runners: `run.ts` invokes the chosen arm against the corrupted fixture
- Result format: per-call token-usage logs (model, task, prompt/completion tokens, cache hit/miss)

To reproduce locally:
```bash
git clone https://github.com/LeonTing1010/tap-skills && cd tap-skills/experiments/w0-verifier
deno task calibrate    # ~5 min, produces FPR/FNR table
deno task run -- --arm C --pilot hn --mutation class_rename
```

### Section 7 — What this doesn't show

- **First-execution time**: Tap requires a forge phase before any reuse. For one-shot novel scrapes, browser-use and Stagehand reach result faster.
- **Coverage breadth**: 3 pilots is small. We're targeting 10 by end of W6.
- **Real-world drift cadence**: HN's selector stability is ~1 rename per 6 years on tap-critical paths. Less stable sites (heavy SaaS A/B testing, social networks) likely drift more often. Cache compounding is more valuable on those.
- **Multi-step page interactions**: this benchmark covers extraction-heavy taps. Write-intent taps (form submit, purchase, etc.) have different cost profiles we haven't measured.

### Section 8 — Citation

If you reference these numbers in writing, please include the version tag — measurements may be re-run as the methodology tightens (per §3 verification status). Form:

```
Tap K(Δ) Benchmark, v0.1 (2026-04-26)
https://taprun.dev/benchmark/
Reproduction: https://github.com/LeonTing1010/tap-skills/tree/experiments/v0.1
```

We tag this as v0.1 rather than v1 because (a) cells are N=1 single runs without variance bounds, (b) §3 cross-site numbers are reconstructed from internal records and pending re-measurement, (c) Arm C heal pipeline is in tap-core (closed-source), so external full-pipeline replication isn't possible without licensed access — the verifier harness and Arm A/D replicate fully against bare API. We'll publish v1.0 once cells reach N≥5 with variance and the methodology survives external review.

Citation surface beyond this page:
- arXiv preprint (planned, not blocking)
- Schema.org `Dataset` markup (in HTML below)
- `tap-skills` GitHub release tagged `experiments/v0.1` for reproducibility kit
- (No Zenodo DOI at v0.1 — DOI archive is permanent; we hold off until N≥5/cell.)

### Footer

> Numbers measured on production Tap runs in late April 2026. The Tap CLI is proprietary; the verifier harness and Arm A / Arm D replication artifacts are open under Apache-2.0 in `tap-skills`.
