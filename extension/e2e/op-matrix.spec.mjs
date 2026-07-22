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
});
