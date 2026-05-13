# Chrome Web Store Submission — Source of Truth

This file holds every text field required by the Chrome Web Store Developer
Dashboard for the Tap extension. When CWS asks for an update (new permission,
manifest change, policy refresh) **edit here, then copy-paste**. Do not edit
the dashboard without backporting the change here, or the next reviewer round
will diverge from the repo.

**Companion file:** `description.txt` holds the long-form Store-listing
description (the "Description" textarea). Everything else lives in this file.

**Both files are excluded from the packaged zip** by `.github/workflows/publish-extension.yml` — they ship with the source, not with the extension.

---

## 1 · Store Listing tab

| Field | Value |
|---|---|
| Item name | `Tap` |
| Summary (132 chars max) | `AI browser automation runtime. Programs beat prompts — deterministic replay at zero AI cost.` |
| Detailed description | see `description.txt` |
| Category | `Developer Tools` |
| Language | English (en) |
| Website | `https://taprun.dev` |
| Support email | `hello@taprun.dev` |

---

## 2 · Privacy practices tab

### 2.1 Single purpose

> Tap is a developer tool that lets users automate browsers by running pre-compiled deterministic programs against any website they have logged into. The extension exists for exactly one purpose: to bridge the user's locally-installed Tap CLI to the user's own browser tabs so that automation runs inside the same authenticated session the user already has open.

### 2.2 Permission justifications

For each permission declared in `manifest.json`, paste the matching block into
the corresponding text field on the Privacy practices tab. Keep each under
~1000 characters (current dashboard limit).

#### `nativeMessaging`

> The extension communicates with the user's locally-installed Tap CLI (`tap` binary, installed separately via Homebrew or curl) through Chrome's Native Messaging transport. This is the ONLY channel between the browser and the user's machine — no remote server is involved. The native host is launched by Chrome on demand, runs entirely on the user's device, and exchanges JSON messages over stdio to coordinate which tab the user wants automated. Without this permission the extension cannot connect to the CLI and the product does not function. We previously used a localhost WebSocket but migrated to Native Messaging because it is the OS-supervised, Chrome-recommended transport for browser↔local-binary communication and avoids opening a local network port.

#### `debugger`

> Used to drive the Chrome DevTools Protocol against tabs the user has explicitly selected for automation. Tap programs need DevTools-level operations (network interception, accurate input synthesis, full-page screenshots, runtime evaluation in the page's main world) that are not reachable through `chrome.scripting` or `chrome.tabs` alone. The extension only attaches the debugger to a tab after the user has chosen it via the popup or via an explicit CLI command; we never silently attach in the background. The standard "Tap started debugging this browser" banner remains visible the entire time the debugger is attached, giving the user a continuous in-browser signal.

#### `activeTab`

> Granted when the user clicks the Tap toolbar icon or invokes a Tap action against the focused tab. Used to read the URL, title, and DOM of the tab the user is currently looking at so the CLI can resolve the right page context (e.g. "extract the data on this page", "automate this form"). `activeTab` is scoped to the single tab the user just interacted with and expires when the user navigates away — strictly less invasive than `<all_urls>` host access for the same tab.

#### `tabs`

> Used to enumerate open tabs, read their URLs/titles, and switch focus between them as part of automating multi-step flows (e.g. "open the dashboard tab, scrape the table, then return to the editor tab"). The extension does not read tab content via this permission — that requires `activeTab`, `scripting`, or `debugger`. Without `tabs` the extension cannot match a user-issued automation request to the correct already-open tab.

#### `scripting`

> Used to inject the small content-script shim that Tap programs need to read and act on page DOM (querying selectors, dispatching DOM events, reading element text/attributes). Injection is only performed against tabs the user has selected for automation; no scripts are injected into background tabs the user has not opted into. Required for any DOM-level automation operation; without it the extension can only manipulate browser-level state (tabs, cookies) and cannot fulfil its core function.

#### `cookies`

> The local-first design depends on reusing the user's existing login cookies for the sites they choose to automate — credentials never leave the user's machine. The extension reads cookies for those sites so that the locally-running Tap CLI can replay authenticated HTTP requests against the same session the browser has open. Cookies are read only for the specific sites a user has invoked a Tap action against; we do not enumerate or export cookies for other sites, and cookies are never transmitted to any remote server.

#### `storage`

> Used to persist user-facing settings (popup state, connection status, the last-known CLI version) in `chrome.storage.local`. No user content, page data, cookies, or credentials are written to extension storage. Storage is local to the user's profile and is cleared when the extension is uninstalled.

#### `host_permissions: <all_urls>`

> Tap is a general-purpose browser automation tool — the user decides at runtime which site to automate. We cannot enumerate sites in advance because the value of the product is that it works against any site the user has access to. Host access is exercised only on tabs the user has explicitly selected for automation (via the popup or an explicit CLI command). No data is read, scraped, or transmitted from tabs the user has not opted into.

#### `externally_connectable: matches <all_urls>`

> Allows web pages on `taprun.dev` (and self-hosted dashboards) to send postMessage-style requests to the extension to query its connection status — used by the onboarding flow on the marketing site to show "extension installed ✓" without the user having to copy-paste anything. The extension only exposes a read-only `getStatus` message handler over this channel; no automation commands can be invoked from web content.

### 2.3 Data usage disclosures

Tick all that apply on the dashboard form. Tap's truthful answers:

| Disclosure question | Answer |
|---|---|
| Does this extension collect or use **personally identifiable information** (name, address, email, age, ID number)? | **No** |
| Does this extension collect or use **health information**? | **No** |
| Does this extension collect or use **financial / payment information**? | **No** |
| Does this extension collect or use **authentication information** (passwords, credentials, security questions, PINs)? | **No** — the extension reuses the user's existing browser cookies but never reads, exports, or transmits passwords or credentials. |
| Does this extension collect or use **personal communications** (emails, texts, chat messages)? | **No** |
| Does this extension collect or use **location** (region, IP, GPS coordinates)? | **No** |
| Does this extension collect or use **web history** (URLs visited, time spent, click data)? | **No** — only the URL of tabs the user has explicitly selected for automation is read at the moment of automation, and is sent only to the user's own local CLI; it is never logged or transmitted off-device. |
| Does this extension collect or use **user activity** (clicks, mouse position, keystrokes)? | **No** |
| Does this extension collect or use **website content** (page text, images, audio, video, scraped data)? | **Yes** — strictly on tabs the user has selected for automation, and the data is delivered only to the user's own locally-installed Tap CLI over Native Messaging. No website content is transmitted off-device. |

### 2.4 Three certifications (must tick all)

| Certification | Status |
|---|---|
| I do not sell or transfer user data to third parties, outside of the approved use cases. | ✅ True |
| I do not use or transfer user data for purposes that are unrelated to my item's single purpose. | ✅ True |
| I do not use or transfer user data to determine creditworthiness or for lending purposes. | ✅ True |

### 2.5 Privacy policy URL

> `https://taprun.dev/privacy`

(Backing file: `docs/privacy.html` — keep this URL stable; do not break the link without updating CWS.)

---

## 3 · Distribution tab

| Field | Value |
|---|---|
| Visibility | Public |
| Regions | All regions |
| Pricing | Free |
| Mature content | No |

---

## Update procedure

1. Manifest change (new permission, new host, new `externally_connectable`) →
   add the matching justification block to §2.2 here **before** bumping the
   manifest version.
2. Privacy-affecting code change (new data flow, new persistence target,
   new outbound network call) → update §2.3 / §2.4 here, then update
   `docs/privacy.html`.
3. Tag-push the new version. The `publish-extension.yml` workflow uploads
   the zip; the human operator copy-pastes the relevant sections of this
   file into the dashboard and re-submits for review.

CWS reviewers re-evaluate the entire Privacy practices tab on every major
manifest change. Keeping this file authoritative means each review round
is a single-file diff, not a hunt across the dashboard.
