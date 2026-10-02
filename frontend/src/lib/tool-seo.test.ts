import { describe, expect, it } from "vitest";
import { toolSeo } from "./tool-seo";

describe("toolSeo", () => {
  it("keeps the search title for the tab and makes the heading the name and its promise", () => {
    const seo = toolSeo({ name: "Merge PDF", seoTitle: "Merge PDF Files Online Free – Combine PDFs Privately", metaDescription: "Combine PDFs in order. Free, no sign-up.", description: "Combine multiple PDFs into one" });
    expect(seo.title).toBe("Merge PDF Files Online Free – Combine PDFs Privately");
    expect(seo.h1).toBe("Merge PDF: Combine multiple PDFs into one");
    expect(seo).toMatchObject({ name: "Merge PDF", promise: "Combine multiple PDFs into one" });
    expect(seo.h1).not.toContain("Online Free");
    expect(seo.description).toBe("Combine PDFs in order. Free, no sign-up.");
  });
  it("falls back to the tool name for registries without search copy", () => {
    const seo = toolSeo({ name: "Merge PDF", longDescription: "Long text." });
    expect(seo).toEqual({ title: "Merge PDF — Free Online | PrivaTools", h1: "Merge PDF", name: "Merge PDF", promise: "", description: "Long text." });
  });
});
