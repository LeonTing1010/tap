# Privacy Policy — Tap Chrome Extension

**Last updated:** 2026-03-30

## Overview

Tap is an open-source browser automation protocol. The Chrome extension serves as a runtime that executes deterministic scripts (.tap.js) on web pages.

## Data Collection

**Tap does not collect, transmit, or store any personal data.** Specifically:

- No browsing history is recorded or transmitted
- No cookies or credentials are exfiltrated
- No analytics or telemetry data is sent to any server
- No user accounts or sign-ups are required

## Local-Only Architecture

All operations happen locally on your machine:

- The extension communicates only with a **local daemon** running on `127.0.0.1:9333`
- No external servers are contacted by the extension itself
- Tap scripts (.tap.js) may access websites directly (e.g., fetching public APIs), but this is user-initiated and visible

## Permissions

| Permission | Why |
|---|---|
| `debugger` | Chrome DevTools Protocol for native input simulation and page evaluation |
| `<all_urls>` | Tap scripts operate on user-specified websites |
| `cookies` | Auth state detection during tap forging |
| `tabs` | Multi-tab navigation and orchestration |
| `storage` | Local extension preferences |
| `scripting` | Content script injection for tap:// protocol |
| `alarms` | Scheduled reconnection to local daemon |

## Third-Party Services

Tap does not integrate with any third-party analytics, advertising, or tracking services.

## Open Source

The Chrome extension source code is available at [github.com/LeonTing1010/tap](https://github.com/LeonTing1010/tap) under MIT license. You can audit every line of extension code.

## Contact

For privacy concerns: [GitHub Issues](https://github.com/LeonTing1010/tap/issues)
