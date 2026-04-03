# Security Policy

## Supported Versions

| Version | Supported |
|---------|-----------|
| Latest release | Yes |
| Older versions | No |

## Reporting a Vulnerability

If you discover a security vulnerability in Tap, please report it responsibly:

1. **Do NOT open a public issue.**
2. Email **security@leontingtap.com** or use [GitHub Security Advisories](https://github.com/LeonTing1010/tap/security/advisories/new) to report privately.
3. Include: description, reproduction steps, affected versions, and potential impact.

We will acknowledge receipt within 48 hours and aim to release a fix within 7 days for critical issues.

## Security Model

Community taps are **untrusted code**. Three layers of defense:

### Layer 1: Sandbox (runtime)

Run-format taps execute in a Deno Worker with **zero permissions**:

```
Worker (permissions: "none")
  tap.click("Submit")  →  postMessage  →  main thread  →  runtime
```

The Worker **cannot**: read files, access network, run subprocesses, read env vars. All interface operations proxy through the `tap.*` handle via postMessage. Disable with `--no-sandbox` for debugging.

### Layer 2: Static Analysis (CI)

Every PR to [tap-skills](https://github.com/LeonTing1010/tap-skills) is checked by CI:

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

### Layer 3: Data Isolation (filesystem)

```
~/.tap/
  taps/           git repo, LOCAL ONLY (no remote)
                  .gitignore blocks all non-.tap.js files
  skills/         git clone of tap-skills
                  contribute adds only specific .tap.js, never git add -A
  playwright/     browser sessions (cookies, tokens)
                  NOT inside any git repo
  logs/           execution logs — NOT tracked by git
```

### Other Properties

- **No remote code execution.** `.tap.js` loaded from local disk only.
- **Chrome Extensions API first.** `chrome.scripting` (undetectable) for eval. CDP only for input events.
- **Local-only daemon.** `localhost:9333`/`localhost:9334`. No remote connections.
- **No telemetry.** Zero analytics, zero tracking.

### Enforced by CI

All security properties are expressed as constraint tests. CI runs every test on every push — no exceptions, no ignores. Security is not a policy document; it's code that passes or fails.

## Scope

In scope:

- Remote code execution via crafted `.tap.js` files
- Sandbox escape from Worker isolation
- Credential exfiltration via community taps
- Data leakage through git repos (taps/, skills/)
- Privilege escalation beyond Chrome extension permissions
- Cross-tab data leakage in multi-tab scenarios

Out of scope:

- Vulnerabilities in websites that taps interact with
- Denial of service against the local daemon
