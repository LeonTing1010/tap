// Drift check between docs/_data/cli.yml (canonical) and downstream surfaces.
//
//   deno run --allow-read --allow-net=raw.githubusercontent.com,api.github.com,registry.npmjs.org \
//     scripts/lint-cli-drift.ts [--in-repo-only]
//
// Exit codes:
//   0 — all checks passed (or only network errors with --soft-network)
//   1 — drift detected in surfaces that MUST match cli.yml
//   2 — usage / IO error
//
// What canonical means: cli.yml.version + install.{npx,curl,brew,mcp_config_json}
// + binary + binary_pkg are the source of truth. README, manifest, formula, registry
// must match. Direction is one-way; cli.yml never bends to a downstream value.

import { parse as parseYaml } from "jsr:@std/yaml@^1";

const args = new Set(Deno.args);
const inRepoOnly = args.has("--in-repo-only");
const softNetwork = args.has("--soft-network");

const repoRoot = new URL("..", import.meta.url).pathname;

type Check = { name: string; ok: boolean; detail: string };
const checks: Check[] = [];
const networkErrors: string[] = [];

function pass(name: string, detail = "") { checks.push({ name, ok: true, detail }); }
function fail(name: string, detail: string) { checks.push({ name, ok: false, detail }); }

// ─── Load canonical ──────────────────────────────────────────────────────
const cliYmlPath = `${repoRoot}docs/_data/cli.yml`;
const cliYmlText = await Deno.readTextFile(cliYmlPath);
const cli = parseYaml(cliYmlText) as {
  binary: string;
  binary_pkg: string;
  version: string;
  install: { npx: string; curl: string; brew: string; mcp_config_json: string };
};

if (!cli.version || !/^\d+\.\d+\.\d+$/.test(cli.version)) {
  console.error(`cli.yml.version malformed: ${cli.version}`);
  Deno.exit(2);
}

console.log(`canonical version: ${cli.version}`);
console.log(`canonical binary_pkg: ${cli.binary_pkg}`);
console.log("");

// ─── In-repo: extension manifest version ─────────────────────────────────
{
  const path = `${repoRoot}extension/manifest.json`;
  const m = JSON.parse(await Deno.readTextFile(path)) as { version: string };
  if (m.version === cli.version) {
    pass("extension/manifest.json version", `${m.version}`);
  } else {
    fail("extension/manifest.json version",
      `expected ${cli.version} (cli.yml), found ${m.version}`);
  }
}

// ─── In-repo: README must literally cite install commands ────────────────
{
  const path = `${repoRoot}README.md`;
  const text = await Deno.readTextFile(path);
  const expectedSnippets: Array<[string, string]> = [
    ["install.npx", cli.install.npx],
    ["install.brew", cli.install.brew],
    ["binary_pkg", cli.binary_pkg],
  ];
  for (const [label, snippet] of expectedSnippets) {
    if (text.includes(snippet)) {
      pass(`README.md cites ${label}`, snippet);
    } else {
      fail(`README.md cites ${label}`, `string not found: "${snippet}"`);
    }
  }
}

// ─── In-repo: extension description.txt ──────────────────────────────────
{
  const path = `${repoRoot}extension/description.txt`;
  try {
    const text = await Deno.readTextFile(path);
    if (text.includes(cli.install.npx)) {
      pass("extension/description.txt cites install.npx", cli.install.npx);
    } else {
      fail("extension/description.txt cites install.npx",
        `string not found: "${cli.install.npx}"`);
    }
  } catch (e) {
    if (!(e instanceof Deno.errors.NotFound)) throw e;
  }
}

// ─── In-repo: each @taprun/* package README cites its own install line ──
{
  const pkgsDir = `${repoRoot}packages`;
  for await (const entry of Deno.readDir(pkgsDir)) {
    if (!entry.isDirectory) continue;
    const pkgJsonPath = `${pkgsDir}/${entry.name}/package.json`;
    let pkgName: string;
    try {
      const pkg = JSON.parse(await Deno.readTextFile(pkgJsonPath)) as { name: string };
      pkgName = pkg.name;
    } catch { continue; }
    if (!pkgName.startsWith("@taprun/") && pkgName !== "create-tap-script") continue;

    const readmePath = `${pkgsDir}/${entry.name}/README.md`;
    let readme: string;
    try { readme = await Deno.readTextFile(readmePath); } catch { continue; }

    // Package README must mention its own canonical npm name somewhere
    if (!readme.includes(pkgName)) {
      fail(`packages/${entry.name}/README.md cites own pkg name`,
        `string not found: "${pkgName}"`);
    } else {
      pass(`packages/${entry.name}/README.md cites own pkg name`, pkgName);
    }
  }
}

// ─── Cross-repo: GitHub releases latest tag ──────────────────────────────
async function fetchOrSkip(label: string, url: string): Promise<unknown | null> {
  try {
    const r = await fetch(url, { headers: { "user-agent": "tap-cli-drift-lint" } });
    if (!r.ok) {
      networkErrors.push(`${label}: HTTP ${r.status}`);
      return null;
    }
    return await r.json();
  } catch (e) {
    networkErrors.push(`${label}: ${(e as Error).message}`);
    return null;
  }
}

if (!inRepoOnly) {
  const release = await fetchOrSkip(
    "github releases",
    "https://api.github.com/repos/LeonTing1010/tap/releases/latest",
  ) as { tag_name?: string } | null;
  if (release?.tag_name) {
    const tag = release.tag_name.replace(/^v/, "");
    if (tag === cli.version) {
      pass("github latest release tag", `v${tag}`);
    } else {
      fail("github latest release tag",
        `expected v${cli.version} (cli.yml), found ${release.tag_name}`);
    }
  }

  const npm = await fetchOrSkip(
    "npm registry",
    `https://registry.npmjs.org/${cli.binary_pkg}/latest`,
  ) as { version?: string } | null;
  if (npm?.version) {
    if (npm.version === cli.version) {
      pass(`npm registry ${cli.binary_pkg}@latest`, npm.version);
    } else {
      fail(`npm registry ${cli.binary_pkg}@latest`,
        `expected ${cli.version} (cli.yml), found ${npm.version}`);
    }
  }

  // Homebrew formula: parse Ruby `version "X.Y.Z"` line from raw GitHub
  try {
    const r = await fetch(
      "https://raw.githubusercontent.com/LeonTing1010/homebrew-tap/main/Formula/taprun.rb",
      { headers: { "user-agent": "tap-cli-drift-lint" } },
    );
    if (r.ok) {
      const text = await r.text();
      const m = text.match(/^\s*version\s+"([^"]+)"/m);
      if (!m) {
        fail("homebrew formula version", "no `version \"...\"` line found in taprun.rb");
      } else if (m[1] === cli.version) {
        pass("homebrew formula version", m[1]);
      } else {
        fail("homebrew formula version",
          `expected ${cli.version} (cli.yml), found ${m[1]}`);
      }
    } else {
      networkErrors.push(`homebrew formula: HTTP ${r.status}`);
    }
  } catch (e) {
    networkErrors.push(`homebrew formula: ${(e as Error).message}`);
  }
}

// ─── Report ──────────────────────────────────────────────────────────────
const failed = checks.filter(c => !c.ok);
const passed = checks.filter(c => c.ok);

for (const c of passed) console.log(`  ok   ${c.name}: ${c.detail}`);
for (const c of failed) console.log(`  FAIL ${c.name} — ${c.detail}`);
for (const e of networkErrors) console.log(`  warn network: ${e}`);

console.log("");
console.log(`${passed.length} passed, ${failed.length} failed, ${networkErrors.length} network warnings`);

if (failed.length > 0) Deno.exit(1);
if (networkErrors.length > 0 && !softNetwork) {
  console.log("(network warnings did not fail; pass --soft-network to make explicit)");
}
Deno.exit(0);
