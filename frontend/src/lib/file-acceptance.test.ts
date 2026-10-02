import { describe, expect, it } from "vitest";
import { adviseRejection, currentToolSlug, describeAccepts, matchesAccept, partitionByAccept, suggestToolFor } from "./file-acceptance";
import { tools } from "@/data/tools";
import { nonPdfTools } from "@/data/non-pdf-tools";

const file = (name: string, type = "") => ({ name, type });
const registry = new Map([...tools, ...nonPdfTools].map(tool => [tool.slug, tool]));

describe("matchesAccept", () => {
    it("compares extensions without case and takes anything for an empty or wildcard list", () => {
        expect(matchesAccept(file("Report.PDF"), ".pdf")).toBe(true);
        expect(matchesAccept(file("holiday.png"), ".pdf")).toBe(false);
        expect(matchesAccept(file("backup.tar.gz"), ".zip,.tar.gz")).toBe(true);
        expect(matchesAccept(file("clip.mov", "video/quicktime"), "video/*")).toBe(true);
        expect(matchesAccept(file("clip.mov", "video/quicktime"), "application/pdf")).toBe(false);
        expect(matchesAccept(file("anything.bin"), "*")).toBe(true);
        expect(matchesAccept(file("anything.bin"), "")).toBe(true);
        expect(matchesAccept(file("anything.bin"))).toBe(true);
    });

    it("splits a selection into what an intake takes and what it refuses, in order", () => {
        const picked = [file("a.pdf"), file("b.png"), file("c.pdf")];
        expect(partitionByAccept(picked, ".pdf")).toEqual({ accepted: [picked[0], picked[2]], rejected: [picked[1]] });
    });
});

describe("suggestToolFor", () => {
    it.each([
        ["compress-pdf", "holiday.png", undefined, "image-compressor", "same-job"],
        ["compress-pdf", "clip.mp4", undefined, "compress-video", "same-job"],
        ["compress-pdf", "report.docx", undefined, "word-to-pdf", "convert"],
        ["merge-pdf", "photo.png", "convert", "image-to-pdf", "convert"],
        ["rotate-pdf", "photo.jpg", undefined, "rotate-image", "same-job"],
        ["ocr-pdf", "scan.png", undefined, "image-ocr", "same-job"],
        ["strip-metadata", "photo.jpg", undefined, "remove-exif", "same-job"],
        ["image-compressor", "report.pdf", undefined, "compress-pdf", "same-job"],
        ["image-compressor", "photo.heic", undefined, "heic-to-jpg", "convert"],
        ["heic-to-jpg", "photo.png", undefined, "png-to-jpg", "same-job"],
        ["remove-background", "report.pdf", undefined, "transparent-background", "same-job"],
    ] as const)("sends a file refused by %s (%s) to a tool that takes it", (fromSlug, name, prefer, slug, relation) => {
        const suggestion = suggestToolFor(file(name), { fromSlug, prefer });
        expect(suggestion).toMatchObject({ slug, relation });
        expect(suggestion?.href).toBe(`${tools.some(tool => tool.slug === slug) ? "/tool/" : "/tools/"}${slug}`);
    });

    it("only ever suggests a registered tool that explicitly takes the file, never an any-file tool or itself", () => {
        for (const from of ["compress-pdf", "merge-pdf", "image-converter", "compress-video", "json-xml-formatter", "word-to-pdf"]) {
            for (const name of ["a.pdf", "b.png", "c.jpg", "d.heic", "e.mp4", "f.mp3", "g.docx", "h.xlsx", "i.txt", "j.zip", "k.csv", "l.srt"]) {
                const suggestion = suggestToolFor(file(name), { fromSlug: from });
                if (!suggestion) continue;
                const tool = registry.get(suggestion.slug)!;
                expect(tool, `${from} ${name}`).toBeDefined();
                expect(suggestion.slug).not.toBe(from);
                expect(tool.accepts.split(",").map(token => token.trim())).not.toContain("*");
                expect(matchesAccept(file(name), tool.accepts), `${suggestion.slug} takes ${name}`).toBe(true);
            }
        }
    });

    it("suggests nothing for a format no tool takes", () => {
        expect(suggestToolFor(file("mystery.xyz"), { fromSlug: "compress-pdf" })).toBeNull();
        expect(suggestToolFor(file("no-extension"), { fromSlug: "compress-pdf" })).toBeNull();
    });
});

describe("adviseRejection", () => {
    it("names the file, says what the tool takes and points to the tool that takes it", () => {
        const advice = adviseRejection([file("holiday.png", "image/png")], { fromSlug: "compress-pdf" })!;
        expect(advice.text).toBe("holiday.png wasn’t added. Compress PDF takes PDF files. Try Image Compressor for PNG files.");
        expect(advice.suggestion).toMatchObject({ name: "Image Compressor", href: "/tools/image-compressor" });
    });

    it("says what a converter would make, with the right article", () => {
        expect(adviseRejection([file("photo.png")], { fromSlug: "merge-pdf", prefer: "convert" })!.text)
            .toBe("photo.png wasn’t added. Merge PDF takes PDF files. Image to PDF can turn it into a PDF first.");
        expect(adviseRejection([file("photo.heic")], { fromSlug: "image-compressor" })!.text)
            .toBe("photo.heic wasn’t added. Image Compressor takes JPG, PNG or WEBP files. HEIC to JPG can turn it into a JPG first.");
    });

    it("counts the rest of a refused selection and keeps working without a known tool", () => {
        expect(adviseRejection([file("a.png"), file("b.png"), file("c.jpg")], { fromSlug: "compress-pdf" })!.headline)
            .toBe("a.png and 2 other files weren’t added.");
        expect(adviseRejection([file("notes.txt")], { accepts: ".pdf", fromSlug: "not-a-tool" })!.reason).toBe("This tool takes PDF files.");
        expect(adviseRejection([], { accepts: ".pdf" })).toBeNull();
    });

    it("reads the tool from the route", () => {
        expect(currentToolSlug("/tool/compress-pdf")).toBe("compress-pdf");
        expect(currentToolSlug("/tools/image-compressor")).toBe("image-compressor");
        expect(currentToolSlug("/tools")).toBeUndefined();
        expect(currentToolSlug("/tool/unknown-slug")).toBeUndefined();
    });

    it("describes accept lists in words", () => {
        expect(describeAccepts(".pdf")).toBe("PDF files");
        expect(describeAccepts(".jpg,.jpeg,.png,.webp")).toBe("JPG, PNG or WEBP files");
        expect(describeAccepts("*")).toBeNull();
    });
});
