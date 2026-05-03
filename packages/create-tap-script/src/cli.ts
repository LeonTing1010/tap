#!/usr/bin/env node
/**
 * create-tap-script — scaffold a starter Tap v2 .plan.json.
 *
 * Usage:
 *   npx create-tap-script <site>/<name> "<description>" [--write] [--out DIR]
 *
 * Example:
 *   npx create-tap-script github/issues "List issues for a repo"
 *
 * Creates:
 *   <DIR>/<site>/<name>.plan.json   (the starter v2 Plan)
 *   <DIR>/<site>/<name>.README.md   (next-steps notes)
 *
 * Per ADR 2026-05-04 (ecosystem-v2-launch §2.4 + §2.5) this scaffolder
 * emits the v2 Plan shape directly (NOT the v1 W3C Annotation envelope,
 * NOT a `.tap.json` file). The runtime reads bare Plan documents.
 */
import { writeFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import process from "node:process";

import {
  buildStarterPlan,
  parseArgs,
  type ParsedArgs,
} from "./create.ts";

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

  const { site, name, description, variant, outDir } = parsed;
  const planPath = join(outDir, site, `${name}.plan.json`);
  const readmePath = join(outDir, site, `${name}.README.md`);

  if (existsSync(planPath) && !parsed.force) {
    console.error(
      `error: ${planPath} already exists. Pass --force to overwrite.`,
    );
    return 1;
  }

  const plan = buildStarterPlan({ site, name, description, variant });
  await mkdir(dirname(planPath), { recursive: true });
  await writeFile(planPath, JSON.stringify(plan, null, 2) + "\n", "utf8");
  await writeFile(
    readmePath,
    buildReadme({ site, name, description, variant }),
    "utf8",
  );

  console.log(`wrote ${planPath}`);
  console.log(`wrote ${readmePath}`);
  console.log("");
  console.log("Next steps:");
  console.log(`  - Open ${planPath} and customize observe / args / return.`);
  if (variant === "read") {
    console.log(
      `  - To convert to a write tap, add act + key fields (see commented block in README).`,
    );
  }
  console.log(`  - Run via the Tap CLI: tap-v2 run ${site}/${name}`);
  return 0;
}

function printUsage(): void {
  console.error(`Usage: create-tap-script <site>/<name> ["description"] [options]

Arguments:
  <site>/<name>     Tap identifier (e.g. github/issues)
  "description"     Optional human description of what the tap does

Options:
  --write           Scaffold a write-variant plan (act + key required)
  --variant <r|w>   Equivalent to --write; "read" (default) or "write"
  --out <DIR>       Output directory (default: cwd)
  --force           Overwrite existing files
  --help            Show this help

Examples:
  create-tap-script github/issues "List issues for a repo"
  create-tap-script gmail/send "Send an email" --write
`);
}

function buildReadme(opts: {
  site: string;
  name: string;
  description: string;
  variant: "read" | "write";
}): string {
  const { site, name, description, variant } = opts;
  const variantLine = variant === "read"
    ? "Read variant — no side effects. Doctor auto-runs on this tap."
    : "Write variant — has side effects. Includes act + key for intent dedup.";

  const writeBlock = variant === "read"
    ? `
## Convert to a write tap

A write tap mutates state and uses an intent key to dedup re-runs. To
convert this read tap, add the \`act\` and \`key\` fields:

\`\`\`jsonc
{
  // ...keep id, description, args, requires, observe, return as-is...
  "act": [
    {
      "op": "fetch",
      "url": "https://api.${site}.example.com/{{ args.someArg }}",
      "method": "POST",
      "format": "json",
      "credentials": "page-session",
      "body": { "example": "{{ args.someArg }}" },
      "save": "$2"
    }
  ],
  "key": "args.someArg",
  "dedup_ttl_seconds": 86400,
  "return": "$2.body"
}
\`\`\`

\`act\` non-empty implies \`key\` (CEL expression) is required — the
\`Plan\` discriminated union in \`@taprun/spec\` enforces this at the
type level. Same key + unexpired ttl ⇒ runtime skips re-execution.
`
    : "";

  return `# ${site}/${name}.plan.json — starter v2 plan

Scaffolded by \`create-tap-script\` on ${new Date().toISOString().slice(0, 10)}.

${description}

## Plan

- **site**: \`${site}\`
- **name**: \`${name}\`
- **variant**: ${variantLine}
- **runtime**: \`extension\` (reuses your authenticated browser session via \`credentials: "page-session"\`)

## Next steps

1. Open \`${name}.plan.json\` and customize:
   - \`args\` — declare the inputs your tap accepts (with CEL constraints
     via \`arg_constraints\` if needed)
   - \`observe\` — the read-current-state op sequence (fetch / nav /
     extract / etc.)
   - \`return\` — a CEL expression projecting the observed state into
     the value the tap returns

   See https://taprun.dev/spec/ for the 11-op closed union and CEL
   reference.

2. Validate the plan structure:
   \`\`\`bash
   npx -p @taprun/spec validate ./${name}.plan.json
   \`\`\`

3. Run via the Tap CLI:
   \`\`\`bash
   brew install LeonTing1010/tap/tap
   tap-v2 run ${site}/${name} --someArg some-value
   \`\`\`

4. Monitor for drift:
   \`\`\`bash
   tap-v2 doctor ${site}/${name}
   \`\`\`
${writeBlock}
## Have an existing Playwright/Puppeteer script?

Use one of the @taprun/from-* adapters to convert it:
- \`@taprun/from-playwright\`
- \`@taprun/from-puppeteer\`

(Stagehand is cloud-coupled and is not supported in v2 — see ADR
2026-05-04 §6.2.)
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
