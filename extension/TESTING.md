# Extension Testing Guide

## Load Unpacked Extension

1. Open `chrome://extensions/`
2. Enable **Developer mode** (top-right toggle)
3. Click **Load unpacked** → select the `extension/` directory
4. Verify: "Tap" extension appears, version 0.4.0, status enabled

## Run Constraint Tests

```bash
node extension/test/architecture.test.mjs     # Architecture constraints
node extension/test/protocol.test.mjs         # Protocol constraints
node extension/test/multi-tab.test.mjs        # Multi-tab constraints
node extension/test/kernel-behavior.test.mjs  # Kernel behavior constraints
node extension/test/tap-format.test.mjs       # Tap format constraints
```

## Verify Extension

- [ ] Extension appears in `chrome://extensions/`
- [ ] Version shows 0.4.0
- [ ] Status: enabled, no errors
- [ ] Service Worker running (click "Service Worker" to inspect console)

### Expected Console Log

```
[tap] extension runtime ready (API gateway mode)
```

## Debug

1. Open `chrome://extensions/`
2. Find "Tap" extension
3. Click "Service Worker" under "Inspect views"
4. Check Console for logs and errors
