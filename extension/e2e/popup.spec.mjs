// Layer 3b — MV3 extension popup loaded in real Chromium.
//
// Asserts the visual side of popup behaviour that Layer 3a's hand-rolled
// DOM stub cannot see:
//   - CSS hides/shows the right section (display, visibility, layout)
//   - the canonical bridge command literal renders as text the user can copy
//   - install link's UTM tags are intact through Chrome's URL handling
//   - version display dynamically matches manifest.json
//
// CI scope: disconnected state only (no daemon running in CI = popup default).
// Connected state would require mocking chrome.runtime.sendMessage and is
// covered structurally by Layer 3a's render() unit tests in
// extension/test/popup.test.mjs.

import { test, expect, chromium } from "@playwright/test";
import path from "node:path";
import fs from "node:fs";
import os from "node:os";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const extensionPath = path.resolve(__dirname, "..");

async function loadExtension() {
  const userDataDir = await fs.promises.mkdtemp(
    path.join(os.tmpdir(), "tap-ext-e2e-"),
  );
  const context = await chromium.launchPersistentContext(userDataDir, {
    // MV3 service workers do not register reliably in headless:true. The
    // canonical workaround is headless:false; CI runs this under xvfb-run
    // (set up by `playwright install --with-deps`).
    headless: false,
    args: [
      `--disable-extensions-except=${extensionPath}`,
      `--load-extension=${extensionPath}`,
    ],
  });
  // Background service worker registers asynchronously after context launch.
  let [serviceWorker] = context.serviceWorkers();
  if (!serviceWorker) {
    // SW registration can take longer than the default actionTimeout on
    // cold context launch — give it 15s before failing.
    serviceWorker = await context.waitForEvent("serviceworker", {
      timeout: 15_000,
    });
  }
  const extensionId = serviceWorker.url().split("/")[2];
  return { context, extensionId, userDataDir };
}

test("popup renders connected state when SW reports connected", async () => {
  // Connected-state coverage: stubs chrome.runtime.sendMessage via
  // addInitScript so popup.js sees `{connected:true, version:'<x>'}`
  // without needing a real daemon. Verifies the visual side of the
  // connected branch — green-dot row, "Connected to local bridge"
  // copy, .dot-ok CSS — that Layer 3a's render() unit cannot see.
  const { context, extensionId, userDataDir } = await loadExtension();
  try {
    const page = await context.newPage();
    const STUB_VERSION = "9.9.9-test";
    await page.addInitScript((stubVersion) => {
      // Run after Chrome injects chrome.runtime but before popup.js
      // calls sendMessage. Replace sendMessage so its callback fires
      // synchronously with a connected-state payload.
      const tryOverride = () => {
        if (typeof chrome === "undefined" || !chrome.runtime) return false;
        try {
          chrome.runtime.sendMessage = (msg, cb) => {
            if (msg && msg.type === "tap-status" && typeof cb === "function") {
              cb({ connected: true, version: stubVersion });
            }
            return undefined;
          };
          return true;
        } catch {
          return false;
        }
      };
      if (!tryOverride()) {
        // chrome.runtime not yet defined — race rare but possible.
        // Re-attempt at DOMContentLoaded (still before popup.js in
        // popup.html since the script tag is the very last child).
        document.addEventListener("DOMContentLoaded", tryOverride, { once: true });
      }
    }, STUB_VERSION);
    await page.goto(`chrome-extension://${extensionId}/popup.html`);

    await page.waitForSelector("#connected:not([hidden])", { timeout: 10_000 });

    await expect(page.locator("#connected")).toBeVisible();
    await expect(page.locator("#disconnected")).toBeHidden();

    // Connected copy: green-dot row + headline text. The text is the
    // user's primary signal that everything is working.
    await expect(page.locator("#connected .row")).toContainText(
      "Connected to local bridge",
    );

    // .dot-ok styling renders the green dot — visual regression catch.
    // Asserting non-zero box size guards against display:none / hidden
    // CSS regressions.
    const dotBox = await page.locator("#connected .dot-ok").boundingBox();
    expect(dotBox).not.toBeNull();
    expect(dotBox.width).toBeGreaterThan(0);
    expect(dotBox.height).toBeGreaterThan(0);

    // Stub version flows through: proves the sendMessage payload reached
    // popup.js's render() and updated #version.
    await expect(page.locator("#version")).toHaveText(`v${STUB_VERSION}`);
  } finally {
    await context.close();
    await fs.promises.rm(userDataDir, { recursive: true, force: true });
  }
});

test("popup renders disconnected state when no bridge is reachable", async () => {
  const { context, extensionId, userDataDir } = await loadExtension();
  try {
    const page = await context.newPage();
    await page.goto(`chrome-extension://${extensionId}/popup.html`);

    // Popup polls every 2s; wait for the SW response to flip the state.
    await page.waitForSelector("#disconnected:not([hidden])", {
      timeout: 10_000,
    });

    await expect(page.locator("#disconnected")).toBeVisible();
    await expect(page.locator("#connected")).toBeHidden();

    // Canonical bridge-start command literal — the #1 traffic page promise.
    // If anyone renames the CLI verb, this test fails (paired with Layer 3a's
    // structural assertion in popup.test.mjs).
    await expect(page.locator("#disconnected pre code")).toContainText(
      "tap bridge start",
    );

    // Install link must keep its UTM payload through Chrome's anchor handling
    // (per memory feedback_always_utm_external_shares).
    const href = await page.locator("#install").getAttribute("href");
    expect(href).toContain("utm_source=chrome-ext");
    expect(href).toContain("utm_campaign=popup");

    // Version display dynamically matches manifest — proves the SW supplied
    // status payload reached the popup (a broken sendMessage path would leave
    // #version blank).
    const manifest = JSON.parse(
      await fs.promises.readFile(
        path.join(extensionPath, "manifest.json"),
        "utf-8",
      ),
    );
    await expect(page.locator("#version")).toHaveText(`v${manifest.version}`);
  } finally {
    await context.close();
    await fs.promises.rm(userDataDir, { recursive: true, force: true });
  }
});
