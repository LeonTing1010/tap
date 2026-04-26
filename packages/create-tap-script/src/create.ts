/**
 * Pure helpers — no I/O, no process exits. Tested via node --test.
 */

export interface ParsedArgs {
  site: string;
  name: string;
  url: string;
  intent: "read" | "write";
  outDir: string;
  force: boolean;
  help: boolean;
}

export interface StarterOptions {
  site: string;
  name: string;
  url: string;
  intent: "read" | "write";
}

/**
 * Parse argv into a ParsedArgs. Throws Error with a human-readable
 * message on user-fixable problems (so cli.ts can render usage).
 */
export function parseArgs(argv: string[]): ParsedArgs {
  let site = "";
  let name = "";
  let url = "";
  let intent: "read" | "write" = "read";
  let outDir = process.cwd();
  let force = false;
  let help = false;

  const positional: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--help" || a === "-h") {
      help = true;
    } else if (a === "--force") {
      force = true;
    } else if (a === "--intent") {
      const v = argv[++i];
      if (v !== "read" && v !== "write") {
        throw new Error(`--intent must be "read" or "write" (got "${v}")`);
      }
      intent = v;
    } else if (a === "--out") {
      const v = argv[++i];
      if (!v) throw new Error("--out requires a directory argument");
      outDir = v;
    } else if (a.startsWith("--")) {
      throw new Error(`unknown option: ${a}`);
    } else {
      positional.push(a);
    }
  }

  if (help) {
    return { site, name, url, intent, outDir, force, help };
  }

  if (positional.length < 2) {
    throw new Error(
      `expected 2 positional arguments (<site>/<name> <url>), got ${positional.length}`,
    );
  }

  const id = positional[0];
  if (!/^[a-z0-9][a-z0-9_-]*\/[a-z0-9][a-z0-9_-]*$/.test(id)) {
    throw new Error(
      `invalid identifier "${id}" — must match <site>/<name> with lowercase alnum / dash / underscore`,
    );
  }
  [site, name] = id.split("/");
  url = positional[1];
  if (!/^https?:\/\//.test(url)) {
    throw new Error(`url "${url}" must start with http:// or https://`);
  }

  return { site, name, url, intent, outDir, force, help };
}

/**
 * Build a minimal but real plan-v1 envelope as a starting point.
 * Output passes runConformance() from @taprun/spec.
 */
export function buildStarterPlan(opts: StarterOptions): unknown {
  const { site, name, url, intent } = opts;
  return {
    "@context": [
      "http://www.w3.org/ns/anno.jsonld",
      "https://taprun.dev/ns/tap-v1",
    ],
    type: "Annotation",
    motivation: "tap:executing",
    target: url,
    body: {
      type: "tap:ExecutionPlan",
      site,
      name,
      intent,
      description: `Starter plan scaffolded by create-tap-script. Customize body.ops.`,
      ops: [
        { op: "nav", url },
      ],
    },
    generator: {
      id: "https://taprun.dev/create-tap-script",
      type: "SoftwareAgent",
      version: "0.1.0",
    },
    created: new Date().toISOString(),
  };
}
