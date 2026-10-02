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
        // A watermark tool and a watermark remover share a word, not a job.
        ["watermark", "holiday.png", undefined, "image-watermark", "same-job"],
        ["remove-watermark", "holiday.png", undefined, "remove-image-watermark", "same-job"],
        ["remove-exif", "report.pdf", undefined, "strip-metadata", "same-job"],
        ["sql-formatter", "data.json", undefined, "json-xml-formatter", "same-job"],
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

    it.each([
        // A tool that merely opens the file is not advice (review of #312).
        ["txt-to-pdf", "report.pdf"],
        ["remove-background", "clip.mp4"],
        ["extract-audio", "scan.tif"],
        ["sql-formatter", "photo.jpg"],
        // Generic words and look-alike stems: Extract Audio is not Extract Pages,
        // "form" is not "format", "speed" is not "speech".
        ["extract-archive", "report.pdf"],
        ["fill-form", "song.mp3"],
        ["video-speed", "song.mp3"],
        ["hidden-text-checker", "song.mp3"],
        ["json-xml-formatter", "song.mp3"],
        ["image-converter", "letter.docx"],
        // One shared synonym is chance: Organize Pages lists "thumbnails".
        ["video-thumbnail", "report.pdf"],
        // A converted copy has none of the original's metadata.
        ["view-exif", "report.pdf"],
    ] as const)("suggests no unrelated tool when %s refuses %s", (fromSlug, name) => {
        expect(suggestToolFor(file(name), { fromSlug })).toBeNull();
    });

    it("never sends a file back through a round trip or into a format the tool can't take", () => {
        // Text to PDF makes PDFs: PDF to Text would only undo it.
        expect(suggestToolFor(file("report.pdf"), { fromSlug: "txt-to-pdf" })).toBeNull();
        // "To image" makes PNG or JPG, which GIF to MP4 can't take.
        expect(suggestToolFor(file("report.pdf"), { fromSlug: "gif-to-mp4" })?.slug).not.toBe("pdf-to-image");
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
        // FLAC is said as a word: "a FLAC", never "an FLAC".
        expect(adviseRejection([file("sound.wav")], { fromSlug: "flac-to-mp3", prefer: "convert" })!.text)
            .toBe("sound.wav wasn’t added. FLAC to MP3 takes FLAC files. WAV to FLAC can turn it into a FLAC first.");
    });

    it("stops at the reason when no tool does the same job or a useful conversion", () => {
        const advice = adviseRejection([file("clip.mp4")], { fromSlug: "remove-background" })!;
        expect(advice.text).toBe("clip.mp4 wasn’t added. Background Remover takes JPG, PNG, WEBP or BMP files.");
        expect(advice.suggestion).toBeNull();
        expect(adviseRejection([file("photo.jpg")], { fromSlug: "sql-formatter" })!.text)
            .toBe("photo.jpg wasn’t added. SQL Formatter takes SQL files.");
    });

    it("tells a converter's visitor when the file is already what it makes", () => {
        expect(adviseRejection([file("report.pdf")], { fromSlug: "txt-to-pdf" })!.text)
            .toBe("report.pdf wasn’t added. Text to PDF takes TXT files. It’s already a PDF.");
        expect(adviseRejection([file("photo.jpg")], { fromSlug: "heic-to-jpg" })!.text)
            .toBe("photo.jpg wasn’t added. HEIC to JPG takes HEIC files. It’s already a JPG.");
        // "To image" makes an image, never this file's format.
        expect(adviseRejection([file("phone.heic")], { fromSlug: "pdf-to-image" })!.text)
            .toBe("phone.heic wasn’t added. PDF to Image takes PDF files. It’s already an image.");
        const several = adviseRejection([file("a.pdf"), file("b.pdf")], { fromSlug: "word-to-pdf" })!;
        expect(several.text).toBe("a.pdf and 1 other file weren’t added. Word to PDF takes DOCX files. They’re already PDFs.");
        expect(several.suggestion).toBeNull();
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
