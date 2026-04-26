---
title: "Local-first by architecture — Taprun"
description: "Why Taprun runs in your browser, not someone else's cloud. The structural argument: six independent engineering-philosophy facts align with local-first; cloud-first browser SDKs cannot match them without rebuilding from scratch."
permalink: /local-first/
layout: default
---

# Local-first by architecture

> **Browser automation that runs in your browser, not someone else's cloud.**

This isn't a marketing claim. It's an architectural choice we made early and can't unmake without redesigning the product. Cloud-first competitors (Stagehand+Browserbase, Apify, Browserless) chose the opposite trade — for reasons we respect, but with consequences they can't paper over.

This page lays out the six independent reasons local-first is the right call for the cohorts Taprun serves, and what cloud-first SDKs structurally cannot offer those cohorts.

## The trust-boundary diagram

```
                  Cloud-first browser SDK                       Taprun (local-first)
                  ───────────────────────                       ──────────────────────

      You    ──►  Cloud vendor  ──►  Target site            You  ◄────── Local CLI ──►  Target site
     (cookies)   ▲             ▲                            (cookies)   (your browser)
                 │             │                                                ▲
            credentials   page DOM +                                    page DOM only,
            crossed       session crossed                              forge time only,
            boundary      boundary                                     no credential crossing

      ┌───────────────────────────────┐                  ┌─────────────────────────────────┐
      │ Trust boundary lives          │                  │ No external trust boundary —     │
      │ between you and the vendor.   │                  │ everything in your machine.      │
      │ Vendor sees your sessions.    │                  │ AI sees the page only at compile │
      │                               │                  │ time, never at runtime.          │
      └───────────────────────────────┘                  └─────────────────────────────────┘
```

## Six engineering-philosophy facts that align with local-first

Local-first solves all six simultaneously. Cloud-first solves none of them — by definition, since "cloud-first" is the negation of facts 1, 2, 4, and 5, and only partially answers 3 and 6.

| # | Fact | What it means in this context | Local-first answer | Cloud-first answer |
|---|---|---|---|---|
| **1** | A2 — LLM probabilistic | Any LLM in the loop might exfiltrate tokens, cookies, or page contents | AI runs only at compile time, in your machine, on a known URL | Cloud LLM sees full session on every run; "we don't store" is policy not architecture |
| **2** | A3 — machine checks only what it's told | Cloud automation needs explicit credential injection; mistakes in injection leak credentials | Browser session reused — zero credential transfer | Credential-injection layer is a permanent attack surface |
| **3** | D2 — rules not all known | Privacy regulations and company policies vary across customer types; the strict one wins for the vendor | Architecturally bypasses the regulation question — vendor never sees the data | Vendor must satisfy the strictest customer's policy; smaller customers carry the burden |
| **4** | R1 — every conversion loses information | Cloud automation must serialize cookie + session state and ship across the wire | Direct reuse — zero serialization round-trip | Lossy round-trip on every authenticated request |
| **5** | T1 — world changes externally | Auth state changes constantly: MFA prompts, session expiration, SSO renewal | Local extension follows the user's natural session | Cloud must poll-or-prompt to renew; lag and loss inevitable |
| **6** | R3 — formal precise but inexpressive | "Borrow my login state" can't be precisely defined as a contract — every customer has a different mental model | Architecturally avoids the contract question | Forced into one-size-fits-all ToS that no customer fully agrees with |

This is structural alignment, not coincidence. Once you commit to "your browser, your runtime," the other five facts fall into place. Reverse the commit and the whole stack inverts — which is why the two camps don't easily cross over.

## What this means in practice

### For solo SaaS founders running their own scrapers

You scrape your own LinkedIn, your own X, your own Instagram. You're not a malicious actor — you're just automating what you'd do manually. **TOS-wise, "automation against your own logged-in account" sits in a legal gray zone**. Letting a cloud vendor do it on your behalf changes the analysis: now there's a third party with stored credentials, and the platform has clear cause to act on the cloud-vendor's IP space.

Taprun keeps the action in your browser, on your IP, with your fingerprint. No extra trust boundary. Same outcome as you doing it manually — just faster.

### For privacy-bound automators (legal, healthcare, finance)

You can't put client portals, EHR systems, or banking dashboards into a third-party cloud. Your compliance officer has been clear about that. Cloud-first browser SDKs are off the table for the same reason as cloud spreadsheets — the data crosses a boundary you've contractually agreed it won't.

Taprun runs in your browser. The data stays in your browser. The plan file (`.tap.json`) is on your disk. The doctor verdicts are local. There's no vendor-side log to subpoena, because there's no vendor side.

### For internal / intranet operators

You want to automate against `wiki.internal`, `jira.internal`, your customer-facing CRM at `app.yourcompany.com`. A cloud vendor would need a VPN tunnel from their network into yours — operationally clunky, security-team-hostile, and often disallowed by corporate firewalls.

Taprun runs on your laptop. Your laptop is already on the VPN. End of architecture problem.

### For founders worried about vendor lock-in

A cloud-first browser SDK is a vendor dependency. If they raise prices, change ToS, get acquired, or shut down, your scrapers stop. Their billing is per-action; your costs scale with usage; you have no leverage.

Taprun's plan format is open ([@taprun/spec](https://www.npmjs.com/package/@taprun/spec) on npm, MIT). The runtime is a binary on your disk. The Chrome extension is an open MIT codebase. If Taprun the company disappears, the plans you've already compiled keep running — they're just data.

## What cloud-first SDKs do better

Honesty matters. Local-first is not unconditionally better. Three things cloud-first wins on:

1. **Scaling out**. If you need to hit 10,000 sites in parallel, cloud-first is built for it. Local-first means you scale by buying machines.
2. **Stateless tasks**. If your automation has no login state and no credentials — pure scraping of public pages — cloud-first removes the local browser dependency.
3. **Heavy compute**. Cloud-first can put browsers next to GPU clusters for vision or AI processing without round-tripping page contents.

Taprun is the wrong tool when your task is "run 10K parallel anonymous scrapers." Use [Browserbase](https://browserbase.com), [ScrapingBee](https://scrapingbee.com), or [Apify](https://apify.com). They're well-engineered for that pattern.

Taprun is the right tool when your task is "automate against my own logged-in stuff, reliably, without giving anyone my credentials, and with audit trail I can show internal compliance."

## How to verify the local-first claim yourself

Three independent ways:

1. **Read the source.** The CLI binary is closed source, but the [Chrome extension](https://github.com/LeonTing1010/tap/tree/main/extension) is MIT — every line of code that touches your cookies is auditable. The [@taprun/spec](https://github.com/LeonTing1010/tap/tree/main/packages/spec), three converters, and create-tap-script are MIT too.

2. **Watch the network.** Run `tap doctor` or `tap run` with your devtools network panel open. The only outbound request is to the **target site you're automating** — there is no telemetry beam-back to taprun.dev (which only serves license validation, on opt-in for paid features, and only if you start a paid subscription).

3. **Read the [SECURITY.md](https://github.com/LeonTing1010/tap/blob/main/SECURITY.md).** It documents the five PR-blocking invariants (servers never push code, servers never initiate connections, source never leaves your machine, server features opt-in, local-first is the default).

## What's coming next

- **0.2 of the converters**: replacing the regex scanners with TypeScript AST walks so variable-bound selectors and template-string interpolation work.
- **Plugin marketplace** (Stage 2 flywheel): community can extend doctor and heal with custom validators and recovery strategies.
- **On-prem Compliance tier**: SOC2-ready audit trail, HIPAA-compatible local execution, formal SLA. [Talk to us](mailto:hello@taprun.dev?subject=Taprun%20Compliance) if you're a regulated cohort.

## Related

- [Format spec — `.tap.json` plan-v1](/spec/plan-v1/)
- [Compare with cloud-first SDKs](/compare/)
- [Five npm packages on GitHub](https://github.com/LeonTing1010/tap/tree/main/packages)
- [SECURITY.md — full threat model](https://github.com/LeonTing1010/tap/blob/main/SECURITY.md)

---

*Local-first by architecture. Last updated 2026-04-27.*
