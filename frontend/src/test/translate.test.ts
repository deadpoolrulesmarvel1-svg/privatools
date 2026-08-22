import { describe, it, expect } from "vitest";
import {
    DEFAULT_MAX_CHARS,
    chunkForTranslation,
    splitSentences,
} from "@/lib/translate/chunk";
import {
    FROM_ENGLISH,
    LANGUAGES,
    TO_ENGLISH,
    availableSources,
    isSupported,
    languageName,
    modelIdFor,
    targetsFor,
} from "@/lib/translate/languages";

describe("language matrix", () => {
    it("only offers pairs a model actually exists for", () => {
        // Verified against the HuggingFace model index; every listed pair had
        // ONNX weights present. Offering a pair with no model would fail after
        // a ~107 MB download.
        expect(modelIdFor("en", "fr")).toBe("Xenova/opus-mt-en-fr");
        expect(modelIdFor("de", "en")).toBe("Xenova/opus-mt-de-en");
    });

    it("returns null for a pair with no direct model", () => {
        // Pivoting through English means two downloads and compounded errors.
        expect(modelIdFor("fr", "de")).toBeNull();
        expect(modelIdFor("es", "it")).toBeNull();
    });

    it("returns null when source and target match", () => {
        expect(modelIdFor("en", "en")).toBeNull();
        expect(modelIdFor("de", "de")).toBeNull();
    });

    it("respects the asymmetry of the model set", () => {
        // Romanian has en->ro but no ro->en.
        expect(isSupported("en", "ro")).toBe(true);
        expect(isSupported("ro", "en")).toBe(false);
        // Japanese, Korean, Polish, Thai and Turkish are ->en only.
        for (const code of ["ja", "ko", "pl", "th", "tr", "et"]) {
            expect(isSupported(code, "en")).toBe(true);
            expect(isSupported("en", code)).toBe(false);
        }
    });

    it("gives every offered code a display name", () => {
        for (const code of [...FROM_ENGLISH, ...TO_ENGLISH]) {
            expect(LANGUAGES[code], `${code} has no name`).toBeTruthy();
        }
        expect(LANGUAGES.en).toBe("English");
    });

    it("lists targets that are all genuinely supported", () => {
        for (const source of availableSources()) {
            for (const target of targetsFor(source)) {
                expect(isSupported(source, target), `${source}->${target}`).toBe(true);
            }
        }
    });

    it("offers no targets for a language we cannot read", () => {
        expect(targetsFor("ro")).toEqual([]);
        expect(targetsFor("zz")).toEqual([]);
    });

    it("lists each source once", () => {
        const sources = availableSources();
        expect(new Set(sources).size).toBe(sources.length);
    });

    it("falls back to the code for an unknown language", () => {
        expect(languageName("zz")).toBe("zz");
    });
});

describe("chunking", () => {
    it("returns nothing for empty input", () => {
        expect(chunkForTranslation("")).toEqual([]);
        expect(chunkForTranslation("   \n  ")).toEqual([]);
    });

    it("leaves short text as a single chunk", () => {
        expect(chunkForTranslation("A short sentence.")).toEqual(["A short sentence."]);
    });

    it("never exceeds the limit", () => {
        // Silent truncation past the model's 512-token limit is the failure this
        // prevents: the back half of a page just doesn't appear in the output.
        const text = "This is a sentence with several words in it. ".repeat(200);
        for (const chunk of chunkForTranslation(text)) {
            expect(chunk.length).toBeLessThanOrEqual(DEFAULT_MAX_CHARS);
        }
    });

    it("prefers sentence boundaries", () => {
        const text = "First one here. Second one here. Third one here.";
        const chunks = chunkForTranslation(text, 20);
        for (const chunk of chunks) {
            expect(chunk).toMatch(/[.!?]$/);
        }
    });

    it("hard-splits a single oversized sentence", () => {
        const monster = "word ".repeat(500).trim();
        const chunks = chunkForTranslation(monster, 100);
        expect(chunks.length).toBeGreaterThan(1);
        for (const chunk of chunks) {
            expect(chunk.length).toBeLessThanOrEqual(100);
        }
    });

    it("keeps words intact when hard-splitting", () => {
        const text = `${"alpha bravo charlie ".repeat(40)}`;
        for (const chunk of chunkForTranslation(text, 60)) {
            // No chunk should start or end mid-word.
            expect(chunk).not.toMatch(/^\S*?(?<![a-z])[a-z]{1,2}\b\s/i);
            expect(chunk.trim()).toBe(chunk);
        }
    });

    it("loses no words", () => {
        const text = "Alpha bravo. Charlie delta echo. Foxtrot golf hotel india juliet.";
        const rejoined = chunkForTranslation(text, 25).join(" ");
        for (const word of text.replace(/[.]/g, "").split(/\s+/)) {
            expect(rejoined).toContain(word);
        }
    });

    it("splits CJK sentences on their own punctuation", () => {
        // A CJK page has no spaces, so a space-based splitter would emit one
        // enormous chunk and silently truncate it.
        const sentences = splitSentences("这是第一句。这是第二句。这是第三句。");
        expect(sentences).toHaveLength(3);
    });

    it("handles CJK text with no spaces at all", () => {
        const text = "字".repeat(500);
        for (const chunk of chunkForTranslation(text, 100)) {
            expect(chunk.length).toBeLessThanOrEqual(100);
        }
    });

    it("collapses the ragged whitespace pdf.js extraction produces", () => {
        expect(chunkForTranslation("Hello    \n\n   world.")).toEqual(["Hello world."]);
    });
});
