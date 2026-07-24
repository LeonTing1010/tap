// Layer 4 — op-matrix: every critical op dispatched through the REAL MV3
// service worker, in real Chromium, against a real tab.
//
// Born 2026-07-22. Chrome Web Store 0.22.0 shipped with ensureDeep loading
// the shared resolver via runtime import() — forbidden in
// ServiceWorkerGlobalScope (w3c/ServiceWorker#1356) — killing every
// resolver-needing op (op:input *, op:wait{selector}) in the field while
// ALL Node-side layers stayed green: Layer 1 reads background.js as TEXT,
// Layer 2 (golden-replay) exercises engine fetch paths only, Layer 3a/3b
// cover the popup. No layer executed an op inside a real SW. This one does.
//
// Mechanism: background.js's chrome.runtime.onMessage listener routes
// { method, params, id } → handleMethod — the same single dispatch entry the
// native-messaging bridge uses. An extension page (popup.html) can therefore
// drive the REAL op pipeline — ensureDeep, __tapDeep resolver, execFunc
// injection, CDP — with zero test doubles.
//
// Failure of ANY row here must block store publish (publish-extension.yml
// runs this suite as a required pre-job).

import { test, expect, chromium } from "@playwright/test";
import path from "node:path";
import fs from "node:fs";
import os from "node:os";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const extensionPath = path.resolve(__dirname, "..");

// 1x1 transparent PNG — stamp fixture for op:pdf mode:stamp.
const TINY_PNG_B64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk" +
  "YPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";

async function loadExtension() {
  const userDataDir = await fs.promises.mkdtemp(
    path.join(os.tmpdir(), "tap-ext-opmatrix-"),
  );
  const context = await chromium.launchPersistentContext(userDataDir, {
    // MV3 SWs don't register reliably in headless:true; CI runs under xvfb.
    headless: false,
    args: [
      `--disable-extensions-except=${extensionPath}`,
      `--load-extension=${extensionPath}`,
    ],
  });
  let [serviceWorker] = context.serviceWorkers();
  if (!serviceWorker) {
    serviceWorker = await context.waitForEvent("serviceworker", {
      timeout: 15_000,
    });
  }
  const extensionId = serviceWorker.url().split("/")[2];
  return { context, extensionId, userDataDir };
}

test.describe("op-matrix (real SW dispatch)", () => {
  let context, extensionId, driver, tabId;

  test.beforeAll(async () => {
    ({ context, extensionId } = await loadExtension());
    // The driver is an extension page: chrome.runtime.sendMessage from here
    // enters the SAME onMessage → handleMethod path the NM bridge uses.
    driver = await context.newPage();
    await driver.goto(`chrome-extension://${extensionId}/popup.html`);
  });

  test.afterAll(async () => {
    await context?.close();
  });

  /** Dispatch one wire method into the real SW; returns { result?, error? }. */
  const send = (method, params) =>
    driver.evaluate(
      ({ method, params }) =>
        new Promise((resolve) => {
          chrome.runtime.sendMessage(
            { id: `opmatrix-${Date.now()}`, method, params },
            (resp) => resolve(resp),
          );
        }),
      { method, params },
    );

  test("nav — creates/binds a real tab", async () => {
    const resp = await send("nav", { url: "https://example.com" });
    expect(resp.error, `nav failed: ${resp.error}`).toBeUndefined();
    tabId = resp.result?.tabId;
    expect(tabId, "nav must return the bound tabId").toBeTruthy();
  });

  test("wait{selector} — resolver-injected selector wait", async () => {
    // The 0.22.0 field failure killed this path (ensureDeep import()).
    const resp = await send("wait", {
      tabId,
      selector: "h1",
      timeout_ms: 8000,
    });
    expect(resp.error, `wait{selector} failed: ${resp.error}`).toBeUndefined();
  });

  test("input kind:click — TargetResolver through __tapDeep", async () => {
    // Click the h1 (harmless, no navigation) with a resolver object so the
    // full pick/visible pipeline runs — the exact op class dead in 0.22.0.
    const resp = await send("input", {
      tabId,
      kind: "click",
      target: { selector: "h1", visible: true },
    });
    expect(resp.error, `input click failed: ${resp.error}`).toBeUndefined();
  });

  test("eval — execFunc/CDP page evaluation", async () => {
    const resp = await send("eval", {
      tabId,
      expression:
        "document.body.insertAdjacentHTML('beforeend'," +
        "'<input id=\"e2e-in\">'); 'injected'",
    });
    expect(resp.error, `eval failed: ${resp.error}`).toBeUndefined();
  });

  test("input kind:fill — writes through the resolver", async () => {
    const resp = await send("input", {
      tabId,
      kind: "fill",
      target: "#e2e-in",
      value: "hello",
    });
    expect(resp.error, `input fill failed: ${resp.error}`).toBeUndefined();
    const check = await send("eval", {
      tabId,
      expression: "document.querySelector('#e2e-in').value",
    });
    expect(check.result, "fill must land in the input").toContain("hello");
  });

  test("input kind:type — key-by-key path", async () => {
    const resp = await send("input", {
      tabId,
      kind: "type",
      target: "#e2e-in",
      value: " world",
    });
    expect(resp.error, `input type failed: ${resp.error}`).toBeUndefined();
  });

  test("ax — CDP accessibility survey", async () => {
    const resp = await send("ax", { tabId, limit: 10 });
    expect(resp.error, `ax failed: ${resp.error}`).toBeUndefined();
  });

  test("notify — side-panel message store", async () => {
    const resp = await send("notify", { message: "op-matrix e2e" });
    expect(resp.error, `notify failed: ${resp.error}`).toBeUndefined();
  });

  let exportedPdfB64;

  test("pdf mode:export — CDP printToPDF", async () => {
    const resp = await send("pdf", { tabId, mode: "export" });
    expect(resp.error, `pdf export failed: ${resp.error}`).toBeUndefined();
    // The handler returns base64 PDF bytes somewhere in result — accept the
    // common shapes without pinning the envelope.
    exportedPdfB64 =
      typeof resp.result === "string"
        ? resp.result
        : resp.result?.pdfBytes ?? resp.result?.data ?? resp.result?.base64;
    expect(
      typeof exportedPdfB64 === "string" && exportedPdfB64.length > 500,
      "pdf export must return base64 bytes",
    ).toBe(true);
  });

  test("pdf mode:stamp — pdf-lib load INSIDE the SW", async () => {
    // Second instance of the 0.22.0 bug class: this path loaded pdf-lib via
    // runtime import() in the SW. This row exists so the class can never
    // ship silently again.
    test.skip(!exportedPdfB64, "no exported pdf from previous row");
    const resp = await send("pdf", {
      mode: "stamp",
      pdfBytes: exportedPdfB64,
      stamp: { imageBytes: TINY_PNG_B64, page: 1, x: 10, y: 10, width: 40 },
    });
    expect(resp.error, `pdf stamp failed: ${resp.error}`).toBeUndefined();
  });

  // ── 2026-07-23 wxamp dogfood class: wait mutation-classes + click effect ──

  test("wait{selector} — PROPERTY state (:checked) resolves via the poll arm", async () => {
    // :checked flips via the DOM property — NO mutation record of any kind
    // fires. Pre-fix (childList-only observer, no poll) this timed out.
    const inj = await send("eval", {
      tabId,
      expression:
        "document.body.insertAdjacentHTML('beforeend'," +
        "'<input id=\"e2e-cb\" type=\"checkbox\">');" +
        "setTimeout(() => { document.getElementById('e2e-cb').checked = true }, 1200);" +
        "'armed'",
    });
    expect(inj.error, `inject failed: ${inj.error}`).toBeUndefined();
    const resp = await send("wait", {
      tabId,
      selector: "#e2e-cb:checked",
      timeout_ms: 8000,
    });
    expect(resp.error, `wait on :checked failed: ${resp.error}`).toBeUndefined();
  });

  test("wait{selector} — ATTRIBUTE toggle (display) wakes the observer", async () => {
    // weui-class dialogs stay mounted and toggle display — an attribute
    // mutation on a pre-existing node. Pre-fix the childList-only observer
    // never woke; only the timeout fired.
    const inj = await send("eval", {
      tabId,
      expression:
        "document.body.insertAdjacentHTML('beforeend'," +
        "'<div id=\"e2e-dlg\" style=\"display:none\"><button id=\"e2e-dlg-btn\">OK</button></div>');" +
        "setTimeout(() => { document.getElementById('e2e-dlg').style.display = 'block' }, 1200);" +
        "'armed'",
    });
    expect(inj.error, `inject failed: ${inj.error}`).toBeUndefined();
    const resp = await send("wait", {
      tabId,
      selector: { selector: "#e2e-dlg-btn", visible: true },
      timeout_ms: 8000,
    });
    expect(resp.error, `wait on visible-after-toggle failed: ${resp.error}`).toBeUndefined();
  });

  test("input kind:click — inert JS click auto-escalates to CDP (isTrusted gate)", async () => {
    // The handler acts ONLY on a trusted event — the exact gesture-gated
    // shape that made wxamp 提交审核 a silent no-op at L1. The effect watch
    // must observe zero effect, escalate once via CDP, and report it.
    const inj = await send("eval", {
      tabId,
      expression:
        "document.body.insertAdjacentHTML('beforeend'," +
        "'<button id=\"e2e-gated\">go</button>');" +
        "document.getElementById('e2e-gated').addEventListener('click'," +
        "e => { if (e.isTrusted) document.title = 'ESCALATED' });" +
        "'armed'",
    });
    expect(inj.error, `inject failed: ${inj.error}`).toBeUndefined();
    const resp = await send("input", {
      tabId,
      kind: "click",
      target: "#e2e-gated",
    });
    expect(resp.error, `gated click failed: ${resp.error}`).toBeUndefined();
    const ce = resp.result?._tap_anomalies?.click_effect;
    expect(ce?.silent_js_click, "inert JS click must be reported").toBe(true);
    expect(ce?.escalated, "escalation must have been attempted").toBe(true);
    const title = await send("eval", { tabId, expression: "document.title" });
    expect(title.result, "CDP escalation must have fired the trusted handler")
      .toContain("ESCALATED");
  });

  test("input kind:click — blocked window.open surfaces as popup_blocked (no escalation)", async () => {
    // A synthetic click carries no user activation → the popup blocker eats
    // window.open (returns null). Pre-fix this was invisible (clicked:true,
    // nothing else). The handler RAN, so no escalation may fire (double-click
    // hazard) — the anomaly carries the eaten URL instead.
    // Playwright launches Chromium with popup blocking disabled, so the
    // blocker is simulated deterministically: a null-returning window.open
    // is exactly what a blocked open looks like to the effect watch.
    const inj = await send("eval", {
      tabId,
      expression:
        "document.title = 'reset';" +
        "window.open = () => null;" +
        "document.body.insertAdjacentHTML('beforeend'," +
        "'<button id=\"e2e-popper\">pop</button>');" +
        "document.getElementById('e2e-popper').addEventListener('click'," +
        "() => { window.open('https://example.com/#e2e-pop') });" +
        "'armed'",
    });
    expect(inj.error, `inject failed: ${inj.error}`).toBeUndefined();
    const resp = await send("input", {
      tabId,
      kind: "click",
      target: "#e2e-popper",
    });
    expect(resp.error, `popper click failed: ${resp.error}`).toBeUndefined();
    const ce = resp.result?._tap_anomalies?.click_effect;
    expect(
      (ce?.popup_blocked || []).some((u) => u.includes("#e2e-pop")),
      `blocked open must be captured, got: ${JSON.stringify(ce)}`,
    ).toBe(true);
    expect(ce?.escalated, "a ran-handler click must NOT escalate").toBeUndefined();
  });

  // ── extract from:"network" — CDP response-harvest three-phase (ADR 2026-07-23) ──
  // Real-SW proof of the arm → (requests fire) → read → stop round-trip. Capturing
  // a SPECIFIC entry needs a JSON endpoint (CI-unstable network), so this asserts
  // the three modes execute in the real SW and return the contracted shapes; the
  // per_item application over entries is unit-tested (op_extract_network_routing).

  test("extract from:network — arm starts CDP capture in the real SW", async () => {
    const resp = await send("extract", { tabId, from: "network", mode: "arm" });
    expect(resp.error, `network arm failed: ${resp.error}`).toBeUndefined();
    expect(resp.result?.armed, "arm must report armed:true").toBe(true);
  });

  test("extract from:network — a page request is captured and read as typed rows", async () => {
    // Fire a same-origin JSON request from the page; CDP sees it regardless of
    // CORS. example.com serves HTML for the doc, but a fetch with an explicit
    // path still produces a Network.responseReceived the capture buffer records
    // IF its content-type is API-like. We assert the READ returns an ARRAY
    // (the contracted shape) and that arm/read wired end-to-end; entry presence
    // is best-effort (endpoint content-type is not under test control).
    await send("eval", {
      tabId,
      expression:
        "fetch('https://example.com/?e2e-netcap', { headers: { accept: 'application/json' } })" +
        ".catch(() => {}); 'fired'",
    });
    // Give the request time to complete + body-fetch to settle.
    await new Promise((r) => setTimeout(r, 800));
    const resp = await send("extract", {
      tabId,
      from: "network",
      root: "entries",
      per_item: { url: { attr: "url" }, method: { attr: "method" }, status: { attr: "status" } },
      wait_ms: 800,
    });
    expect(resp.error, `network read failed: ${resp.error}`).toBeUndefined();
    expect(Array.isArray(resp.result), "network read must return a typed array").toBe(true);
    // Shape check on any captured entry (best-effort; may be empty if the
    // endpoint's content-type was filtered as a document).
    for (const row of resp.result ?? []) {
      expect(typeof row).toBe("object");
      expect("url" in row && "method" in row, "each row carries url+method").toBe(true);
    }
  });

  test("extract from:network — stop ends capture cleanly", async () => {
    const resp = await send("extract", { tabId, from: "network", mode: "stop" });
    expect(resp.error, `network stop failed: ${resp.error}`).toBeUndefined();
    expect(resp.result?.stopped, "stop must report stopped:true").toBe(true);
  });
});
