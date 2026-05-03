---
layout: default
title: "agents.json — Schema.org WebAPI Profile"
description: "Draft spec for agents.json — a Schema.org JSON-LD document that websites publish to declare how AI agents should interact with them."
---

# agents.json — Schema.org WebAPI Profile

**Status:** Draft
**Authors:** Leon Ting ([@LeonTing1010](https://github.com/LeonTing1010))
**Repository:** [github.com/LeonTing1010/agents-json](https://github.com/LeonTing1010/agents-json)
**Last updated:** 2026-04-07

## Abstract

`agents.json` is a [Schema.org](https://schema.org) JSON-LD document that websites publish to declare how AI agents should interact with them. It uses standard Schema.org types — the same vocabulary Google already indexes for rich search results.

- **robots.txt** says what agents *cannot* do
- **agents.json** says what agents *can* do, and how

No new vocabulary. No new standard. Just Schema.org `WebAPI` + `potentialAction` — types that Google, Bing, and every major search engine already understand.

## Why Schema.org

Getting websites to adopt a new file format is nearly impossible. But **35% of websites already publish Schema.org JSON-LD** for Google SEO benefits (rich snippets, sitelinks search box, knowledge panels).

agents.json rides on this existing infrastructure:

| Approach | Adoption | Indexed by Google |
|----------|----------|-------------------|
| Custom JSON format | ~0% (must evangelize) | No |
| **Schema.org JSON-LD** | **~35% already have it** | **Yes** |

Website owners already have motivation to publish Schema.org data — it improves their search rankings. agents.json gives them a reason to describe their APIs using the same mechanism.

## Discovery

Agents discover structured data through existing web standards, in priority order:

1. **JSON-LD in page** — `<script type="application/ld+json">` in any page's `<head>`. Already published by 35% of websites for SEO. Google indexes this.
2. **Well-known URL** — `GET /.well-known/agents.json` with `Content-Type: application/ld+json`. 3-second timeout.
3. **Link header/tag** — `<link rel="describedby" type="application/ld+json" href="/agents.json">` in HTML or HTTP `Link` header.
4. **Sitemap reference** — `<url><loc>/.well-known/agents.json</loc></url>` in sitemap.xml.

If none found, fall back to page inspection (the `capture` meta verb).

## Specification

### Minimal Example

```json
{
  "@context": "https://schema.org",
  "@type": "WebSite",
  "name": "Hacker News",
  "url": "https://news.ycombinator.com",
  "description": "Tech news aggregator with community voting"
}
```

This is a valid agents.json. Google already indexes this format for sitelinks. Agents use `name` and `description` for intent matching.

### With Search (Google Sitelinks compatible)

```json
{
  "@context": "https://schema.org",
  "@type": "WebSite",
  "name": "Hacker News",
  "url": "https://news.ycombinator.com",
  "description": "Tech news aggregator with community voting",
  "potentialAction": {
    "@type": "SearchAction",
    "target": {
      "@type": "EntryPoint",
      "urlTemplate": "https://hn.algolia.com/api/v1/search?query={search_term_string}",
      "httpMethod": "GET",
      "contentType": "application/json"
    },
    "query-input": "required name=search_term_string"
  }
}
```

This is the exact format Google uses for the sitelinks search box. Already supported by WordPress/Yoast, Shopify, and most CMS platforms.

### Full Example (WebAPI + Actions)

```json
{
  "@context": "https://schema.org",
  "@type": "WebAPI",
  "name": "Hacker News",
  "description": "Tech news aggregator with community voting",
  "url": "https://news.ycombinator.com",
  "documentation": "https://github.com/HackerNews/API",
  "termsOfService": "https://www.ycombinator.com/legal#tou",
  "provider": {
    "@type": "Organization",
    "name": "Y Combinator",
    "url": "https://www.ycombinator.com"
  },

  "potentialAction": [
    {
      "@type": "ReadAction",
      "name": "top-stories",
      "description": "Front page stories ranked by score",
      "target": {
        "@type": "EntryPoint",
        "urlTemplate": "https://hacker-news.firebaseio.com/v0/topstories.json",
        "httpMethod": "GET",
        "contentType": "application/json"
      },
      "object": {
        "@type": "ItemList",
        "itemListElement": {
          "@type": "ListItem",
          "additionalProperty": [
            { "@type": "PropertyValue", "name": "id", "description": "Story ID", "valuePattern": "[0-9]+" },
            { "@type": "PropertyValue", "name": "title", "description": "Story title" },
            { "@type": "PropertyValue", "name": "url", "description": "Link URL" },
            { "@type": "PropertyValue", "name": "score", "description": "Upvote count", "valuePattern": "[0-9]+" },
            { "@type": "PropertyValue", "name": "by", "description": "Author username" },
            { "@type": "PropertyValue", "name": "time", "description": "Unix timestamp", "valuePattern": "[0-9]+" }
          ]
        }
      }
    },
    {
      "@type": "ReadAction",
      "name": "new-stories",
      "description": "Newest stories in chronological order",
      "target": {
        "@type": "EntryPoint",
        "urlTemplate": "https://hacker-news.firebaseio.com/v0/newstories.json",
        "httpMethod": "GET",
        "contentType": "application/json"
      }
    },
    {
      "@type": "SearchAction",
      "name": "search",
      "description": "Full-text search across all stories",
      "target": {
        "@type": "EntryPoint",
        "urlTemplate": "https://hn.algolia.com/api/v1/search?query={search_term_string}&tags=story",
        "httpMethod": "GET",
        "contentType": "application/json"
      },
      "query-input": "required name=search_term_string"
    },
    {
      "@type": "CreateAction",
      "name": "submit-story",
      "description": "Submit a new story to Hacker News",
      "target": {
        "@type": "EntryPoint",
        "urlTemplate": "https://news.ycombinator.com/submit",
        "httpMethod": "POST",
        "encodingType": "application/x-www-form-urlencoded"
      },
      "object": {
        "@type": "CreativeWork",
        "additionalProperty": [
          { "@type": "PropertyValue", "name": "title", "description": "Story title (required)", "valueRequired": true },
          { "@type": "PropertyValue", "name": "url", "description": "Link URL (optional)" },
          { "@type": "PropertyValue", "name": "text", "description": "Text body (optional)" }
        ]
      }
    }
  ]
}
```

## Type Reference

### Root Types

Use `WebSite` for simple sites. Use `WebAPI` when the site exposes API endpoints.

| Type | When to use | Google indexes? |
|------|-------------|-----------------|
| `WebSite` | Any website (name, description, search) | Yes — sitelinks, search box |
| `WebAPI` | Sites with API endpoints (extends Service) | Yes — as Service |

Both support `potentialAction` for declaring what agents can do.

### Actions (potentialAction)

Each action in `potentialAction[]` represents one thing an agent can do.

| Action Type | Schema.org Type | HTTP Method | Example |
|-------------|----------------|-------------|---------|
| Read data | `ReadAction` | GET | Fetch trending stories |
| Search | `SearchAction` | GET | Full-text search |
| Create | `CreateAction` | POST | Submit a new post |
| Update | `UpdateAction` | PUT/PATCH | Edit a comment |
| Delete | `DeleteAction` | DELETE | Remove a post |

**Action properties:**

| Property | Type | Required | Description |
|----------|------|----------|-------------|
| `@type` | string | **yes** | Schema.org action type |
| `name` | string | **yes** | Machine identifier (e.g. `"top-stories"`) |
| `description` | string | **yes** | What this action does |
| `target` | EntryPoint | **yes** | How to invoke it |
| `object` | Thing | no | Input/output schema |
| `query-input` | string | no | For SearchAction: parameter binding (Google format) |

### EntryPoint (target)

Describes how to reach an endpoint.

| Property | Type | Required | Description |
|----------|------|----------|-------------|
| `@type` | string | **yes** | `"EntryPoint"` |
| `urlTemplate` | string | **yes** | URL with RFC 6570 placeholders: `https://api.example.com/items/{id}` |
| `httpMethod` | string | no | `GET`, `POST`, `PUT`, `DELETE`. Default: `GET` |
| `contentType` | string | no | Response MIME type. Default: `application/json` |
| `encodingType` | string | no | Request body encoding |

### Fields (PropertyValue)

Describe input/output fields using Schema.org `PropertyValue` inside `additionalProperty`:

| Property | Type | Description |
|----------|------|-------------|
| `name` | string | Field name |
| `description` | string | Human-readable description |
| `valueRequired` | boolean | Is this field required? |
| `valuePattern` | string | Regex validation pattern |
| `defaultValue` | string | Default value |
| `minValue` / `maxValue` | number | Numeric bounds |

## Relationship to Google SEO

agents.json is a strict superset of what Google already indexes:

| Google Feature | Schema.org Type | agents.json extends with |
|----------------|----------------|--------------------------|
| Sitelinks search box | `WebSite` + `SearchAction` | More action types (Read, Create, Update) |
| Knowledge panel | `Organization` + `WebSite` | API endpoint details |
| Rich snippets | `Article`, `Product`, etc. | Machine-actionable endpoints |
| Breadcrumbs | `BreadcrumbList` | — (orthogonal) |

**A valid agents.json is always valid Schema.org JSON-LD.** Google will index it. No special handling needed.

### What websites already publish (and agents.json adds)

```
What 35% of sites have now:          What agents.json adds:
─────────────────────────────        ──────────────────────────
WebSite.name                         WebAPI (@type upgrade)
WebSite.description                  ReadAction (data endpoints)
SearchAction (sitelinks)             CreateAction (write operations)
                                     EntryPoint.httpMethod
                                     PropertyValue (field schemas)
```

The transition is incremental: websites keep their existing JSON-LD, add `potentialAction` entries for their API endpoints.

## Implementation Guide

### For Websites

**Step 1: You probably already have this.** Check if your site has `<script type="application/ld+json">` in the `<head>`. Most CMS platforms (WordPress, Shopify, etc.) add it automatically.

**Step 2: Add API endpoints.** Upgrade `@type` from `WebSite` to `WebAPI`, add `potentialAction` entries for your public endpoints.

**Step 3: Publish at well-known URL.** Copy the JSON-LD to `/.well-known/agents.json` for direct agent discovery.

### For AI Agents

1. Check `/.well-known/agents.json` (3-second timeout)
2. If not found, parse `<script type="application/ld+json">` from the page
3. Look for `potentialAction` with `EntryPoint` targets
4. Use `urlTemplate` + `httpMethod` to call endpoints directly
5. Fall back to page inspection if no structured data found

### For Tap

```bash
# capture automatically consumes agents.json during inspection
tap capture https://news.ycombinator.com hackernews/hot --intent "trending stories"
# → capture finds agents.json → uses ReadAction endpoint directly

# After capturing, you can author an agents.json file for the site
# (Schema.org JSON-LD that the site owner can publish — see Examples §)
```

## FAQ

**Q: How is this different from OpenAPI?**
A: OpenAPI describes every endpoint in exhaustive detail (often thousands of lines). agents.json describes the 3-5 most useful actions in under 50 lines using Schema.org vocabulary. Think of it as the TL;DR for agents — and Google indexes it.

**Q: Do I need a new file?**
A: No. You can embed agents.json as JSON-LD directly in your HTML `<head>` — the same place you put Schema.org data for SEO. Google indexes it from there.

**Q: Will Google actually index the WebAPI/ReadAction parts?**
A: Google indexes all valid Schema.org JSON-LD, even types it doesn't render as rich results yet. The data is in Google's Knowledge Graph. As AI agents become first-class search consumers, this data will matter more.

**Q: What about robots.txt?**
A: robots.txt and agents.json are complementary. robots.txt restricts crawling. agents.json declares API interfaces. An agent should respect both: don't crawl disallowed paths, but do use declared API endpoints.

**Q: Can I validate my agents.json?**
A: Yes — use [Google's Rich Results Test](https://search.google.com/test/rich-results) or [Schema.org Validator](https://validator.schema.org/). Any valid agents.json passes both.


## See also

- [Compile Once. Run Forever. Diff the Drift.](/blog/compile-once-diff-the-drift) — why declarative agent contracts beat agent-at-runtime.
- [Browse 200+ taps](/taps/) — every tap is a machine-readable Web Annotation, the same model agents.json uses.
- [tap-v1 namespace](/ns/tap-v1/) — the JSON-LD vocabulary that Taprun uses for executable agent contracts.

