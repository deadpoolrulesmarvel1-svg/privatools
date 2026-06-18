# PrivaTools Pipeline Extension

Manifest V3 browser extension that adds context-menu entries for opening the
PrivaTools pipeline from any page or PDF link.

## Local Load

1. Open `chrome://extensions`.
2. Enable Developer mode.
3. Choose **Load unpacked** and select `packages/extension`.

No file bytes are read by the extension. It only opens PrivaTools with optional
source URL context so users can decide what to upload.
