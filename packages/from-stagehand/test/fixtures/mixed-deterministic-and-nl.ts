// Fixture: typical Stagehand script mixing deterministic page.* calls
// with natural-language stagehand.* calls. The deterministic ones map
// to plan ops; the NL ones map to allowUnverifiable exec ops with the
// original prompt preserved.
//
// Note: prompts must be on the same line as the call for the regex
// scanner to capture them — multi-line prompts fall through to the
// permissive "[unmatched]" exec path. Single-line is the recommended
// style.

import { Stagehand } from "@browserbasehq/stagehand";
import { z } from "zod";

const stagehand = new Stagehand({ env: "LOCAL" });
await stagehand.init();
const page = stagehand.context.pages()[0];

await page.goto("https://github.com/browserbase");
await stagehand.act("click on the stagehand repo");
const { author, title } = await stagehand.extract("the author and title of the latest PR", z.object({ author: z.string(), title: z.string() }));
await page.screenshot();

await stagehand.close();
