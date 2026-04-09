# Tap Security Policy

## TL;DR

Tap runs in your authenticated browser context with full Chrome API
privileges. A compromise of Tap is a compromise of every service you're
logged into. We take this seriously and the architecture is designed to
keep that trust assumption from being violated.

**If you find a vulnerability**, please report it via
[GitHub Security Advisories](https://github.com/LeonTing1010/tap/security/advisories/new)
or email **security@taprun.dev**. We acknowledge within 48 hours and aim
to fix critical issues within 30 days. Bug bounties are not yet funded
but we credit reporters in fix notes (unless you prefer anonymity).

## Threat Model

### What Tap can do — and therefore what an attacker who controls Tap can do

Tap is interface infrastructure. To do its job, the Chrome extension and
local daemon hold these capabilities:

- Read all cookies (incl. HttpOnly via `chrome.cookies`)
- Read DOM, localStorage, IndexedDB, sessionStorage on any page
- Inject scripts via `chrome.scripting.executeScript`
- Submit forms, click buttons, type text on your behalf
- Navigate to any URL, take screenshots
- Read network responses via CDP (Network.responseReceived)
- Open and close tabs, manage multi-tab sessions

### Why Tap's blast radius is larger than typical SaaS

Most SaaS tools (Notion, Linear, Figma) have **data at rest** in their
servers. A breach leaks data — bad, but bounded. The attacker gets what
the service stored.

Tap is different because it has **execution capability** in your
authenticated browser. A compromise of Tap is closer to:

- A password manager extension breach (1Password, LastPass, Bitwarden)
- A crypto wallet extension breach (MetaMask, Phantom)
- A remote desktop tool with stored credentials (TeamViewer, AnyDesk)

The attacker doesn't get Tap's data. The attacker gets **anything you
were logged into when Tap was running**: email, banking, GitHub, AWS,
Slack, your company's SSO, your crypto wallet, your social media, your
saved passwords.

This framing matters because it justifies architectural choices that
look paranoid for a typical SaaS but are baseline for tools with this
blast radius.

## Architectural Invariants

These are **hard rules**. Code that violates them is rejected at PR
review. Tests in [tap-core](https://github.com/LeonTing1010/tap-core)
enforce a subset automatically.

### 1. Tap servers never push executable code to clients

Any server → client message must be **structured data validated against
a strict schema**. Free-form code, scripts, or "patches" containing
executable strings are forbidden. The local daemon rejects anything that
doesn't match the allowed schema.

**Why**: a compromised Tap server should NOT be able to ship arbitrary
JavaScript that runs in your browser. The server's worst case is
"attacker can suggest bad selectors" — not "attacker can run any code".

### 2. Tap servers never initiate connections to user machines

The daemon is **outbound-only**. No long-poll where the server pushes
work, no webhook the server calls, no reverse SSH, no cloud cron that
wakes the local agent. Every server interaction is **client-initiated
pull**.

**Why**: this is the structural property that prevents "compromised Tap
server → remote control of every Tap user's browser". If the server
can't initiate, the worst attacker can do is poison content the client
voluntarily fetches — and that content goes through invariant #1's
schema firewall.

### 3. Tap source code never leaves the user's machine

`.tap.js` files can contain selectors, API endpoints, auth tokens,
business logic, and scraping targets — they are user IP and may contain
credentials. We do **not** offer cloud sync of `~/.tap/taps/`.

When multi-machine sync is built (Pro feature roadmap), it will be
**end-to-end encrypted client-side** (Bitwarden model: server holds
opaque ciphertext blobs, encryption keys never leave user machines).

### 4. Server features are opt-in, off by default

Free tier never touches Tap servers (except license validation).
Hacker tier never touches Tap servers (except license validation).
Pro tier (current v1 design) **still** never touches Tap servers
beyond license validation.

If a future feature needs server compute, it must be:
- Per-feature opt-in with explicit user consent at activation time
- Documented in this file before shipping
- Justified against invariants 1-3

### 5. Local-first is the architectural default, not a fallback

Every Pro feature must have a 100% local mode. Users who never want
their machine to phone home — for privacy, regulatory, or paranoid
reasons — can pay for Pro and get the features listed on the pricing
page. "Local-only" is a tier of trust we offer, not a degraded
experience.

## Trust Boundaries (current)

```
┌──────────────────────────────────────────────────────────┐
│                      Your machine                          │
│                                                            │
│   ┌──────────┐   stdio    ┌─────────┐    HTTP localhost   │
│   │   CLI    │ ─────────► │ Daemon  │ ◄─────────────┐    │
│   │   MCP    │            │  :9333  │                │    │
│   │  client  │            │  :9334  │                │    │
│   └──────────┘            └─────────┘                │    │
│                                ▲                      │    │
│                                │ HTTP localhost       │    │
│                                │                      │    │
│                          ┌──────────┐                 │    │
│                          │  Chrome  │                 │    │
│                          │ Extension│                 │    │
│                          └──────────┘                 │    │
│                                │                      │    │
│                                │ chrome.* APIs        │    │
│                                ▼                      │    │
│                       ┌────────────────┐              │    │
│                       │  Your browser  │              │    │
│                       │  (auth state)  │              │    │
│                       └────────────────┘              │    │
└────────────────────────────────────────────┬───────────┘
                                             │
                                             │ HTTPS, outbound only
                                             ▼
                              ┌──────────────────────────────┐
                              │      api.taprun.dev          │
                              │   /activate /validate        │
                              │                              │
                              │   Sees: license key, machine │
                              │     fingerprint, tier        │
                              │   Does NOT see: tap source,  │
                              │     page data, browse        │
                              │     history, cookies, AI     │
                              │     prompts, anything else   │
                              └──────────────────────────────┘
```

The local daemon **only binds 127.0.0.1**. There is no remote network
exposure. Every component on your machine trusts every other component
on your machine — that trust boundary is the OS user account. Remote
attackers must first achieve local code execution to reach Tap, at
which point they've already won at a lower layer.

## Current Mitigations

### Layer 1: Sandbox (runtime)

Tap functions execute in a Deno Worker with **zero permissions**:

```
Worker (permissions: "none")
  tap.click("Submit")  →  postMessage  →  main thread  →  runtime
```

The Worker **cannot**:
- Read files (`Deno.readFile`, `Deno.readTextFile`)
- Make network requests (`fetch`, `Deno.connect`)
- Run subprocesses (`Deno.Command`)
- Read environment variables (`Deno.env`)
- Import dynamic modules (`import()`)

All interface operations proxy through the `tap.*` handle via
postMessage. The handle is the only escape hatch from the Worker, and
it routes through the daemon → extension → browser path, where each
hop can apply its own policy.

Disable with `--no-sandbox` for debugging only.

### Layer 2: Static analysis (CI)

Every PR to [tap-skills](https://github.com/LeonTing1010/tap-skills)
is checked by CI. Violations block merge:

| Rule | Blocks | Why |
|------|--------|-----|
| no-eval | `eval()` (tap.eval allowed) | Code injection |
| no-dynamic-code | `new Function()` | Hidden logic |
| no-base64 | `atob()` | Obfuscated payloads |
| no-websocket | `new WebSocket()` | Persistent exfiltration |
| no-xhr | `XMLHttpRequest` | Bypass fetch checks |
| no-dynamic-import | `import()` (ObjC.import allowed) | Load external code |
| no-exfiltration | `fetch()` to unrelated domains | Data theft |

`tap contribute` runs these same checks locally before creating a PR.

### Layer 3: Data isolation (filesystem)

```
~/.tap/
  taps/           your forged taps; LOCAL ONLY, no git remote
                  .gitignore blocks all non-.tap.js files
  skills/         git clone of tap-skills (community taps)
                  contribute adds only specific .tap.js files,
                  never git add -A
  playwright/     browser sessions (cookies, tokens, auth state)
                  NOT inside any git repo, never synced
  logs/           execution logs — NOT tracked by git
```

### Layer 4: Distribution integrity

| Property | Status |
|----------|--------|
| macOS code signing | ✅ Release binaries are signed via `codesign` |
| SHA256SUMS | ✅ install.sh verifies binary + extension hash |
| Daemon binds 127.0.0.1 only | ✅ No remote network exposure |
| Local-only daemon ports (`:9333`/`:9334`) | ✅ Enforced by daemon code |
| Chrome Extensions API first | ✅ `chrome.scripting` is undetectable; CDP only for input events |
| No telemetry | ✅ Zero analytics, zero tracking, zero phone-home |
| No remote code execution | ✅ `.tap.js` loaded from local disk only |

## Known Limitations

We're honest about what's not yet done:

| Gap | Risk | Roadmap |
|-----|------|---------|
| No reproducible builds | Compromised build environment could ship malicious binary unnoticed | v0.12 |
| SHA256SUMS not GPG-signed | If GitHub release signing is compromised, both binary AND hash file can be replaced | v0.12 |
| AI-generated tap code runs without explicit approval | A malicious site could embed prompt injection that causes forge AI to generate exfiltration code; sandbox still applies, but the user runs it without reviewing | v0.12 (first-run approval gate) |
| No third-party security audit | Architecture has not been formally reviewed | v0.13 (hire firm) |
| No bug bounty | Reporters are credited but not paid | v0.14 (after audit) |
| Linux binaries unsigned | macOS uses `codesign`, Windows uses Authenticode (planned), Linux has no equivalent yet | v0.14 (Sigstore) |

## Scope

### In scope

- Remote code execution via crafted `.tap.js` files
- Sandbox escape from Worker isolation
- Credential exfiltration via community taps or AI-generated taps
- Data leakage through git repos (`taps/`, `skills/`)
- Privilege escalation beyond Chrome extension permissions
- Cross-tab data leakage in multi-tab scenarios
- Daemon binding to non-localhost addresses without explicit user consent
- Update mechanism integrity (binary or skill update poisoning)
- License validation bypass enabling tier escalation
- Prompt injection in `forge.inspect` page content that causes AI to
  generate malicious tap code

### Out of scope

- Vulnerabilities in websites that taps interact with
- Denial of service against the local daemon
- Issues requiring a physically present attacker
- Issues requiring an attacker who already has local code execution
  (they've already won)
- Vulnerabilities in third-party dependencies that don't affect Tap's
  threat model (we'll still investigate; they're just lower priority)
- Issues in user-installed plugins (`~/.tap/plugins/`); plugins are
  fully trusted by design and users opt-in by installing them

## Reporting a Vulnerability

**Do NOT open a public issue.**

Use one of:

1. **[GitHub Security Advisories](https://github.com/LeonTing1010/tap/security/advisories/new)** (preferred — handles disclosure flow automatically)
2. Email **security@taprun.dev**

Please include:

- Description of the vulnerability
- Steps to reproduce (proof of concept, even minimal, helps a lot)
- Impact assessment from your perspective
- Affected versions
- Your name and contact (for credit; anonymous reports are also welcome)

We commit to:

- **Acknowledge receipt within 48 hours**
- **Initial triage within 7 days** (severity assessment, planned fix path)
- **Fix critical issues within 30 days** (high severity within 60, medium within 90)
- **Credit you in the fix notes** unless you prefer anonymity
- **Coordinate disclosure timing** with you — we won't publish details
  before you're ready, and we won't sit on a fix indefinitely either

## Security Roadmap

| Version | Item | Status |
|---------|------|--------|
| v0.11 | SHA256SUMS verification in install.sh | ✅ shipped |
| v0.11 | Pro tier locked to 100% local (no Tap-hosted AI proxy) | ✅ shipped |
| v0.11 | This document | ✅ shipped |
| v0.12 | First-run approval gate for AI-generated taps | planned |
| v0.12 | GPG-signed SHA256SUMS | planned |
| v0.12 | Reproducible builds | planned |
| v0.13 | Sigstore / cosign signing of releases | planned |
| v0.13 | Third-party security audit | planned |
| v0.14 | Bug bounty program | planned |

## Why we wrote this

Most security policies are written *after* an incident, by lawyers, to
limit liability. We wrote this *before* shipping any server-side
features, by engineers, to constrain ourselves.

The five architectural invariants above are not aspirations. They are
**rules we have agreed not to break**, even when it would be convenient,
even when a feature would be cooler with a server, even when a competitor
ships something flashy that requires breaking them. If we ever do break
them, we will say so loudly in the release notes — and we will have
thought hard about why first.

If you read this and think we're being paranoid, that's the intended
reaction. The blast radius of a tool that operates your authenticated
browser justifies paranoia.

If you read this and think we're missing something, please tell us.
