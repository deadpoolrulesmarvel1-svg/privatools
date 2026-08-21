/**
 * Local-first personalization store.
 *
 * Everything here is device-local: no server, no account, no sync. See
 * docs/superpowers/specs/2026-08-21-local-first-personalization-design.md.
 */
export * as db from "./db";
export * as vault from "./vault";
export * as assets from "./assets";
export * as counters from "./counters";
export * as toolDefaults from "./defaults";
export { inventory, exportSetup, eraseEverything, type Inventory } from "./inventory";
export { hasWebCrypto } from "./crypto";
export { migrateLegacyKeys } from "./migrate";
