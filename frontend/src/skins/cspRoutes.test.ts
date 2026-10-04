import { describe, expect, it } from "vitest";
import { documentNavigationFor } from "./cspRoutes";

describe("document policy boundaries", () => {
  it.each([
    ["/ai", "/ai"],
    ["#/ai", "/ai"],
    ["/tool/summarize-pdf", "/tool/summarize-pdf"],
    ["#/tool/image-ocr", "/tools/image-ocr"],
    ["#/tool/remove-background", "/tools/remove-background"],
    ["/tools/transcribe-audio?engine=local", "/tools/transcribe-audio?engine=local"],
  ])("requests the required document from Home for %s", (href, target) => {
    expect(documentNavigationFor("/", href)).toBe(target);
  });

  it("keeps compatible AI routes in the same document", () => {
    expect(documentNavigationFor("/tool/summarize-pdf", "#/tool/translate-pdf")).toBeNull();
    expect(documentNavigationFor("/tool/summarize-pdf", "/ai")).toBeNull();
    expect(documentNavigationFor("/ai", "#/tool/remove-background")).toBeNull();
    expect(documentNavigationFor("/ai/", "#/ai")).toBeNull();
  });

  it("acquires provider access only when leaving configuration for a provider tool", () => {
    expect(documentNavigationFor("/ai", "#/tool/chat-with-pdf")).toBe("/tool/chat-with-pdf");
    expect(documentNavigationFor("/ai", "/tool/ocr-pdf")).toBe("/tool/ocr-pdf");
    expect(documentNavigationFor("/tool/chat-with-pdf", "/ai")).toBe("/ai");
  });

  it("loads the token counter as its own document, for its provider access, from any other page", () => {
    expect(documentNavigationFor("/", "/tools/ai-token-counter")).toBe("/tools/ai-token-counter");
    expect(documentNavigationFor("/tools/word-counter", "#/tool/ai-token-counter")).toBe("/tools/ai-token-counter");
    // A provider page's policy already allows it; ordinary tools stay in the token counter's document.
    expect(documentNavigationFor("/tool/chat-with-pdf", "/tools/ai-token-counter")).toBeNull();
    expect(documentNavigationFor("/tools/ai-token-counter", "/tools/word-counter")).toBeNull();
  });

  it("loads the noise remover as its own document, for WebAssembly without any script CDN", () => {
    expect(documentNavigationFor("/", "/tools/remove-background-noise")).toBe("/tools/remove-background-noise");
    expect(documentNavigationFor("/tools/audio-converter", "#/tool/remove-background-noise")).toBe("/tools/remove-background-noise");
    // A model page's policy already allows WebAssembly; the noise remover's doesn't allow the model pages' CDN.
    expect(documentNavigationFor("/tool/summarize-pdf", "/tools/remove-background-noise")).toBeNull();
    expect(documentNavigationFor("/tools/remove-background-noise", "/tools/transcribe-audio")).toBe("/tools/transcribe-audio");
    expect(documentNavigationFor("/tools/remove-background-noise", "/tools/audio-converter")).toBeNull();
  });

  it("does not equate OCR's worker policy with Transformers' runtime policy", () => {
    expect(documentNavigationFor("/tool/ocr-pdf", "/tool/summarize-pdf")).toBe("/tool/summarize-pdf");
    expect(documentNavigationFor("/tool/summarize-pdf", "/tool/ocr-pdf")).toBeNull();
  });

  it("leaves ordinary workspace navigation and handoffs mounted", () => {
    for (const href of ["/tool/merge-pdf", "#/tool/compress-pdf", "/tools/resize-crop-image", "/pipeline", "/batch", "/my-stuff"]) {
      expect(documentNavigationFor("/", href)).toBeNull();
      expect(documentNavigationFor("/ai", href)).toBeNull();
    }
  });

  it("canonicalizes settings without intercepting unrelated or external addresses", () => {
    expect(documentNavigationFor("/", "/settings?section=appearance")).toBe("/account/settings?section=appearance");
    expect(documentNavigationFor("/", "#/settings")).toBe("/account/settings");
    for (const href of ["//example.com/ai", "https://example.com/ai", "#main-content", "/ai-other", "/tools/not-a-model"]) {
      expect(documentNavigationFor("/", href)).toBeNull();
    }
  });
});


describe("navigation within the account CSP", () => {
  it("keeps account navigation in the current document and preserves recovery queries", async () => {
    const { accountNavigationFor } = await import("./cspRoutes");
    expect(accountNavigationFor("/account/sign-in", "/account/settings")).toBe("/account/settings");
    expect(accountNavigationFor("/account/settings", "/account?mode=recover")).toBe("/account?mode=recover");
    expect(accountNavigationFor("/account", "/settings")).toBe("/account/settings");
  });
  it("still requests new account CSP headers from ordinary tools and rejects foreign paths", async () => {
    const { accountNavigationFor } = await import("./cspRoutes");
    expect(accountNavigationFor("/tool/merge-pdf", "/account/sign-in")).toBeNull();
    expect(accountNavigationFor("/account", "//example.com/account")).toBeNull();
    expect(accountNavigationFor("/account", "/account-unrelated")).toBeNull();
    expect(accountNavigationFor("/account", "/tools")).toBeNull();
  });
});
