# agents.json Specification v1.0

**Status:** Draft
**Authors:** Leon Ting ([@LeonTing1010](https://github.com/LeonTing1010))
**Repository:** [github.com/LeonTing1010/agents-json](https://github.com/LeonTing1010/agents-json)
**Last updated:** 2026-04-04

## Abstract

`agents.json` is a machine-readable file that websites publish to declare how AI agents should interact with them. It answers the question: *"What can an AI agent do here, and how?"*

It complements existing standards:

- **robots.txt** says what agents *cannot* do
- **agents.json** says what agents *can* do, and how to do it well

## Motivation

AI agents automate websites by inspecting pages, guessing API endpoints, and reverse-engineering data structures. This is fragile, slow, and adversarial.

`agents.json` flips the relationship: websites *declare* their automation-friendly interfaces. Agents consume the declaration and skip the guesswork. The result:

- **For websites:** Control how agents interact with you. Set rate limits, require attribution, block bad actors.
- **For agents:** Skip page inspection. Go straight to the right API endpoint with correct field names.
- **For users:** Faster, more reliable automations that don't break when sites redesign.

## Discovery

Serve the file at:

```
/.well-known/agents.json
```

Content-Type: `application/json`

Agents should probe this URL with a 3-second timeout. If unavailable, fall back to other discovery methods (OpenAPI, llms.txt, page inspection).

## Specification

### Minimal Example (3 fields)

```json
{
  "version": "1.0",
  "name": "Hacker News",
  "description": "Tech news aggregator with community voting"
}
```

This is a valid `agents.json`. It tells agents: "This site exists, here's what it is." Agents can use the name and description for intent matching.

### Full Example

```json
{
  "version": "1.0",
  "name": "Hacker News",
  "description": "Tech news aggregator with community voting",
  "homepage": "https://news.ycombinator.com",

  "data": [
    {
      "name": "top-stories",
      "description": "Front page stories ranked by score",
      "endpoint": "https://hacker-news.firebaseio.com/v0/topstories.json",
      "method": "GET",
      "format": "json",
      "fields": {
        "id": "number — story ID",
        "title": "string — story title",
        "url": "string — link URL",
        "score": "number — upvote count",
        "by": "string — author username",
        "time": "number — unix timestamp"
      },
      "auth": "none",
      "rate_limit": "30 req/min"
    },
    {
      "name": "new-stories",
      "description": "Newest stories in chronological order",
      "endpoint": "https://hacker-news.firebaseio.com/v0/newstories.json",
      "method": "GET",
      "format": "json",
      "auth": "none"
    }
  ],

  "actions": [
    {
      "name": "submit-story",
      "description": "Submit a new story to Hacker News",
      "endpoint": "https://news.ycombinator.com/submit",
      "method": "POST",
      "auth": "cookie",
      "fields": {
        "title": "string — story title (required)",
        "url": "string — link URL (optional)",
        "text": "string — text body (optional)"
      },
      "requires_confirmation": true
    }
  ],

  "specs": {
    "openapi": "https://api.example.com/openapi.json",
    "graphql": "https://api.example.com/graphql",
    "llms_txt": "https://example.com/llms.txt",
    "rss": "https://example.com/rss"
  },

  "policies": {
    "automation_allowed": true,
    "rate_limit": "60 req/min",
    "requires_attribution": false,
    "allowed_agents": [],
    "blocked_agents": [],
    "contact": "api@example.com"
  }
}
```

## Field Reference

### Top-level Fields

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `version` | string | **yes** | Spec version. Currently `"1.0"` |
| `name` | string | **yes** | Human-readable site name |
| `description` | string | **yes** | One-line description of what this site is |
| `homepage` | string | no | Site URL |
| `data` | Data[] | no | Read-only data endpoints |
| `actions` | Action[] | no | Write/interactive operations |
| `specs` | Specs | no | Pointers to detailed API specifications |
| `policies` | Policies | no | Automation rules and rate limits |

### Data Object

A read-only data source that agents can extract from.

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `name` | string | **yes** | Identifier (e.g. `"top-stories"`) |
| `description` | string | **yes** | What this data represents |
| `endpoint` | string | **yes** | Full URL or relative path |
| `method` | string | no | HTTP method. Default: `"GET"` |
| `format` | string | no | Response format: `json`, `html`, `xml`, `rss`, `csv` |
| `fields` | object | no | Map of field name → `"type — description"` |
| `auth` | string | no | Auth method: `none`, `cookie`, `bearer`, `api_key` |
| `rate_limit` | string | no | Human-readable rate limit |
| `example_response` | any | no | Truncated sample response |
| `pagination` | object | no | `{ "type": "offset", "param": "page" }` or `"cursor"` |

### Action Object

A write operation that agents can perform.

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `name` | string | **yes** | Identifier (e.g. `"submit-story"`) |
| `description` | string | **yes** | What this action does |
| `endpoint` | string | **yes** | Full URL or relative path |
| `method` | string | no | HTTP method. Default: `"POST"` |
| `auth` | string | no | Auth method required |
| `fields` | object | no | Map of field name → `"type — description (required/optional)"` |
| `requires_confirmation` | boolean | no | Agent should confirm with user before executing. Default: `false` |

### Specs Object

Pointers to detailed API specifications. Agents use these for comprehensive field mapping.

| Field | Type | Description |
|-------|------|-------------|
| `openapi` | string | URL to OpenAPI 3.x JSON/YAML spec |
| `graphql` | string | URL to GraphQL endpoint (introspection enabled) |
| `llms_txt` | string | URL to llms.txt file |
| `rss` | string | URL to RSS/Atom feed |

### Policies Object

Rules that agents must follow.

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `automation_allowed` | boolean | `true` | Whether AI automation is permitted |
| `rate_limit` | string | none | Global rate limit (e.g. `"60 req/min"`) |
| `requires_attribution` | boolean | `false` | Must credit source when displaying data |
| `allowed_agents` | string[] | `[]` | Agent whitelist (empty = all allowed) |
| `blocked_agents` | string[] | `[]` | Agent blacklist |
| `contact` | string | none | Email for automation inquiries |

## Relationship to Other Standards

| Standard | Role | How agents.json relates |
|----------|------|------------------------|
| `robots.txt` | Deny list | agents.json is the allow list. Both should be respected. |
| `llms.txt` | LLM-readable site description | agents.json `specs.llms_txt` points to it |
| OpenAPI | Full API specification | agents.json `specs.openapi` points to it |
| A2A `agent-card.json` | Agent capability declaration | Complementary. agent-card = "what I can do", agents.json = "what you can do here" |
| Schema.org | Semantic page data | agents.json describes endpoints; Schema.org describes page content |

## Implementation Guide

### For Websites

1. Create `/.well-known/agents.json` with at minimum `version`, `name`, `description`
2. Add `data` entries for your public API endpoints
3. Add `policies` to set rate limits and rules
4. Optional: add `actions` for write operations

### For AI Agents

1. Before inspecting a page, check `/.well-known/agents.json` (3-second timeout)
2. If found, use `data` endpoints directly — skip page inspection
3. Respect `policies.rate_limit` and `policies.automation_allowed`
4. If `requires_confirmation` is true on an action, confirm with the user first
5. Fall back to page inspection if agents.json is not available

## FAQ

**Q: How is this different from OpenAPI?**
A: OpenAPI describes every endpoint in detail (hundreds of lines). agents.json describes the 3-5 most useful endpoints for agents in under 50 lines. Think of it as the TL;DR of your API.

**Q: Why not just use llms.txt?**
A: llms.txt is markdown — great for LLMs to read, but agents need structured data (endpoint URLs, field names, auth types) that's machine-parseable without AI interpretation.

**Q: Do I need to implement all fields?**
A: No. The minimal valid file is 3 fields. Start small, add more as needed.

**Q: How do I register this as a well-known URI?**
A: We plan to submit to the IANA well-known URI registry (RFC 8615) once there is sufficient adoption. Current status: community draft.
