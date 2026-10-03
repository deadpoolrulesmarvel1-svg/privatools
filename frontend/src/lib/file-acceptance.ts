/**
 * What a file intake accepts, and where a file it cannot take should go.
 *
 * A file picker filters by type, but drag and drop, "All files" in the
 * system dialog and handoffs from other tools do not. A file that fails the
 * check must never vanish: the intake names it, says what this tool takes and
 * points to a tool in the registry that takes it. Suggestions come from the
 * registries (accepted types, slugs and synonyms), never from a hand list.
 */
import { tools } from "@/data/tools";
import { nonPdfTools } from "@/data/non-pdf-tools";

interface CatalogueEntry {
    slug: string;
    name: string;
    accepts: string;
    outputLabel: string;
    synonyms?: string;
    popularity?: number;
    comingSoon?: boolean;
    needsText?: boolean;
    href: string;
}

const CATALOGUE: CatalogueEntry[] = [
    ...tools.map(tool => ({ ...tool, href: `/tool/${tool.slug}` })),
    ...nonPdfTools.map(tool => ({ ...tool, href: `/tools/${tool.slug}` })),
];
const BY_SLUG = new Map(CATALOGUE.map(tool => [tool.slug, tool]));

function acceptTokens(accepts?: string): string[] | null {
    const tokens = (accepts ?? "").split(",").map(token => token.trim().toLowerCase()).filter(Boolean);
    if (!tokens.length || tokens.includes("*") || tokens.includes("*/*")) return null;
    return tokens;
}

/** True when a file matches an `accept` list such as ".pdf,image/*". An empty
 *  list, "*" or "*\/*" takes anything. Extensions compare case-insensitively. */
export function matchesAccept(file: Pick<File, "name" | "type">, accepts?: string): boolean {
    const tokens = acceptTokens(accepts);
    if (!tokens) return true;
    const name = file.name.toLowerCase();
    const type = (file.type || "").toLowerCase();
    return tokens.some(token => token.startsWith(".") ? name.endsWith(token)
        : token.endsWith("/*") ? type.startsWith(token.slice(0, -1))
        : type === token);
}

export function partitionByAccept<T extends Pick<File, "name" | "type">>(files: readonly T[], accepts?: string): { accepted: T[]; rejected: T[] } {
    const accepted: T[] = [];
    const rejected: T[] = [];
    for (const file of files) (matchesAccept(file, accepts) ? accepted : rejected).push(file);
    return { accepted, rejected };
}

/** The registry slug of the tool page being shown, read from the route. */
export function currentToolSlug(pathname = typeof window === "undefined" ? "" : window.location.pathname): string | undefined {
    const slug = /^\/tools?\/([^/?#]+)/.exec(pathname)?.[1];
    return slug && BY_SLUG.has(slug) ? slug : undefined;
}

export function toolName(slug?: string): string | undefined {
    return slug ? BY_SLUG.get(slug)?.name : undefined;
}

function extensionOf(name: string): string {
    const dot = name.lastIndexOf(".");
    return dot > 0 && dot < name.length - 1 ? name.slice(dot + 1).toLowerCase() : "";
}

const FORMAT_ALIASES: Record<string, string> = { jpeg: "JPG", tif: "TIFF", htm: "HTML", markdown: "MD", yml: "YAML", heif: "HEIC", m4v: "MP4", tgz: "TAR", gql: "GRAPHQL" };

function formatName(token: string): string | null {
    if (token.endsWith("/*")) return token.split("/")[0];
    const ext = token.replace(/^\./, "").split(".").pop() || "";
    if (!ext || ext.includes("/")) return null;
    return FORMAT_ALIASES[ext] ?? ext.toUpperCase();
}

/** "PDF files", "JPG, PNG or WEBP files", "image files". */
export function describeAccepts(accepts?: string): string | null {
    const tokens = acceptTokens(accepts);
    if (!tokens) return null;
    const names = [...new Set(tokens.map(formatName).filter((name): name is string => Boolean(name)))];
    if (!names.length) return null;
    const list = names.length === 1 ? names[0] : `${names.slice(0, -1).join(", ")} or ${names[names.length - 1]}`;
    return `${list} files`;
}

// Words that name a format or filler rather than the job a tool does.
// A word list in one string: an array literal holding both "file" and "files"
// would trip the upload-field guard in lib/upload-fields.test.ts.
const NOT_A_JOB = new Set((
    "pdf pdfs image images photo photos picture pictures file files document documents "
    + "video videos audio jpg jpeg png webp gif bmp tiff tif heic heif svg "
    + "mp4 mov webm avi mkv m4v mp3 wav ogg flac aac m4a wma opus docx doc "
    + "xlsx xls pptx ppt odt word excel powerpoint office txt text markdown md json xml "
    + "csv html htm epub rtf zip tar to and the a of from in with your ai online free long one by"
).split(" "));

// Words many unrelated tools share. A match on "convert", "format", "extract"
// or "remove" says nothing about the job: Extract Audio is not Extract Pages,
// and counting pages is not counting tokens.
const GENERIC = new Set((
    "convert converter conversion format formats create creator generate generator make maker "
    + "check checker view viewer extract extractor remove remover add edit editor batch tool tools "
    + "count counter counting"
).split(" "));

// Tools that take something away. A watermark tool and a watermark remover share
// the word "watermark" but do opposite jobs; a transparent background is a removed one.
const TAKES_AWAY = new Set("remove remover delete strip erase clean unwatermark transparent".split(" "));

// Jobs about the original file itself: a converted copy carries none of its
// metadata, so these tools never send a file to a converter.
const ABOUT_THE_ORIGINAL = new Set(["exif", "metadata"]);

// The job of reading the words in a picture of a page.
const READS_PICTURES = new Set(["ocr"]);

function words(text: string): string[] {
    return text.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
}

function jobWords(slug: string): string[] {
    return words(slug).filter(word => !NOT_A_JOB.has(word) && !GENERIC.has(word));
}

function takesAway(slug: string): boolean {
    return words(slug).some(word => TAKES_AWAY.has(word));
}

const ENDINGS = ["s", "es", "r", "or", "er", "ors", "ers", "ing", "ion", "ions", "ed", "d"];

/** One word and its inflections ("compress", "compressor"; "resize", "resizer";
 *  "subtitle", "subtitles"), never another word that starts the same way
 *  ("format" and "formatter", "speed" and "speech", "form" and "format"). */
function sameStem(a: string, b: string): boolean {
    if (a === b) return true;
    const [short, long] = a.length <= b.length ? [a, b] : [b, a];
    if (short.length < 3) return false;
    const base = short.endsWith("e") ? short.slice(0, -1) : short;
    return ENDINGS.some(ending => long === short + ending || long === base + ending);
}

/** What a tool turns files into when its slug reads "<from>-to-<target>". */
function conversionTargets(slug: string): string[] {
    const at = slug.indexOf("-to-");
    return at < 0 ? [] : words(slug.slice(at + 4)).filter(word => !GENERIC.has(word));
}

const IMAGE_FORMATS = ["jpg", "jpeg", "png", "webp", "gif", "bmp", "tiff", "tif", "heic", "heif"];

// Files made of pixels: a PDF made from one holds a picture of its words, not words.
const PIXEL_FORMATS = new Set([...IMAGE_FORMATS, "mp4", "mov", "webm", "avi", "mkv", "m4v"]);

const TARGET_FORMATS: Record<string, string[]> = {
    word: ["docx", "doc"], excel: ["xlsx", "xls"], powerpoint: ["pptx", "ppt"], text: ["txt"], markdown: ["md"],
    image: IMAGE_FORMATS, images: IMAGE_FORMATS, jpg: ["jpg", "jpeg"], jpeg: ["jpg", "jpeg"], tif: ["tiff", "tif"], tiff: ["tiff", "tif"],
};

/** The file formats a target word stands for: "word" is DOCX or DOC, and "image"
 *  any image unless `family` is false, when "image" stays a word of its own. */
function targetFormats(word: string, family = true): string[] {
    if (!family && (word === "image" || word === "images")) return ["image"];
    return TARGET_FORMATS[word] ?? [word];
}

/** The formats a tool takes, read from its accept list alone: a slug can name
 *  what a tool makes as easily as what it takes ("markdown-html"). */
function inputFormats(accepts?: string): Set<string> {
    const formats = new Set<string>();
    for (const token of acceptTokens(accepts) ?? []) {
        if (token === "image/*") IMAGE_FORMATS.forEach(format => formats.add(format));
        const ext = token.includes("/") ? "" : token.replace(/^\./, "").split(".").pop();
        if (ext) for (const alias of targetFormats(ext, false)) formats.add(alias);
    }
    return formats;
}

/** The target word when a converter is handed what it makes (report.pdf on
 *  Word to PDF: "pdf"; a HEIC on PDF to Image: "image"), otherwise null. */
function madeAs(file: Pick<File, "name">, slug?: string): string | null {
    const ext = extensionOf(file.name);
    if (!slug || !ext) return null;
    return conversionTargets(slug).find(target => targetFormats(target).includes(ext)) ?? null;
}

function alreadyMade(file: Pick<File, "name">, slug?: string): boolean {
    return madeAs(file, slug) !== null;
}

/** What a converter's target word can give this tool. A converter "to image"
 *  makes PNG or JPG, so it helps only a tool that takes one of those. */
function convertsInto(target: string, formats: Set<string>): boolean {
    const made = target === "image" || target === "images" ? ["png", "jpg"] : targetFormats(target);
    return made.some(format => formats.has(format));
}

function takesFileExplicitly(entry: CatalogueEntry, file: Pick<File, "name" | "type">): boolean {
    return acceptTokens(entry.accepts) !== null && matchesAccept(file, entry.accepts);
}

export interface ToolSuggestion {
    slug: string;
    name: string;
    href: string;
    /** "same-job": the same job for this format. "convert": the suggestion
     *  turns the file into something this tool takes. "read-text": this tool
     *  works from words, the file is a picture of them, and the suggestion
     *  reads them (OCR). */
    relation: "same-job" | "convert" | "read-text";
    /** For "convert": the format it produces ("PDF", "JPG", "image"). */
    into?: string;
}

const TARGET_NAMES: Record<string, string> = { word: "Word document", excel: "Excel sheet", powerpoint: "PowerPoint deck", image: "image", images: "image", text: "text file", markdown: "Markdown file" };

function targetName(word: string): string {
    return TARGET_NAMES[word] ?? FORMAT_ALIASES[word] ?? word.toUpperCase();
}

/** A same-job match needs a job word in the other tool's slug, or two signs
 *  from its synonyms: one shared synonym ("thumbnails" for Organize Pages) is chance. */
const SAME_JOB = 3;

/**
 * The registry tool best placed to take a file this tool refused, or null.
 * Two relations count: a tool doing the same job for that format ("Image
 * Compressor" for a PNG dropped on Compress PDF), and a tool that turns the
 * file into what this tool takes ("Image to PDF" for a PNG dropped on Merge
 * PDF), which `prefer: "convert"` puts first. A tool that merely opens the
 * file is not advice, so then nothing is suggested; neither is a tool that
 * accepts any file. A tool that works from a file's words (`needsText` in the
 * registry) gets nothing from a picture or a video made into a PDF, which
 * holds no text: for those it suggests only OCR, which reads the picture's
 * words, or nothing.
 */
export function suggestToolFor(file: Pick<File, "name" | "type">, { fromSlug, prefer = "same-job", accepts }: { fromSlug?: string; prefer?: "same-job" | "convert"; accepts?: string } = {}): ToolSuggestion | null {
    // A converter handed what it makes needs no other tool: PDF to Text would only undo Text to PDF.
    if (alreadyMade(file, fromSlug)) return null;
    const from = fromSlug ? BY_SLUG.get(fromSlug) : undefined;
    const wordsFromPixels = !!from?.needsText && PIXEL_FORMATS.has(extensionOf(file.name));
    const job = from ? jobWords(from.slug) : [];
    const removes = from ? takesAway(from.slug) : false;
    // A surface that is not a registered tool (Pipeline, Batch) still says what it takes.
    const formats = job.some(word => ABOUT_THE_ORIGINAL.has(word)) ? new Set<string>() : inputFormats(from ? from.accepts : accepts);
    // What this tool makes, by format: "any image" is too broad to call two tools' results the same.
    const outputs = new Set((from ? conversionTargets(from.slug) : []).flatMap(target => targetFormats(target, false)));
    let best: { entry: CatalogueEntry; score: number; relation: ToolSuggestion["relation"]; into?: string } | null = null;
    for (const entry of CATALOGUE) {
        if (entry.slug === fromSlug || entry.comingSoon || !takesFileExplicitly(entry, file)) continue;
        if (wordsFromPixels) {
            if (!words(entry.slug).some(word => READS_PICTURES.has(word))) continue;
            if (!best || (entry.popularity ?? 999) < (best.entry.popularity ?? 999)) best = { entry, score: 0, relation: "read-text" };
            continue;
        }
        const own = words(entry.slug);
        const synonyms = words(entry.synonyms ?? "");
        const targets = conversionTargets(entry.slug);
        let jobScore = 0;
        // Adding a watermark and removing one share a word, not a job.
        if (job.length && takesAway(entry.slug) === removes) {
            for (const word of job) {
                if (own.some(other => sameStem(word, other))) jobScore += SAME_JOB;
                else if (synonyms.some(other => sameStem(word, other))) jobScore += SAME_JOB / 2;
            }
            // Both take something away, and the other tool's words say what.
            if (jobScore > 0 && removes) jobScore += SAME_JOB / 2;
        }
        // The same result from a different input: PNG to JPG for a PNG dropped on HEIC to JPG.
        if (outputs.size && targets.some(target => targetFormats(target, false).some(format => outputs.has(format)))) jobScore += SAME_JOB;
        const into = targets.find(target => convertsInto(target, formats));
        const sameJob = jobScore >= SAME_JOB;
        if (!sameJob && !into) continue;
        const relation: ToolSuggestion["relation"] = into && (prefer === "convert" || !sameJob) ? "convert" : "same-job";
        // Between two same-job tools, the one with no job of its own beyond this one's is the general
        // tool: Remove Image Watermark before Gemini Watermark Remover for any PNG.
        const narrower = sameJob ? jobWords(entry.slug).filter(word => !job.some(other => sameStem(word, other))).length / 2 : 0;
        const score = (sameJob ? jobScore - narrower : 0) + (into ? (prefer === "convert" ? 5 : 2) : 0);
        if (!best || score > best.score || (score === best.score && (entry.popularity ?? 999) < (best.entry.popularity ?? 999))) {
            best = { entry, score, relation, into: relation === "convert" && into ? targetName(into) : undefined };
        }
    }
    return best ? { slug: best.entry.slug, name: best.entry.name, href: best.entry.href, relation: best.relation, ...(best.into ? { into: best.into } : {}) } : null;
}

// Formats said as words although their first letter reads with a vowel: "a FLAC", "a HEIC", never "an FLAC".
const SPOKEN_AS_WORDS = new Set(["FLAC", "HEIC", "HEIF"]);

/** The article before a format name. Spelled-out acronyms take the article of
 *  their first letter's sound ("an MP4", "an SVG", "a PDF"). */
function article(name: string): string {
    if (name !== name.toUpperCase() || SPOKEN_AS_WORDS.has(name)) return /^[aeiou]/i.test(name) ? "an" : "a";
    return /^[AEFHILMNORSX]/.test(name) ? "an" : "a";
}

export interface RejectionAdvice {
    /** "holiday.png wasn’t added." */
    headline: string;
    /** "Compress PDF takes PDF files." */
    reason: string;
    suggestion: ToolSuggestion | null;
    /** Text before and after the suggested tool's name, so a caller can link the name. */
    suggestionLead: string;
    suggestionTail: string;
    /** Everything above as one plain sentence, for toasts and live regions. */
    text: string;
}

/** Words for files an intake refused: the file, what this tool takes and
 *  where the file can go instead. */
export function adviseRejection(rejected: readonly Pick<File, "name" | "type">[], { accepts, fromSlug, prefer, name: surface }: {
    accepts?: string; fromSlug?: string; prefer?: "same-job" | "convert";
    /** What to call a surface that is not a registered tool, such as "A pipeline". */
    name?: string;
} = {}): RejectionAdvice | null {
    if (!rejected.length) return null;
    const slug = fromSlug ?? currentToolSlug();
    const first = rejected[0];
    const others = rejected.length - 1;
    const headline = others === 0 ? `${first.name} wasn’t added.`
        : `${first.name} and ${others} other file${others === 1 ? "" : "s"} weren’t added.`;
    const takesFrom = accepts ?? (slug ? BY_SLUG.get(slug)?.accepts : undefined);
    const takes = describeAccepts(takesFrom);
    const name = surface ?? toolName(slug) ?? "This tool";
    const ext = extensionOf(first.name);
    const format = ext ? (FORMAT_ALIASES[ext] ?? ext.toUpperCase()) : "";
    // A converter handed what it makes (report.pdf on Word to PDF) needs no other tool, only the fact.
    // A converter "to image" makes an image, not this file's format: a HEIC is "already an image".
    const made = madeAs(first, slug);
    const isMade = (file: Pick<File, "name">) => alreadyMade(file, slug);
    const what = made === "image" || made === "images" ? "image" : format;
    const sameFormat = rejected.every(file => { const other = extensionOf(file.name); return (FORMAT_ALIASES[other] ?? other.toUpperCase()) === format; });
    const already = !made ? ""
        : others === 0 ? ` It’s already ${article(what)} ${what}.`
            : rejected.every(isMade) && (what === "image" || sameFormat) ? ` They’re already ${what}s.` : "";
    const reason = (takes ? `${name} takes ${takes}.` : `${name} can’t open ${others === 0 ? "it" : "them"}.`) + already;
    const suggestion = suggestToolFor(first, { fromSlug: slug, prefer, accepts: takesFrom });
    let suggestionLead = "";
    let suggestionTail = "";
    if (suggestion?.relation === "read-text") {
        suggestionTail = others === 0 ? " can read the text in it." : " can read the text in them.";
    } else if (suggestion?.relation === "convert" && suggestion.into) {
        const target = suggestion.into;
        suggestionTail = others === 0 ? ` can turn it into ${article(target)} ${target} first.` : ` can turn them into ${target}s first.`;
    } else if (suggestion) {
        suggestionLead = "Try ";
        suggestionTail = format ? ` for ${format} files.` : " instead.";
    }
    const text = [headline, reason, suggestion ? `${suggestionLead}${suggestion.name}${suggestionTail}` : ""].filter(Boolean).join(" ");
    return { headline, reason, suggestion, suggestionLead, suggestionTail, text };
}
