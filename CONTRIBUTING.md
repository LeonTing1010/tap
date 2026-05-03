# Contributing to Tap

Tap welcomes contributions at every level. Here are the main paths.

## Path 1: Capture a New Tap (Easiest)

A tap is a single `.plan.json` file. No build step needed.

### With AI (recommended)

If you have the Tap MCP server connected, ask your agent to call `capture`:

```
> capture { url: "https://example.com", site: "example", name: "hot", intent: "list trending items" }
> verify { site: "example", name: "hot" }
```

Done. The agent picks the strongest structural address (JSON API / RSS / JSON-LD / OpenGraph / HTML list) and emits a bare v2 Plan; `verify` writes the first Snapshot.

### Manually

1. Create `{site}/{name}.tap.js`
2. Follow one of two forms:

**Extract form** (read data — preferred):

```js
export default {
  site: "mysite",
  name: "hot",
  description: "Trending items from MySite",
  url: "https://mysite.com",
  health: { min_rows: 5, non_empty: ["title"] },

  extract: async () => {
    // API-first: use fetch() when possible
    const res = await fetch('https://mysite.com/api/trending', { credentials: 'include' })
    const data = await res.json()
    return data.items.map(item => ({
      title: item.title,
      author: item.author,
      url: item.url
    }))
  }
}
```

**Run form** (perform actions):

```js
export default {
  site: "mysite",
  name: "post",
  description: "Post content to MySite",
  columns: ["status", "url"],
  args: { content: { type: "string" } },

  async run(tap, args) {
    await tap.nav('https://mysite.com/compose')
    await tap.type('.editor', args.content)
    await tap.click('button.submit')
    await tap.wait(3000)
    const url = await tap.eval(() => location.href)
    return [{ status: 'posted', url }]
  }
}
```

3. Submit to [tap-skills](https://github.com/LeonTing1010/tap-skills) — one tap per PR.

### Tap Conventions

- **API > DOM.** Always prefer `fetch()` over DOM parsing. Only use DOM when no API exists.
- **One tap = one capability.** `github/trending` returns trending repos. `xiaohongshu/publish` publishes a note.
- **Health contracts.** Every extract tap should have `health: { min_rows: N, non_empty: ["col"] }`.
- **Return strings.** Numeric values should be `String(count)`, not raw numbers.
- **No chrome.\* in taps.** Taps use the tap API only. Never `chrome.scripting`, `chrome.debugger`, etc.
- **No args.limit.** The runtime handles limiting — don't add it to your args.
- **Composition.** If tap A needs data from tap B, use `tap.run("site", "name")`.

### Sites We Want

High-value taps the community can help forge:

| Site | Priority Taps | Notes |
|------|--------------|-------|
| LinkedIn | `search` | DOM extraction, requires login |
| Spotify (web) | `search`, `status` | Web player API |
| Substack | `feed`, `search` | Newsletter platform |
| Jike | `feed`, `search`, `post` | Chinese social, has API |
| BOSS Zhipin | `search`, `recommend` | Job platform |
| WeRead | `search`, `ranking` | Expand beyond shelf/highlights |
| Bloomberg | `markets`, `news` | Financial data |
| Hugging Face | `top`, `search` | AI/ML model discovery |

## Path 2: Improve the Chrome Extension

The Chrome extension (`extension/background.js`) is the primary runtime that connects the Tap executor to your real browser via Chrome APIs.

**What to improve:**
- Command handling and error recovery
- Tab management and lifecycle
- CDP session management
- Performance and reliability

**Testing:**

```bash
node extension/test/architecture.test.mjs     # Architecture constraints
node extension/test/protocol.test.mjs         # Protocol constraints
node extension/test/multi-tab.test.mjs        # Multi-tab constraints
```

To test locally: load `extension/` as an unpacked extension in Chrome Developer mode.

## Path 3: Implement a New Runtime

The most ambitious contribution. A new runtime brings Tap to an entirely new platform.

**What you implement:** 8 core methods.

```js
const core = {
  eval(fn, ...args) { /* execute fn in target context */ },
  pointer(x, y, action) { /* input event at coordinates */ },
  keyboard(key, action, modifiers) { /* key event */ },
  nav(url) { /* navigate */ },
  wait(ms) { /* delay */ },
  screenshot() { /* capture */ },
  tap(site, name, args) { /* run another tap */ },
  capabilities() { /* declare what this runtime supports */ }
}
```

**What you get for free:** All 17 built-in operations and every existing tap.

**Potential runtimes:**

| Runtime | Core via |
|---------|-----------|
| Android | AccessibilityService + UIAutomator |
| iOS | XCUITest + Accessibility APIs |
| Desktop (Windows) | UI Automation API |

Start a discussion in [Issues](https://github.com/LeonTing1010/tap/issues) before implementing a new runtime.

## Pull Request Guidelines

- One tap per PR (for new taps) — keeps review fast
- Run all tests before submitting
- Include the site URL and a brief description of your extraction selector
- For write taps: describe what the tap does and any prerequisites

## License

This repository is MIT. Community skills ([tap-skills](https://github.com/LeonTing1010/tap-skills)) are also MIT.
