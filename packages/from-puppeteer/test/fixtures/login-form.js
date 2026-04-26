// Fixture: typical Puppeteer login flow.
// Expected mapping:
//   page.goto                → nav
//   page.type                → input fill (Puppeteer's type semantically fills)
//   page.keyboard.press      → input press (no target — focused element)
//   page.waitForSelector     → wait selector

const puppeteer = require("puppeteer");

(async () => {
  const browser = await puppeteer.launch();
  const page = await browser.newPage();

  await page.goto("https://example.test/login");
  await page.type("#username", "alice");
  await page.type("#password", "secret");
  await page.keyboard.press("Enter");
  await page.waitForSelector(".dashboard");

  await browser.close();
})();
