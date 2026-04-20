#!/usr/bin/env -S deno run -A
/**
 * publish-tap: push a forged tap to tap-skills + generate its taprun.dev page.
 *
 * Usage:
 *   deno run -A scripts/publish-tap.ts <site> <name>
 *   deno run -A scripts/publish-tap.ts <site> <name> --layer 1 --layer-source "Atom feed"
 *   deno run -A scripts/publish-tap.ts <site> <name> --dry-run
 *
 * Reads  ~/.tap/taps/{site}/{name}.tap.json
 * Writes <repo-root>/public/docs/taps/{site}/{name}.html + .jsonld
 *        <repo-root>/../tap-skills/showcase/{site}/{name}.tap.json
 * Opens a PR in each repo (main is protected in tap-skills).
 */

import { parse } from "https://deno.land/std@0.224.0/flags/mod.ts"
import { dirname, fromFileUrl, join, resolve } from "https://deno.land/std@0.224.0/path/mod.ts"

const args = parse(Deno.args, {
  boolean: ["dry-run", "skip-pr", "auto-merge", "help"],
  string: ["layer", "layer-source", "doctor", "checked"],
  default: { layer: "?", "layer-source": "unspecified", doctor: "", checked: "" },
})

if (args.help || args._.length < 2) {
  console.log(`
publish-tap <site> <name> [options]

  --layer <n>         Data layer number (1-4)
  --layer-source <s>  Human description of source (e.g. "Atom feed", "GraphQL", "DOM")
  --doctor <verdict>  healthy | stale | broken  (omit = unknown)
  --checked <date>    YYYY-MM-DD of last doctor run (defaults to today)
  --dry-run           Write files but don't commit or push
  --skip-pr           Commit + push branches, skip PR creation
  --auto-merge        Enable GitHub auto-merge on created PRs (merges on CI green)
`)
  Deno.exit(args.help ? 0 : 1)
}

const site = String(args._[0])
const name = String(args._[1])
const today = args.checked || new Date().toISOString().slice(0, 10)

const scriptDir = dirname(fromFileUrl(import.meta.url))
const publicRoot = resolve(scriptDir, "..")
const workspace = resolve(publicRoot, "..")
const tapSkillsRoot = join(workspace, "tap-skills")

const tapFile = join(Deno.env.get("HOME")!, ".tap/taps", site, `${name}.tap.json`)

const sourcePresets: Record<string, { layer: string; layerSource: string }> = {
  "Atom feed": { layer: "1", layerSource: "Atom feed" },
  "RSS feed": { layer: "1", layerSource: "RSS feed" },
  "GraphQL": { layer: "2", layerSource: "GraphQL" },
  "SSR state": { layer: "2", layerSource: "SSR state blob" },
  "DOM": { layer: "4", layerSource: "DOM extraction" },
}

// ---------- load + validate ----------

let plan: any
try {
  plan = JSON.parse(await Deno.readTextFile(tapFile))
} catch (e) {
  console.error(`✗ cannot read ${tapFile}: ${(e as Error).message}`)
  Deno.exit(1)
}

const body = plan?.body
if (!body || body.site !== site || body.name !== name) {
  console.error(`✗ tap plan mismatch: expected ${site}/${name}, got ${body?.site}/${body?.name}`)
  Deno.exit(1)
}

// sensitive-info heuristics
const asText = JSON.stringify(plan)
const warnings: string[] = []
if (/leonting1010|@leon|zhongchang/i.test(asText)) warnings.push("user handle detected")
if (/Bearer\s+[A-Za-z0-9_\-.]{20,}/i.test(asText)) warnings.push("bearer token-looking string")
if (/sk-[A-Za-z0-9]{20,}/.test(asText)) warnings.push("OpenAI-style API key")
if (/cookie:|set-cookie/i.test(asText)) warnings.push("cookie reference")

if (warnings.length) {
  console.error(`⚠ sensitive-info warnings:`)
  for (const w of warnings) console.error(`   - ${w}`)
  console.error(`   Review ${tapFile} before publishing. Pass --force to override.`)
  if (!Deno.args.includes("--force")) Deno.exit(2)
}

// ---------- generate files ----------

const description: string = body.description || ""
const intent: string = body.intent || "read"
const columns: string[] = body.columns || []
const argsObj: Record<string, any> = body.args || {}
const health = body.health || {}
const layer = String(args.layer) || "?"
const layerSource = String(args["layer-source"]) || "unspecified"
const doctorVerdict = String(args.doctor) || ""

function yamlEscape(s: string): string {
  return `"${s.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`
}

const argsYaml = Object.entries(argsObj)
  .map(([n, def]: [string, any]) => {
    const lines = [`  - name: ${n}`]
    if (def.type) lines.push(`    type: ${def.type}`)
    if (def.default !== undefined) lines.push(`    default: ${yamlEscape(String(def.default))}`)
    if (def.description) lines.push(`    description: ${yamlEscape(def.description)}`)
    return lines.join("\n")
  })
  .join("\n")

const columnsYaml = columns.map((c) => `  - ${c}`).join("\n")

const argsJsonInline = JSON.stringify(argsObj)
const healthJsonInline = JSON.stringify(health)

const htmlFrontmatter = `---
layout: tap
site_name: ${site}
tap_name: ${name}
description: ${yamlEscape(description)}
intent: ${intent}
layer: ${layer}
layer_source: ${yamlEscape(layerSource)}
columns:
${columnsYaml}
${Object.keys(argsObj).length ? "args:\n" + argsYaml : "args: []"}
args_json: |
  ${argsJsonInline}
health_json: |
  ${healthJsonInline}
${doctorVerdict ? `doctor_verdict: ${doctorVerdict}\ndoctor_checked: ${yamlEscape(today)}` : ""}
source_url: https://github.com/LeonTing1010/tap-skills/blob/main/showcase/${site}/${name}.tap.json
license: MIT
---
`

const htmlPage = `${htmlFrontmatter}
<section>
  <h2>About this tap</h2>
  <p>${escapeHtml(description)}</p>
</section>
`

const jsonldOut = {
  "@context": ["http://www.w3.org/ns/anno.jsonld", "https://taprun.dev/ns/tap-v1"],
  "@type": "Annotation",
  id: `https://taprun.dev/taps/${site}/${name}`,
  motivation: "tap:executing",
  target: `https://taprun.dev/taps/${site}/${name}`,
  body: {
    ...body,
    "tap:layer": Number(layer) || layer,
    "tap:layerSource": layerSource,
  },
  seeAlso: [
    `https://github.com/LeonTing1010/tap-skills/blob/main/showcase/${site}/${name}.tap.json`,
    `https://taprun.dev/taps/${site}/${name}`,
  ],
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
}

const presPageDir = join(publicRoot, "docs/taps", site)
const presHtmlPath = join(presPageDir, `${name}.html`)
const presJsonldPath = join(presPageDir, `${name}.jsonld`)
const skillsDir = join(tapSkillsRoot, "showcase", site)
const skillsPath = join(skillsDir, `${name}.tap.json`)

console.log(`✓ plan parsed: ${site}/${name}`)
console.log(`  columns: ${columns.join(", ")}`)
console.log(`  args: ${Object.keys(argsObj).join(", ") || "(none)"}`)
console.log(`  layer: L${layer} (${layerSource})`)
if (doctorVerdict) console.log(`  doctor: ${doctorVerdict} as of ${today}`)

if (args["dry-run"]) {
  console.log("\n--- HTML page preview ---")
  console.log(htmlPage.slice(0, 400) + "...")
  console.log("\n--- dry-run, no files written ---")
  Deno.exit(0)
}

await Deno.mkdir(presPageDir, { recursive: true })
await Deno.mkdir(skillsDir, { recursive: true })
await Deno.writeTextFile(presHtmlPath, htmlPage)
await Deno.writeTextFile(presJsonldPath, JSON.stringify(jsonldOut, null, 2) + "\n")
await Deno.writeTextFile(skillsPath, JSON.stringify(plan, null, 2) + "\n")
console.log(`✓ wrote ${presHtmlPath}`)
console.log(`✓ wrote ${presJsonldPath}`)
console.log(`✓ wrote ${skillsPath}`)

// ---------- git ----------

async function run(cmd: string[], cwd: string): Promise<{ code: number; stdout: string; stderr: string }> {
  const p = new Deno.Command(cmd[0], { args: cmd.slice(1), cwd, stdout: "piped", stderr: "piped" })
  const { code, stdout, stderr } = await p.output()
  return { code, stdout: new TextDecoder().decode(stdout), stderr: new TextDecoder().decode(stderr) }
}

async function commitAndPush(cwd: string, branch: string, paths: string[], title: string, body: string) {
  const statusBefore = await run(["git", "status", "--porcelain", ...paths], cwd)
  if (!statusBefore.stdout.trim()) {
    console.log(`  (${cwd.split("/").at(-1)}: no changes, skipping)`)
    return { skipped: true }
  }
  const baseBranch = (await run(["git", "rev-parse", "--abbrev-ref", "HEAD"], cwd)).stdout.trim()
  await run(["git", "checkout", "-b", branch], cwd)
  await run(["git", "add", ...paths], cwd)
  const commit = await run(["git", "commit", "-m", `${title}\n\n${body}`], cwd)
  if (commit.code !== 0) {
    console.error(commit.stderr)
    return { error: commit.stderr }
  }
  const push = await run(["git", "push", "-u", "origin", branch], cwd)
  if (push.code !== 0) {
    console.error(push.stderr)
    return { error: push.stderr }
  }
  console.log(`  ${cwd.split("/").at(-1)}: pushed ${branch}`)
  return { skipped: false, branch, baseBranch }
}

const branchName = `showcase/${site}-${name}`
const commitTitle = `showcase: add ${site}/${name}`

const publicResult = await commitAndPush(
  publicRoot,
  branchName,
  ["docs/taps/" + site + "/" + name + ".html", "docs/taps/" + site + "/" + name + ".jsonld"],
  `taps: add ${site}/${name} presentation page`,
  `Auto-generated by scripts/publish-tap.ts.\n\nLayer ${layer} (${layerSource}). See https://taprun.dev/taps/${site}/${name}`,
)

const skillsResult = await commitAndPush(
  tapSkillsRoot,
  branchName,
  ["showcase/" + site + "/" + name + ".tap.json"],
  `showcase: add ${site}/${name}`,
  `L${layer} tap (${layerSource}).\n\n${description}`,
)

if (args["skip-pr"]) {
  console.log("skip-pr: branches pushed, skipping PR creation")
  Deno.exit(0)
}

async function ghPr(cwd: string, base: string, head: string, title: string, body: string): Promise<string | null> {
  const r = await run(["gh", "pr", "create", "--base", base, "--head", head, "--title", title, "--body", body], cwd)
  if (r.code === 0) {
    const url = r.stdout.trim()
    console.log(`  PR: ${url}`)
    return url
  }
  console.error(`  gh pr create failed: ${r.stderr}`)
  return null
}

async function enableAutoMerge(cwd: string, prUrl: string) {
  // --auto requires branch protection with required checks OR repo auto-merge enabled.
  // Fall back to immediate squash-merge if auto can't be scheduled.
  const tryAuto = await run(["gh", "pr", "merge", prUrl, "--auto", "--squash", "--delete-branch"], cwd)
  if (tryAuto.code === 0) {
    console.log(`  auto-merge queued: ${prUrl}`)
    return
  }
  const stderr = tryAuto.stderr.toLowerCase()
  if (stderr.includes("auto-merge") || stderr.includes("not eligible")) {
    const immediate = await run(["gh", "pr", "merge", prUrl, "--squash", "--delete-branch"], cwd)
    if (immediate.code === 0) console.log(`  merged immediately: ${prUrl}`)
    else console.error(`  merge failed: ${immediate.stderr}`)
  } else {
    console.error(`  auto-merge failed: ${tryAuto.stderr}`)
  }
}

if (publicResult && !publicResult.skipped && !publicResult.error) {
  const prUrl = await ghPr(
    publicRoot,
    publicResult.baseBranch!,
    branchName,
    `taps: add ${site}/${name} presentation`,
    `Auto-generated page for \`${site}/${name}\`. Layer ${layer} (${layerSource}).\n\nPreview: https://taprun.dev/taps/${site}/${name}`,
  )
  if (prUrl && args["auto-merge"]) await enableAutoMerge(publicRoot, prUrl)
}

if (skillsResult && !skillsResult.skipped && !skillsResult.error) {
  const prUrl = await ghPr(
    tapSkillsRoot,
    skillsResult.baseBranch!,
    branchName,
    `showcase: add ${site}/${name} (L${layer} ${layerSource})`,
    `${description}\n\nHealth: \`${JSON.stringify(health)}\``,
  )
  if (prUrl && args["auto-merge"]) await enableAutoMerge(tapSkillsRoot, prUrl)
}

console.log("done.")
