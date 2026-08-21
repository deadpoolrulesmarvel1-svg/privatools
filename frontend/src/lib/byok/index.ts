/**
 * Bring your own AI key.
 *
 * The key and the document go from the browser straight to the provider the
 * user chose. Nothing passes through PrivaTools — see
 * docs/superpowers/specs/2026-08-21-byok-ai-design.md.
 */
export { complete, type CompleteArgs } from "./client";
export { PROVIDERS, providerById, type Provider, type Message } from "./providers";
export {
    saveKey, getKey, clearKey, listConfigured, setSessionOnly, isSessionOnly,
} from "./keyStore";
export { ByokError, type ByokErrorKind } from "./errors";
export { redact } from "./redact";
