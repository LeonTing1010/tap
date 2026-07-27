#!/usr/bin/env python3
"""
Generate llms.txt "## Available taps" registry section from public/docs/taps/**/*.jsonld.

Output goes to stdout by default. CI / dev runs:
    python3 scripts/generate-llms-tap-registry.py            # stdout preview
    python3 scripts/generate-llms-tap-registry.py --write    # in-place patch docs/llms.txt

`--write` mode replaces the block between the markers
<!-- TAP_REGISTRY_START --> and <!-- TAP_REGISTRY_END --> in docs/llms.txt.
The markers must already exist (added once by hand in wave-2 ship).

Why this script exists: Claude / Cursor / Continue MCP hosts fetch llms.txt
as site context. Wave-1 (2026-05) llms.txt described the 4 meta verbs but
listed 0 specific taps — LLMs couldn't recommend `reddit/hot` to a user
asking "how do I get top Reddit posts". This script adds inline tap catalog
so the agent-discoverability path is 1-hop (read llms.txt → see tap names)
instead of 2-hop (read llms.txt → fetch GitHub API → see tap names).
"""

import json
import re
import sys
from collections import defaultdict
from pathlib import Path

CATEGORIES = {
    "Social": [
        "reddit", "hackernews", "lobsters", "v2ex", "weibo", "xiaohongshu",
        "zhihu", "douban", "facebook", "instagram", "linkedin", "tiktok",
        "quora", "slack", "discord", "telegraph",
    ],
    "News": ["bbc", "reuters", "techcrunch", "arstechnica", "36kr", "toutiao"],
    "Dev tools": [
        "github", "npmjs", "pypi", "crates", "juejin", "devto",
        "stackoverflow", "glama", "producthunt",
    ],
    "Finance / Investing": ["xueqiu", "scys", "coingecko"],
    "Media / Entertainment": [
        "bilibili", "imdb", "rottentomatoes", "steam", "pixiv", "espn",
    ],
    "Productivity": [
        "notion", "feishu", "sspai", "calendar", "weather", "notes",
        "reminders", "shortcuts", "macos",
    ],
    "Knowledge": ["arxiv", "wikipedia", "medium", "google"],
    "Misc": ["clawhub", "creem", "daily", "tap"],
}
ORDER = list(CATEGORIES.keys())
SITE_TO_CAT = {s: c for c, sites in CATEGORIES.items() for s in sites}

DOCS_TAPS = Path(__file__).resolve().parent.parent / "docs" / "taps"


def first_sentence(text: str, max_len: int = 80) -> str:
    s = (text or "").split(".")[0].strip()
    return (s[: max_len - 3] + "...") if len(s) > max_len else s


def agent_description(text: str) -> str:
    """agents.json item copy: keep the full first sentence, hard-truncate at
    137 chars with '...' only when longer (matches committed catalog)."""
    fs = (text or "").split(".")[0].strip()
    return fs[:137] + "..." if len(fs) > 137 else fs


LLMS_TXT = DOCS_TAPS.parent / "llms.txt"
AGENTS_JSON = DOCS_TAPS.parent / ".well-known" / "agents.json"
MARKER_START = "<!-- TAP_REGISTRY_START -->"
MARKER_END = "<!-- TAP_REGISTRY_END -->"


def render(by_cat: dict[str, list[tuple[str, str, str, str]]], total: int) -> str:
    out: list[str] = []
    out.append("## Available taps")
    out.append("")
    out.append(
        "Example taps (the public [tap-skills](https://github.com/LeonTing1010/tap-skills) "
        "repo is now a claims ledger — dated falsifiable claims re-verified nightly at "
        "zero tokens; the v1 skills catalog is archived on its v1-archive branch. Agents "
        "forge new taps on demand via `capture`). Each tap is a `<site>/<name>.plan.json` "
        "runnable via `run({ref: \"<site>/<name>\", args: {...}})`. Per-tap page at "
        "`https://taprun.dev/taps/<site>/<name>`."
    )
    out.append("")
    for cat in ORDER:
        rows = by_cat.get(cat, [])
        if not rows:
            continue
        out.append(f"### {cat}")
        out.append("")
        for site, name, intent, desc in sorted(rows):
            intent_str = f" *({intent})*" if intent else ""
            out.append(f"- `{site}/{name}`{intent_str} — {desc}")
        out.append("")
    out.append(f"<!-- {total} taps as of generation -->")
    return "\n".join(out)


def patch_llms_txt(content: str) -> None:
    if not LLMS_TXT.exists():
        raise SystemExit(f"llms.txt not found: {LLMS_TXT}")
    text = LLMS_TXT.read_text()
    if MARKER_START not in text or MARKER_END not in text:
        raise SystemExit(
            f"markers not found in {LLMS_TXT}; add {MARKER_START} / {MARKER_END} once by hand"
        )
    pre, _, rest = text.partition(MARKER_START)
    _, _, post = rest.partition(MARKER_END)
    new = f"{pre}{MARKER_START}\n{content}\n{MARKER_END}{post}"
    LLMS_TXT.write_text(new)
    print(f"# wrote {LLMS_TXT}", file=sys.stderr)


def patch_agents_json(items: list[dict], total: int) -> None:
    if not AGENTS_JSON.exists():
        raise SystemExit(f"agents.json not found: {AGENTS_JSON}")
    data = json.loads(AGENTS_JSON.read_text())
    for entry in data.get("data", []):
        if entry.get("name") == "taps":
            entry["items"] = items
            desc = entry.get("description", "")
            entry["description"] = re.sub(r"^\s*\d+", str(total), desc)
            break
    else:
        raise SystemExit("no 'taps' entry found in agents.json data")
    AGENTS_JSON.write_text(json.dumps(data, indent=2, ensure_ascii=False) + "\n")
    print(f"# wrote {AGENTS_JSON}", file=sys.stderr)


def main() -> int:
    write = "--write" in sys.argv[1:]
    if not DOCS_TAPS.exists():
        print(f"# not found: {DOCS_TAPS}", file=sys.stderr)
        return 1

    records: list[tuple[str, str, str, str, list[str]]] = []
    for f in sorted(DOCS_TAPS.glob("*/*.jsonld")):
        try:
            data = json.loads(f.read_text())
        except Exception as e:
            print(f"# parse fail {f}: {e}", file=sys.stderr)
            continue
        body = data.get("body", {})
        site, name = body.get("site"), body.get("name")
        if not site or not name:
            continue
        intent = body.get("intent", "")
        raw_desc = body.get("description", "")
        args_keys = list(body.get("args", {}).keys())
        records.append((site, name, intent, raw_desc, args_keys))

    total = len(records)

    # llms.txt registry (grouped by category) — 80-char first-sentence cutoff
    by_cat: dict[str, list[tuple[str, str, str, str]]] = defaultdict(list)
    for site, name, intent, raw_desc, _ in records:
        by_cat[SITE_TO_CAT.get(site, "Misc")].append((site, name, intent, first_sentence(raw_desc)))
    llms_content = render(by_cat, total)

    # agents.json inline catalog (sorted by site, then name) — 137-char cutoff
    agent_items = []
    for site, name, intent, raw_desc, args_keys in sorted(records, key=lambda r: (r[0], r[1])):
        agent_items.append({
            "ref": f"{site}/{name}",
            "intent": intent,
            "description": agent_description(raw_desc),
            "args": args_keys,
            "page": f"https://taprun.dev/taps/{site}/{name}",
        })

    if write:
        patch_llms_txt(llms_content)
        patch_agents_json(agent_items, total)
    else:
        print(llms_content)
    return 0


if __name__ == "__main__":
    sys.exit(main())
