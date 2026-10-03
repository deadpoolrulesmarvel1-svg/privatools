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

    it("does not take counting pages and counting tokens for one job", () => {
        // "counter" names no job: a page count and a token count are different things.
        expect(suggestToolFor(file("report.docx"), { fromSlug: "pdf-page-counter" })).toMatchObject({ slug: "word-to-pdf", relation: "convert" });
        expect(suggestToolFor(file("notes.txt"), { fromSlug: "pdf-page-counter" })?.slug).not.toBe("ai-token-counter");
        expect(suggestToolFor(file("photo.png"), { fromSlug: "ai-token-counter" })?.slug).not.toBe("pdf-page-counter");
    });

    it("never sends a file back through a round trip or into a format the tool can't take", () => {
        // Text to PDF makes PDFs: PDF to Text would only undo it.
        expect(suggestToolFor(file("report.pdf"), { fromSlug: "txt-to-pdf" })).toBeNull();
        // "To image" makes PNG or JPG, which GIF to MP4 can't take.
        expect(suggestToolFor(file("report.pdf"), { fromSlug: "gif-to-mp4" })?.slug).not.toBe("pdf-to-image");
    });
});

describe("tools that work from a file's words", () => {
    // Image to PDF makes a PDF of the picture's pixels, with no text in it, so
    // PDF to Text, the AI pages and the token counter would find nothing to
    // read there. OCR reads the words in the picture.
    const readers = [...tools, ...nonPdfTools].filter(tool => "needsText" in tool && tool.needsText === true).map(tool => tool.slug);

    it("are marked in the registry", () => {
        expect(readers).toEqual(expect.arrayContaining(["pdf-to-text", "ai-token-counter", "chat-with-pdf", "summarize-pdf", "translate-pdf", "pdf-to-word"]));
        // Their own job is not reading words: they keep working on the page itself.
        for (const slug of ["merge-pdf", "compress-pdf", "ocr-pdf", "image-ocr", "image-to-pdf"]) expect(readers).not.toContain(slug);
    });

    it("send a picture to OCR, never to Image to PDF", () => {
        expect(readers.length).toBeGreaterThan(0);
        for (const fromSlug of readers) {
            for (const name of ["scan.png", "receipt.jpg", "page.webp", "fax.tiff"]) {
                for (const prefer of ["same-job", "convert"] as const) {
                    expect(suggestToolFor(file(name), { fromSlug, prefer }), `${fromSlug} ${name} ${prefer}`).toMatchObject({ slug: "image-ocr", relation: "read-text" });
                }
            }
        }
    });

    it("say what OCR does with it", () => {
        expect(adviseRejection([file("scan.png")], { fromSlug: "pdf-to-text" })!.text)
            .toBe("scan.png wasn’t added. PDF to Text takes PDF files. Image OCR can read the text in it.");
        expect(adviseRejection([file("a.png"), file("b.jpg")], { fromSlug: "summarize-pdf" })!.text)
            .toBe("a.png and 1 other file weren’t added. Summarize PDF (AI) takes PDF files. Image OCR can read the text in them.");
    });

    it("suggest nothing for a picture no OCR tool takes, or a video, rather than a PDF of its pixels", () => {
        expect(suggestToolFor(file("photo.heic"), { fromSlug: "pdf-to-text" })).toBeNull();
        expect(suggestToolFor(file("talk.mp4", "video/mp4"), { fromSlug: "chat-with-pdf" })).toBeNull();
    });

    it("still send a document with text through the converter that keeps it", () => {
        expect(suggestToolFor(file("report.docx"), { fromSlug: "pdf-to-text" })).toMatchObject({ relation: "convert", into: "PDF" });
        expect(suggestToolFor(file("notes.txt"), { fromSlug: "chat-with-pdf" })).toMatchObject({ slug: "txt-to-pdf", relation: "convert" });
    });

    it("leave a tool that works on the page itself with Image to PDF", () => {
        expect(suggestToolFor(file("photo.png"), { fromSlug: "merge-pdf", prefer: "convert" })).toMatchObject({ slug: "image-to-pdf", relation: "convert" });
        expect(suggestToolFor(file("photo.png"), { fromSlug: "rotate-pdf", prefer: "convert" })).toMatchObject({ slug: "image-to-pdf", relation: "convert" });
        expect(suggestToolFor(file("photo.png"), { fromSlug: "merge-pdf", prefer: "convert" })?.then).toBeUndefined();
    });
});

describe("tools that find words in a PDF's text layer", () => {
    // These work on the PDF itself, through the text it holds: they redact,
    // highlight or link it, split it at a phrase, or read its tables. Image to
    // PDF alone gives them a PDF with no text, and Image OCR gives text but
    // no PDF. OCR PDF gives the PDF a text layer.
    const LAYER_READERS = ["smart-redact", "split-by-text", "add-hyperlinks", "pdf-to-excel", "extract-tables", "highlight-pdf"];
    const marked = [...tools, ...nonPdfTools].filter(tool => "needsText" in tool && tool.needsText === "pdf").map(tool => tool.slug);
    const ocrPdf = { slug: "ocr-pdf", name: "OCR PDF", href: "/tool/ocr-pdf" };

    it("are marked in the registry", () => {
        expect([...marked].sort()).toEqual([...LAYER_READERS].sort());
    });

    it("send a picture to Image to PDF, then to OCR PDF", () => {
        for (const fromSlug of LAYER_READERS) {
            for (const name of ["scan.png", "receipt.jpg", "page.webp", "fax.tiff", "photo.heic"]) {
                for (const prefer of ["same-job", "convert"] as const) {
                    expect(suggestToolFor(file(name), { fromSlug, prefer }), `${fromSlug} ${name} ${prefer}`)
                        .toMatchObject({ relation: "convert", into: "PDF", then: ocrPdf });
                }
            }
            expect(suggestToolFor(file("scan.png"), { fromSlug })).toMatchObject({ slug: "image-to-pdf", name: "Image to PDF", href: "/tool/image-to-pdf" });
        }
    });

    it("say both steps", () => {
        expect(adviseRejection([file("scan.png")], { fromSlug: "smart-redact" })!.text)
            .toBe("scan.png wasn’t added. Smart Redact (AI) takes PDF files. Image to PDF can turn it into a PDF first; OCR PDF then gives it text to find.");
        const several = adviseRejection([file("a.png"), file("b.jpg")], { fromSlug: "highlight-pdf" })!;
        expect(several.text)
            .toBe("a.png and 1 other file weren’t added. Highlight PDF takes PDF files. Image to PDF can turn them into PDFs first; OCR PDF then gives them text to find.");
        // The parts a page links: the first tool's name, then the second's.
        expect(`${several.suggestionLead}${several.suggestion!.name}${several.suggestionTail}${several.suggestion!.then!.name}${several.thenTail}`)
            .toBe("Image to PDF can turn them into PDFs first; OCR PDF then gives them text to find.");
    });

    it("suggest nothing for a video, rather than a PDF of its frames", () => {
        expect(suggestToolFor(file("talk.mp4", "video/mp4"), { fromSlug: "split-by-text" })).toBeNull();
    });

    it("still send a document with text through the converter that keeps it, with no OCR step", () => {
        const suggestion = suggestToolFor(file("report.docx"), { fromSlug: "pdf-to-excel" });
        expect(suggestion).toMatchObject({ relation: "convert", into: "PDF" });
        expect(suggestion?.then).toBeUndefined();
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
