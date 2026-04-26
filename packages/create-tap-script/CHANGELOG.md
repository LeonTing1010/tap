# create-tap-script — Changelog

## 0.1.1 — 2026-04-26

- README: add "Part of the Tap ecosystem" footer with UTM-tagged links to taprun.dev (homepage, Chrome extension, comparison page) plus cross-links to sibling JSR packages.
- deno.json: declare `@types/node` and enable `nodeModulesDir: "auto"` so `deno publish` resolves the `node:fs/promises` / `node:path` / `node:url` / `node:process` type references the CLI relies on.
- Cleanup: test imports `@taprun/spec` via package name (was relative path traversal). Added `@taprun/spec ^0.3.0` as devDep so npm workspaces resolve it.

## 0.1.0 — 2026-04-26

Initial release.

`npx create-tap-script <site>/<name> <url> [options]` scaffolds a starter `.tap.json` envelope + a next-steps README.

Output passes `runConformance` from `@taprun/spec` out of the box.

Strict input validation:

- Identifier MUST match `/^[a-z0-9][a-z0-9_-]*\/[a-z0-9][a-z0-9_-]*$/` (rejects uppercase, missing slash, path traversal).
- URL MUST start with `http://` or `https://`.
- `--intent` restricted to `read | write`.
- `--force` required to overwrite existing files.

Public API (importable for programmatic use):

- `parseArgs(argv)` — pure parser, throws on bad input.
- `buildStarterPlan({site, name, url, intent})` — pure plan builder, output is plan-v1 conformant.
- `main(argv)` — full CLI entry with stdout + exit code.
