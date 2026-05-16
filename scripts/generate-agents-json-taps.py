#!/usr/bin/env python3
"""
Inject inline tap catalog into docs/.well-known/agents.json.

Wave-1 agents.json had a `data` entry pointing at the GitHub API for the
tap-skills corpus. LLMs reading agents.json then had to do a second HTTP
fetch + dir-listing parse to see specific tap names. This script replaces
that indirection with an inline `taps` array — 1-hop discovery.

CLI:
    python3 scripts/generate-agents-json-taps.py            # stdout preview
    python3 scripts/generate-agents-json-taps.py --write    # in-place patch

The patch is idempotent — re-running with new jsonld files refreshes the
inline catalog and preserves the rest of agents.json untouched.
"""

import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DOCS_TAPS = ROOT / "docs" / "taps"
AGENTS_JSON = ROOT / "docs" / ".well-known" / "agents.json"


def build_taps_catalog() -> list[dict]:
    """Read every docs/taps/<site>/<name>.jsonld and emit an inline catalog."""
    catalog: list[dict] = []
    for f in sorted(DOCS_TAPS.glob("*/*.jsonld")):
        try:
            data = json.loads(f.read_text())
        except Exception as e:
            print(f"# skip {f}: {e}", file=sys.stderr)
            continue
        body = data.get("body", {})
        site, name = body.get("site"), body.get("name")
        if not site or not name:
            continue
        # Compact description: first sentence, <=140 chars.
        desc = (body.get("description") or "").split(".")[0].strip()
        if len(desc) > 140:
            desc = desc[:137] + "..."
        args_keys = list((body.get("args") or {}).keys())
        catalog.append({
            "ref": f"{site}/{name}",
            "intent": body.get("intent", ""),
            "description": desc,
            "args": args_keys,
            "page": f"https://taprun.dev/taps/{site}/{name}",
        })
    return catalog


def patch_agents_json(catalog: list[dict]) -> dict:
    """Replace the 'community-taps' data entry with an inline 'taps' entry."""
    data = json.loads(AGENTS_JSON.read_text())
    entries = data.get("data", [])
    # Drop any prior community-taps or taps entries — idempotent.
    entries = [e for e in entries if e.get("name") not in {"community-taps", "taps"}]
    inline_entry = {
        "name": "taps",
        "description": f"{len(catalog)} pre-built automation programs (inline catalog — agents do not need a second HTTP fetch). Each `ref` is invokable via MCP `run({{ref, args}})`.",
        "format": "inline",
        "auth": "none",
        "source": "https://github.com/LeonTing1010/tap-skills",
        "items": catalog,
    }
    # Insert at the head of data array for visibility.
    entries.insert(0, inline_entry)
    data["data"] = entries
    return data


def main() -> int:
    write = "--write" in sys.argv[1:]
    if not AGENTS_JSON.exists():
        print(f"# missing: {AGENTS_JSON}", file=sys.stderr)
        return 1
    if not DOCS_TAPS.exists():
        print(f"# missing: {DOCS_TAPS}", file=sys.stderr)
        return 1
    catalog = build_taps_catalog()
    patched = patch_agents_json(catalog)
    out = json.dumps(patched, indent=2, ensure_ascii=False) + "\n"
    if write:
        AGENTS_JSON.write_text(out)
        print(f"# wrote {AGENTS_JSON} with {len(catalog)} inline taps", file=sys.stderr)
    else:
        sys.stdout.write(out)
    return 0


if __name__ == "__main__":
    sys.exit(main())
