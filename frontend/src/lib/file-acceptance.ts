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
    + "xlsx xls pptx ppt odt word excel powerpoint office txt markdown md json xml "
    + "csv html htm epub rtf zip tar to and the a of from in with your ai online free long one by"
).split(" "));

function words(text: string): string[] {
    return text.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
}

function jobWords(slug: string): string[] {
    return words(slug).filter(word => !NOT_A_JOB.has(word));
}

function sameStem(a: string, b: string): boolean {
    if (a === b) return true;
    if (a.length < 4 || b.length < 4) return false;
    const shorter = a.length <= b.length ? a : b;
    const longer = shorter === a ? b : a;
    return longer.startsWith(shorter.slice(0, Math.max(4, shorter.length - 2)));
}

/** A job word shared by few tools ("background") says more than a common one ("remove"). */
function specificity(word: string): number {
    const tools = CATALOGUE.filter(entry => words(entry.slug).some(other => sameStem(word, other))).length;
    return tools <= 4 ? 3 : 1.5;
}

/** What a tool turns files into when its slug reads "<from>-to-<target>". */
function conversionTargets(slug: string): string[] {
    const at = slug.indexOf("-to-");
    return at < 0 ? [] : words(slug.slice(at + 4));
}

const IMAGE_FORMATS = ["jpg", "jpeg", "png", "webp", "gif", "bmp", "tiff", "tif", "heic", "heif"];

/** The formats a tool takes: its accepted extensions and the format words
 *  that name its input ("heic" in heic-to-jpg, never the "jpg" it makes). */
function inputFormats(entry: CatalogueEntry): Set<string> {
    const formats = new Set<string>();
    for (const token of acceptTokens(entry.accepts) ?? []) {
        const ext = token.replace(/^\./, "").split(".").pop();
        if (ext) formats.add(ext);
    }
    const at = entry.slug.indexOf("-to-");
    for (const word of words(at < 0 ? entry.slug : entry.slug.slice(0, at))) if (NOT_A_JOB.has(word)) formats.add(word);
    if ([...formats].some(format => IMAGE_FORMATS.includes(format))) formats.add("image");
    return formats;
}

function takesFileExplicitly(entry: CatalogueEntry, file: Pick<File, "name" | "type">): boolean {
    return acceptTokens(entry.accepts) !== null && matchesAccept(file, entry.accepts);
}

export interface ToolSuggestion {
    slug: string;
    name: string;
    href: string;
    /** "convert": the suggestion turns the file into something this tool takes. */
    relation: "same-job" | "convert" | "takes-it";
    /** For "convert": the format it produces ("PDF", "JPG", "image"). */
    into?: string;
}

const TARGET_NAMES: Record<string, string> = { word: "Word document", excel: "Excel sheet", powerpoint: "PowerPoint deck", image: "image", images: "image", text: "text file", markdown: "Markdown file" };

function targetName(word: string): string {
    return TARGET_NAMES[word] ?? FORMAT_ALIASES[word] ?? word.toUpperCase();
}

/**
 * The registry tool best placed to take a file this tool refused. It prefers
 * a tool doing the same job for that format ("Image Compressor" for a PNG
 * dropped on Compress PDF) or, with `prefer: "convert"`, a tool that turns the
 * file into what this tool takes ("Image to PDF" for a PNG dropped on Merge
 * PDF). Tools that accept any file are never suggested.
 */
export function suggestToolFor(file: Pick<File, "name" | "type">, { fromSlug, prefer = "same-job", accepts }: { fromSlug?: string; prefer?: "same-job" | "convert"; accepts?: string } = {}): ToolSuggestion | null {
    const from = fromSlug ? BY_SLUG.get(fromSlug) : undefined;
    const job = from ? jobWords(from.slug).map(word => ({ word, weight: specificity(word) })) : [];
    // A surface that is not a registered tool (Pipeline, Batch) still says what it takes.
    const formats = inputFormats(from ?? { slug: "", name: "", accepts: accepts ?? "", outputLabel: "", href: "" });
    const outputs = from ? conversionTargets(from.slug) : [];
    let best: { entry: CatalogueEntry; score: number; relation: ToolSuggestion["relation"]; into?: string } | null = null;
    for (const entry of CATALOGUE) {
        if (entry.slug === fromSlug || entry.comingSoon || !takesFileExplicitly(entry, file)) continue;
        const own = words(entry.slug);
        const synonyms = words(entry.synonyms ?? "");
        const targets = conversionTargets(entry.slug);
        let jobScore = 0;
        for (const { word, weight } of job) {
            if (own.some(other => sameStem(word, other))) jobScore += weight;
            else if (synonyms.some(other => sameStem(word, other))) jobScore += weight / 2;
        }
        // Same result from a different input: PNG to JPG for a PNG dropped on HEIC to JPG.
        if (outputs.length && targets.some(target => outputs.includes(target))) jobScore += 3;
        const into = targets.find(target => formats.has(target));
        const score = jobScore + (into ? (prefer === "convert" ? 5 : 2) : 0);
        const relation: ToolSuggestion["relation"] = into && (prefer === "convert" || jobScore < 2) ? "convert" : jobScore > 0 ? "same-job" : "takes-it";
        if (!best || score > best.score || (score === best.score && (entry.popularity ?? 999) < (best.entry.popularity ?? 999))) {
            best = { entry, score, relation, into: relation === "convert" && into ? targetName(into) : undefined };
        }
    }
    return best ? { slug: best.entry.slug, name: best.entry.name, href: best.entry.href, relation: best.relation, ...(best.into ? { into: best.into } : {}) } : null;
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
    const reason = takes ? `${name} takes ${takes}.` : `${name} can’t open ${others === 0 ? "it" : "them"}.`;
    const suggestion = suggestToolFor(first, { fromSlug: slug, prefer, accepts: takesFrom });
    const ext = extensionOf(first.name);
    const format = ext ? (FORMAT_ALIASES[ext] ?? ext.toUpperCase()) : "";
    let suggestionLead = "";
    let suggestionTail = "";
    if (suggestion?.relation === "convert" && suggestion.into) {
        const target = suggestion.into;
        // Acronyms take the article of their spoken letter ("an MP4", "a PDF").
        const vowelSound = target === target.toUpperCase() ? /^[AEFHILMNORSX]/.test(target) : /^[aeiou]/i.test(target);
        suggestionTail = others === 0 ? ` can turn it into ${vowelSound ? "an" : "a"} ${target} first.` : ` can turn them into ${target}s first.`;
    } else if (suggestion) {
        suggestionLead = "Try ";
        suggestionTail = format ? ` for ${format} files.` : " instead.";
    }
    const text = [headline, reason, suggestion ? `${suggestionLead}${suggestion.name}${suggestionTail}` : ""].filter(Boolean).join(" ");
    return { headline, reason, suggestion, suggestionLead, suggestionTail, text };
}
