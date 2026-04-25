---
title: "Serving tap-v1 (operator notes)"
description: "Operational notes for the maintainer of taprun.dev — content negotiation, MIME types, and caching for the tap-v1 namespace."
sitemap: false
robots: noindex
---

# Serving tap-v1

Operational notes for the maintainer of `taprun.dev`.

## MIME type

The normative content type for a JSON-LD context document is:

```
Content-Type: application/ld+json
```

## GitHub Pages status

`taprun.dev` is currently hosted on GitHub Pages (see `CNAME`). GitHub
Pages does **not** allow custom MIME type configuration — no
`.htaccess`, no `netlify.toml`-style mapping, no `_headers` file.

Jekyll's built-in MIME table maps `.jsonld` to `application/octet-stream`
by default. The file at `./index.jsonld` will therefore be served with
that type unless we move the host.

### Is this a blocker?

No — for Tap's own use. Tap's runtime parses `tap:*` fields by literal
key and never dereferences the context URI. The URI's job is to be a
**stable identifier**, not a **live resolution target**.

Most JSON-LD processors (`jsonld-java`, `jsonld.js`, `PyLD`) accept a
context at any content type as long as the body parses. Strict validators
(some SHACL pipelines, some Linked Data browsers) may warn or refuse.

### Workarounds, in order of simplicity

1. **Cloudflare Worker in front of Pages.** `taprun.dev` already proxies
   through Cloudflare (see `core/CLAUDE.md` § Deployment). A minimal
   Worker can rewrite `Content-Type` for paths under `/ns/`:

   ```js
   // worker.js
   export default {
     async fetch(req, env) {
       const res = await fetch(req);
       const url = new URL(req.url);
       if (url.pathname.endsWith('.jsonld') ||
           url.pathname.match(/^\/ns\/tap-v1\/?$/)) {
         const r = new Response(res.body, res);
         r.headers.set('Content-Type', 'application/ld+json; charset=utf-8');
         return r;
       }
       return res;
     }
   }
   ```

2. **Move `taprun.dev` off Pages.** Cloudflare Pages, Netlify, Vercel all
   support `_headers` / `netlify.toml` MIME overrides.

3. **Leave as-is.** Acceptable for v1 — document the limitation here,
   and pick one of the above if a consumer actually hits the issue.

## Cache

This document should be served with a long max-age — it is stable by
contract:

```
Cache-Control: public, max-age=604800, immutable
```

Immutable is semantically correct: the URI is a versioned identifier
(`tap-v1`). Any breaking change ships at `tap-v2/`.

## Content negotiation (future)

When we have a real web server in the loop, content negotiation is
appropriate:

```
GET /ns/tap-v1
Accept: application/ld+json    → index.jsonld
Accept: text/html              → index.html (human-readable, TBD)
```

Out of scope for v1. The current README.md is the human-readable surface.

## IANA media type

`application/ld+json` is registered with IANA
(<https://www.iana.org/assignments/media-types/application/ld+json>).
No custom media type registration is required for tap-v1 — we're
extending the Web Annotation vocabulary, not minting a new format.
