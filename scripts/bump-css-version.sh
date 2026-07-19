#!/usr/bin/env bash
# Bump the ?v= cache-busting string on every /assets/css/site.css reference.
#
# Why this exists: GitHub Pages serves CSS with cache-control max-age=86400 and
# does not let us set headers. Without a version string, a CSS change takes up
# to 24h to reach anyone who has visited before. HTML is only cached for 1h, so
# changing the query string in the HTML propagates the new CSS within the hour.
#
# Run this whenever you change docs/assets/css/site.css, then commit both.
set -euo pipefail
cd "$(dirname "$0")/.."
V="${1:-$(date +%Y%m%d%H%M)}"
n=$(grep -rl 'assets/css/site\.css' docs --include='*.html' | wc -l | tr -d ' ')
grep -rl 'assets/css/site\.css' docs --include='*.html' | while read -r f; do
  perl -pi -e 's{(<link[^>]*/assets/css/site\.css)(\?v=[0-9]+)?}{$1?v='"$V"'}g' "$f"
done
echo "bumped $n files -> ?v=$V"
echo "now: git add -A docs && git commit -m 'chore: bump css cache version'"
