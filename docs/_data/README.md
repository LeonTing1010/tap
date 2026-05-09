# `_data/` — single source of truth for cross-page facts

This directory holds Jekyll data files. Every page on taprun.dev that
references a CLI command, pricing tier, plan-fleet cap, or community-tap
count reads from a file here via Liquid (`{{ site.data.cli.* }}`). Updating
vocabulary is one-file edit; the site rebuilds and every page is consistent.

## Files

- **`cli.yml`** — CLI verbs, MCP transports, install commands, pricing
  tiers, Creem product IDs, plan-fleet caps, community-tap counts. The
  authoritative public surface.

## How to use

In any page that has Jekyll frontmatter (`---\n---\n` at the top), reference
the data via Liquid:

```liquid
{{ site.data.cli.verbs.verify.cli }}      <!-- "tap verify" -->
{{ site.data.cli.tiers[1].display }}      <!-- "Capture" -->
{{ site.data.cli.counts.community_taps }} <!-- 70 -->
```

Static `.html` files without frontmatter are served as raw HTML and ignore
Liquid. Add an empty frontmatter block (just `---\n---\n`) to opt them in.

## Drift guards

- `tiers[*].cap` must match `core/auth.ts:PLAN_LIMIT`.
- `tiers[*].creem_id` must match `core/auth.ts:CREEM_TIER_MAP`.
- `op_count` and `ops` must match `core/types.ts:OP_NAMES_V2`.

There is no automated drift check between this file and the engine. When
one moves, update both in the same PR.

## What goes here vs in a page

| Lives here | Lives in the page |
|---|---|
| CLI verb names, command shape, install commands | Prose, narrative, examples specific to that page |
| Pricing tier names / amounts / caps | Page-specific framing of *why* a tier matters |
| Plan-fleet cap, community-tap count | Inline screenshots, story-telling, deep dives |
| Anything that might rotate independently of prose | Anything that's only true for this one page |

If you find yourself updating the same fact in 3+ pages, it belongs here.
