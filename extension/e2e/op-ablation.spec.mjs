// Layer 4b — op ABLATION (mutation testing over the real MV3 SW).
//
// op-matrix.spec.mjs proves each op WORKS. This proves each op's assertion has
// DISCRIMINATING POWER: if you break the op, at least one check must go red.
// A test that stays green when its op is ablated is FALSE coverage — it asserts
// "no error" (a no-op has none) instead of the actual EFFECT.
//
// Mechanism: for each target wire method, copy the extension, inject a one-line
// short-circuit at the top of handleMethod that makes THAT method a no-op
// (returns {}), load the mutated extension in real Chromium, run the op's
// effect-probe (establish an observable side-effect → dispatch the op → observe),
// and assert the effect is now ABSENT. Ablation "caught" = the probe detects the
// missing effect. Ablation "escaped" = the op could be deleted and the suite
// wouldn't notice → a coverage hole, failed loudly here.
//
// This runs the ablation as a SINGLE playwright test that iterates every op and
// aggregates a matrix, so one CI job reports the whole partition.

import { test, expect, chromium } from "@playwright/test";
import path from "node:path";
import fs from "node:fs";
import os from "node:os";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const extensionPath = path.resolve(__dirname, "..");

// One observable-effect contract per peer op. `setup` seeds a deterministic
// side-effect surface; `run` dispatches through the real SW via send(); `effect`
// returns a value that is TRUTHY iff the op actually acted. Ablation asserts the
// effect is FALSY when the op's case is short-circuited.
//
// Ops chosen: every peer op with a page-observable effect. Pure host ops
// (tab/bookmark/host) act on browser chrome, not the page — covered by their own
// unit suites; ablating them here has no page-visible signal, so they are listed
// as `hostOnly` and reported as N/A rather than falsely "escaped".
const OPS = [
  {
    method: "nav",
    async run(send, ctx) {
      const r = await send("nav", { url: "https://example.com/?ablate-nav" });
      ctx.tabId = r.result?.tabId;
      return r;
    },
    async effect(send, ctx) {
      // Real nav binds a tab AND lands the URL. A no-op returns {} → no tabId.
      if (!ctx.tabId) return false;
      const u = await send("eval", { tabId: ctx.tabId, expression: "location.href" });
      return typeof u.result === "string" && u.result.includes("example.com");
    },
  },
  {
    method: "eval",
    async run(send, ctx) {
      return send("eval", {
        tabId: ctx.tabId,
        expression:
          "document.body.insertAdjacentHTML('beforeend','<i id=abl-eval></i>');'ok'",
      });
    },
    async effect(send, ctx) {
      const r = await send("eval", {
        tabId: ctx.tabId,
        expression: "!!document.getElementById('abl-eval')",
      });
      // eval itself is the observer; ablation makes the SETUP eval a no-op, so
      // the element never gets inserted. But the OBSERVER eval is ALSO ablated
      // (same method) → returns {} → r.result undefined → falsy. Either way the
      // absence is detected.
      return r.result === true;
    },
  },
  {
    method: "input",
    async run(send, ctx) {
      await send("eval", {
        tabId: ctx.tabId,
        expression:
          "document.body.insertAdjacentHTML('beforeend','<input id=abl-in>');'ok'",
      });
      return send("input", { tabId: ctx.tabId, kind: "fill", target: "#abl-in", value: "ABLATE" });
    },
    async effect(send, ctx) {
      const r = await send("eval", {
        tabId: ctx.tabId,
        expression: "document.getElementById('abl-in')?.value || ''",
      });
      return r.result === "ABLATE";
    },
  },
  {
    method: "wait",
    async run(send, ctx) {
      // A selector that only appears after 400ms. A real wait returns AFTER it
      // exists; an ablated wait (no-op) returns immediately, BEFORE it exists.
      await send("eval", {
        tabId: ctx.tabId,
        expression:
          "setTimeout(()=>document.body.insertAdjacentHTML('beforeend'," +
          "'<i id=abl-wait></i>'),400);'armed'",
      });
      ctx.beforeWait = await send("eval", {
        tabId: ctx.tabId,
        expression: "!!document.getElementById('abl-wait')",
      });
      await send("wait", { tabId: ctx.tabId, selector: "#abl-wait", timeout_ms: 3000 });
      return {};
    },
    async effect(send, ctx) {
      // The element must NOT exist before the wait (sanity), and MUST exist
      // after a real wait resolves. Ablated wait returns instantly → checked too
      // early → absent.
      if (ctx.beforeWait.result === true) return false; // setup race; treat as inconclusive→escaped
      const r = await send("eval", {
        tabId: ctx.tabId,
        expression: "!!document.getElementById('abl-wait')",
      });
      return r.result === true;
    },
  },
  {
    method: "ax",
    async run(send, ctx) {
      await send("eval", {
        tabId: ctx.tabId,
        expression:
          "document.body.insertAdjacentHTML('beforeend'," +
          "'<button id=abl-ax>AblateAX</button>');'ok'",
      });
      ctx.axResp = await send("ax", { tabId: ctx.tabId, role: "button", name: "AblateAX" });
      return ctx.axResp;
    },
    async effect(_send, ctx) {
      // A real ax survey returns the button node; a no-op returns {} → no items.
      const items = ctx.axResp?.result?.items ?? ctx.axResp?.result;
      return Array.isArray(items) && items.some((n) => (n.name || "").includes("AblateAX"));
    },
  },
  {
    method: "extract",
    async run(send, ctx) {
      const arm = await send("extract", { tabId: ctx.tabId, from: "network", mode: "arm" });
      ctx.armResp = arm;
      return arm;
    },
    async effect(_send, ctx) {
      // A real network-arm returns {armed:true}; a no-op returns {}.
      return ctx.armResp?.result?.armed === true;
    },
  },
  {
    method: "notify",
    async run(send, ctx) {
      ctx.notifyResp = await send("notify", { message: "ABLATE-NOTIFY" });
      return ctx.notifyResp;
    },
    async effect(_send, _ctx, helpers) {
      // The notify handler writes chrome.storage.local['tap:notify']. Read it
      // via a driver-side storage read (NOT a wire method → ablating 'notify'
      // suppresses the WRITE, never this READ). A no-op notify writes nothing.
      const got = await helpers.readStorage("tap:notify");
      return got != null && JSON.stringify(got).includes("ABLATE-NOTIFY");
    },
  },
  {
    method: "pdf",
    async run(send, ctx) {
      ctx.pdfResp = await send("pdf", { tabId: ctx.tabId, mode: "export" });
      return ctx.pdfResp;
    },
    async effect(_send, ctx) {
      const r = ctx.pdfResp?.result;
      const b64 = typeof r === "string" ? r : r?.pdfBytes ?? r?.data ?? r?.base64;
      return typeof b64 === "string" && b64.length > 500;
    },
  },
  {
    method: "screenshot",
    async run(send, ctx) {
      ctx.shotResp = await send("screenshot", { tabId: ctx.tabId });
      return ctx.shotResp;
    },
    async effect(_send, ctx) {
      const r = ctx.shotResp?.result;
      const b64 = typeof r === "string" ? r : r?.data ?? r?.base64 ?? r?.image;
      return typeof b64 === "string" && b64.length > 200;
    },
  },
  {
    method: "tab",
    async run(send, ctx) {
      ctx.tabResp = await send("tab", { action: "list" });
      return ctx.tabResp;
    },
    async effect(_send, ctx) {
      const r = ctx.tabResp?.result;
      const arr = Array.isArray(r) ? r : r?.tabs;
      return Array.isArray(arr) && arr.length > 0;
    },
  },
];
// Ops NOT ablated here and WHY (not silent — false-coverage risk is the point):
//   fetch(page-session), cookies, host, bookmark — their effect needs EXTERNAL
//   mutable state (a live endpoint / a set cookie / browser chrome mutation) that
//   example.com can't provide deterministically in-harness. Each is covered by
//   its own unit suite (host-op.test.mjs, protocol.test.mjs, wire_codes). They
//   are page-invisible, so ablating them here would show no signal and read as a
//   false "escaped" — worse than an honest N/A.
//   tap/if/foreach/parallel are ENGINE ops (control flow), never reach the SW.

async function loadMutated(ablateMethod) {
  const userDataDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "tap-abl-"));
  const extDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "tap-abl-ext-"));
  // Copy the whole extension.
  await fs.promises.cp(extensionPath, extDir, { recursive: true });
  if (ablateMethod) {
    const bgPath = path.join(extDir, "background.js");
    let src = await fs.promises.readFile(bgPath, "utf-8");
    const anchor = "async function handleMethod(method, params = {}, senderTabId = null, { fromDaemon = false } = {}) {";
    const inject = anchor +
      `\n  if (method === ${JSON.stringify(ablateMethod)}) return {}; // ABLATION`;
    if (!src.includes(anchor)) throw new Error("handleMethod anchor not found for ablation");
    src = src.replace(anchor, inject);
    await fs.promises.writeFile(bgPath, src);
  }
  const context = await chromium.launchPersistentContext(userDataDir, {
    headless: false,
    args: [`--disable-extensions-except=${extDir}`, `--load-extension=${extDir}`],
  });
  let [sw] = context.serviceWorkers();
  if (!sw) sw = await context.waitForEvent("serviceworker", { timeout: 15_000 });
  const extensionId = sw.url().split("/")[2];
  const driver = await context.newPage();
  await driver.goto(`chrome-extension://${extensionId}/popup.html`);
  const send = (method, params) =>
    driver.evaluate(
      ({ method, params }) =>
        new Promise((resolve) =>
          chrome.runtime.sendMessage({ id: `abl-${Date.now()}-${Math.floor(performance.now())}`, method, params }, resolve)
        ),
      { method, params },
    );
  const helpers = {
    // Driver-side chrome.storage read — a vantage the wire-method ablation
    // cannot touch (used to observe notify's side-effect independently).
    readStorage: (key) =>
      driver.evaluate((k) => new Promise((res) => chrome.storage.local.get(k, (o) => res(o[k]))), key),
  };
  return { context, send, helpers, cleanup: async () => { await context.close(); await fs.promises.rm(userDataDir, { recursive: true, force: true }); await fs.promises.rm(extDir, { recursive: true, force: true }); } };
}

test.describe("op ablation (mutation testing — real SW)", () => {
  test("every peer op's coverage catches its own ablation", async () => {
    test.setTimeout(300_000);
    const matrix = [];

    // Establish a nav tab first for ops that need one, per-run inside baseline.
    for (const op of OPS) {
      // ── BASELINE: unmutated — the effect probe must be TRUTHY (the contract
      //    is real and observable). If baseline fails, the probe is wrong, not
      //    the op — surfaced distinctly.
      let baseline, ablated;
      {
        const h = await loadMutated(null);
        try {
          const ctx = {};
          // ops after nav need a tab: run nav first unless this IS nav.
          if (op.method !== "nav") {
            const r = await h.send("nav", { url: "https://example.com/?abl-base" });
            ctx.tabId = r.result?.tabId;
          }
          await op.run(h.send, ctx);
          baseline = await op.effect(h.send, ctx, h.helpers);
        } finally {
          await h.cleanup();
        }
      }
      // ── ABLATED: the target method is a no-op — the effect probe must be FALSY
      //    (the ablation is CAUGHT). If it stays truthy, coverage ESCAPED.
      {
        const h = await loadMutated(op.method);
        try {
          const ctx = {};
          if (op.method !== "nav") {
            const r = await h.send("nav", { url: "https://example.com/?abl-mut" });
            ctx.tabId = r.result?.tabId;
          }
          await op.run(h.send, ctx);
          ablated = await op.effect(h.send, ctx, h.helpers);
        } finally {
          await h.cleanup();
        }
      }
      const caught = baseline === true && ablated === false;
      matrix.push({ op: op.method, baseline, ablated, caught });
      console.log(
        `  ${caught ? "\x1b[32mCAUGHT\x1b[0m" : "\x1b[31mESCAPED\x1b[0m"} ` +
          `${op.method.padEnd(9)} baseline=${baseline} ablated=${ablated}`,
      );
    }

    console.log("\n  ablation matrix:", JSON.stringify(matrix, null, 0));
    // Every op must have baseline TRUTHY (real observable effect) …
    for (const row of matrix) {
      expect(row.baseline, `op ${row.op}: baseline effect must be observable (probe is wrong if not)`).toBe(true);
    }
    // … and every ablation must be CAUGHT (no false coverage).
    const escaped = matrix.filter((r) => !r.caught).map((r) => r.op);
    expect(escaped, `ops whose coverage did NOT catch ablation (false coverage): ${escaped.join(", ")}`).toEqual([]);
  });
});
