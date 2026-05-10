// Layer 3b — MV3 extension popup visual gate.
// Closes the visual side of the gap noted in the 5/9 bridge-disconnect
// memo (state logic was covered by extension/test/popup.test.mjs as Layer
// 3a — this layer covers actual Chrome rendering of CSS / icons / layout
// that a hand-rolled DOM stub can't see).

export default {
  testDir: ".",
  timeout: 30_000,
  // Extensions don't multi-instance cleanly; one worker keeps the per-test
  // launchPersistentContext from racing on extension state.
  workers: 1,
  fullyParallel: false,
  reporter: [["list"]],
  use: {
    // Per Playwright docs: MV3 extensions require `chromium` (not `webkit`/
    // `firefox`); each test launches its own persistent context.
    actionTimeout: 5_000,
  },
};
