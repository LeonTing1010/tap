#!/usr/bin/env node
/**
 * create-tap-script — scaffold a starter .tap.json plan.
 *
 * Usage:
 *   npx create-tap-script <site>/<name> <url> [--intent read|write] [--out DIR]
 *
 * Example:
 *   npx create-tap-script github/trending https://github.com/trending
 *
 * Creates:
 *   <DIR>/<site>/<name>.tap.json   (the starter plan envelope)
 *   <DIR>/<site>/<name>.README.md  (next-steps notes)
 *
 * Why: the friction model that won Stagehand 745K weekly downloads is
 * "one command, ready to go." `npx create-tap-script <id> <url>`
 * mirrors that. Adapter ecosystems can layer on top
 * (`npx create-tap-script --from-playwright tests/x.spec.ts ...`)
 * but the bare scaffolder needs to be cheap, deterministic, and zero-dep.
 */
import { writeFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { buildStarterPlan, parseArgs, type ParsedArgs } from "./create.ts";

async function main(argv: string[]): Promise<number> {
  let parsed: ParsedArgs;
  try {
    parsed = parseArgs(argv);
  } catch (e) {
    console.error(`error: ${(e as Error).message}`);
    printUsage();
    return 1;
  }

  if (parsed.help) {
    printUsage();
    return 0;
  }

  const { site, name, url, intent, outDir } = parsed;
  const planPath = join(outDir, site, `${name}.tap.json`);
  const readmePath = join(outDir, site, `${name}.README.md`);

  if (existsSync(planPath) && !parsed.force) {
    console.error(
      `error: ${planPath} already exists. Pass --force to overwrite.`,
    );
    return 1;
  }

  const plan = buildStarterPlan({ site, name, url, intent });
  await mkdir(dirname(planPath), { recursive: true });
  await writeFile(planPath, JSON.stringify(plan, null, 2) + "\n", "utf8");
  await writeFile(readmePath, buildReadme({ site, name, url, intent }), "utf8");

  console.log(`✓ wrote ${planPath}`);
  console.log(`✓ wrote ${readmePath}`);
  console.log("");
  console.log("Next steps:");
  console.log(`  - Open ${planPath} and customize the ops array.`);
  console.log(`  - Validate: npx -p @taprun/spec -e "console.log('ok')"`);
  console.log(`  - Run with the Tap CLI: tap run ${site}/${name}`);
  return 0;
}

function printUsage(): void {
  console.error(`Usage: create-tap-script <site>/<name> <url> [options]

Arguments:
  <site>/<name>     Tap identifier (e.g. github/trending)
  <url>             Target URL the plan operates on

Options:
  --intent <r|w>    "read" (default) or "write"
  --out <DIR>       Output directory (default: cwd)
  --force           Overwrite existing files
  --help            Show this help

Examples:
  npx create-tap-script github/trending https://github.com/trending
  npx create-tap-script hn/hot https://news.ycombinator.com --intent read
`);
}

function buildReadme(opts: {
  site: string;
  name: string;
  url: string;
  intent: "read" | "write";
}): string {
  const { site, name, url, intent } = opts;
  return `# ${site}/${name}.tap.json — starter plan

Scaffolded by \`create-tap-script\` on ${new Date().toISOString().slice(0, 10)}.

## Plan

- **site**: \`${site}\`
- **name**: \`${name}\`
- **target URL**: ${url}
- **intent**: \`${intent}\` (${intent === "read" ? "no side effects" : "writes / mutations"})

## Next steps

1. Open \`${name}.tap.json\` and customize the \`body.ops\` array. The starter ships with
   a single \`nav\` op pointing at ${url}. Add \`extract\` / \`fetch\` / \`input\` ops as needed.
   See https://taprun.dev/spec/plan-v1/ for the closed op union.

2. Validate the plan structure:
   \`\`\`bash
   node -e "import('@taprun/spec').then(m => { const p = JSON.parse(require('fs').readFileSync('${name}.tap.json', 'utf8')); console.log(m.runConformance(p)); })"
   \`\`\`

3. Run via the Tap CLI:
   \`\`\`bash
   brew install LeonTing1010/tap/tap   # or: npm install -g @taprun/cli
   tap run ${site}/${name}
   \`\`\`

4. Monitor for drift:
   \`\`\`bash
   tap doctor ${site}/${name}
   \`\`\`

## Have an existing Playwright/Puppeteer/Stagehand script?

Use one of the @taprun/from-* adapters to convert it:
- \`@taprun/from-playwright\`
- \`@taprun/from-puppeteer\`
- \`@taprun/from-stagehand\`
`;
}

// Allow loading as module (for tests) without auto-running main.
const isCli = process.argv[1] && (
  process.argv[1] === fileURLToPath(import.meta.url) ||
  process.argv[1].endsWith("create-tap-script")
);
if (isCli) {
  main(process.argv.slice(2)).then((code) => process.exit(code));
}

export { main, buildReadme };
