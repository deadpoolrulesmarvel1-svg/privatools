/**
 * The real tool registry, in each imported design's own shape.
 *
 * The ported designs each shipped a sample catalogue — 61, 36 and 65 records —
 * and declared totals of 221 / 107 / 114 that were never true. The registry has
 * 219: 106 PDF and 113 non-PDF, and every count here is derived from it at
 * runtime, so a tool added to the registry appears in all four themes with no
 * further edit and no number can drift.
 *
 * `scripts/build-skin-app.mjs` swaps each design's sample data for the matching
 * export below, so the designs' own rendering, filtering and counting code runs
 * unchanged over real records.
 */
import { tools, type Tool, type Category } from "@/data/tools";
import { nonPdfTools, type NonPdfTool } from "@/data/non-pdf-tools";

/* ── shared mappings ──────────────────────────────────────────────────── */

/** Our PDF categories to the subfamily names the designs group PDF by. */
const PDF_SUBFAMILY: Record<Category, string> = {
    "to-pdf": "Convert to PDF",
    "edit": "Edit",
    "from-pdf": "Convert from PDF",
    "organize": "Organise",
    "optimize": "Optimise",
    "advanced": "Advanced",
    "security": "Security",
};

/** Our PDF categories to the designs' task vocabulary. */
const PDF_TASK: Record<Category, string> = {
    "to-pdf": "Convert", "from-pdf": "Convert", "edit": "Edit",
    "organize": "Organise", "optimize": "Compress", "advanced": "Advanced",
    "security": "Security",
};

/**
 * Family vocabularies, per design.
 *
 * Each design hardcodes its own family list and looks up icons and colours by
 * that exact string — an unfamiliar one is not ignored, it throws. So the
 * mapping is per design rather than shared, and `familyFor` falls back to a
 * family the design definitely knows.
 *
 *   Aurora      PDF Images Video Audio Archives Documents Security Automate
 *   Carbon      PDF Images Video Audio Archives "Documents & Data" "Security & Privacy" Automate
 *   Structured  PDF Images Video Audio Archives "Documents & Data"
 *
 * Two mismatches with our own registry, both resolved deliberately:
 *
 * - All three split Video and Audio; our registry has one `video-audio`
 *   category. `isAudioTool` splits it by inspecting the tool.
 * - Only Aurora and Carbon have an "Automate" family for developer utilities.
 *   Structured has none, so its 26 developer tools land in Documents & Data —
 *   imprecise, but the alternative is a family the design cannot render.
 */
type FamilyMap = Record<string, string>;

const AURORA_FAMILIES: FamilyMap = {
    image: "Images", video: "Video", audio: "Audio",
    developer: "Automate", archive: "Archives", "document-office": "Documents",
};
const CARBON_FAMILIES: FamilyMap = {
    image: "Images", video: "Video", audio: "Audio",
    developer: "Automate", archive: "Archives", "document-office": "Documents & Data",
};
const STRUCTURED_FAMILIES: FamilyMap = {
    image: "Images", video: "Video", audio: "Audio",
    developer: "Documents & Data", archive: "Archives", "document-office": "Documents & Data",
};

/** Audio hints in the slug, name or accepted types. */
const AUDIO = /\b(audio|mp3|wav|flac|m4a|aac|ogg|opus|wma|voice|sound|podcast)\b/i;

function isAudioTool(t: { slug: string; name: string; accepts?: string }): boolean {
    return AUDIO.test(`${t.slug} ${t.name} ${t.accepts ?? ""}`);
}

/** Resolve a non-PDF tool to a family this design can actually render. */
function familyFor(map: FamilyMap, t: NonPdfTool, fallback: string): string {
    const key = t.category === "video-audio" ? (isAudioTool(t) ? "audio" : "video") : t.category;
    return map[key] ?? fallback;
}

/**
 * A Material Symbols name per family/category. The designs render icons as
 * Material Symbols and our registry carries lucide components, which cannot be
 * translated automatically — so this is a deliberate per-category choice rather
 * than a guess per tool.
 */
const ICON: Record<string, string> = {
    "to-pdf": "picture_as_pdf", "from-pdf": "file_export", "edit": "edit_document",
    "organize": "reorder", "optimize": "compress", "advanced": "auto_awesome",
    "security": "lock", image: "image", "video-audio": "movie",
    developer: "code", archive: "folder_zip", "document-office": "description",
};

/**
 * How a tool runs. `clientOnly` is recorded per tool in the registry and is the
 * only honest source for this — the designs' own records claimed a processing
 * mode for tools whose mode was never verified, and their QA reports flagged it.
 */
const modeOf = (t: { clientOnly?: boolean }) => (t.clientOnly ? "local" : "server");

const popular = (t: { popularity?: number }) => (t.popularity ?? 999) <= 12;

/* ── Obsidian Aurora ──────────────────────────────────────────────────── */

export const AURORA_CATALOGUE = [
    ...tools.map((t: Tool) => ({
        slug: t.slug, name: t.name, fam: "PDF", runs: modeOf(t),
        desc: t.description, icon: ICON[t.category] ?? "picture_as_pdf",
        tasks: [PDF_TASK[t.category]], syn: t.synonyms ?? "", popular: popular(t),
    })),
    ...nonPdfTools.map((t: NonPdfTool) => ({
        slug: t.slug, name: t.name, fam: familyFor(AURORA_FAMILIES, t, "Documents"),
        runs: modeOf(t), desc: t.description, icon: ICON[t.category] ?? "description",
        tasks: ["Convert"], syn: t.synonyms ?? "", popular: popular(t),
    })),
];

/* ── Carbon Glass ─────────────────────────────────────────────────────── */

export const CARBON_REGISTRY = {
    schemaVersion: 1,
    source: "privatools-registry",
    supplied: true,
    planned: {
        total: tools.length + nonPdfTools.length,
        pdf: tools.length,
        nonPdf: nonPdfTools.length,
    },
    plannedPdfSubfamilies: tools.reduce<Record<string, number>>((acc, t) => {
        const key = PDF_SUBFAMILY[t.category];
        acc[key] = (acc[key] ?? 0) + 1;
        return acc;
    }, {}),
    records: [
        ...tools.map((t: Tool) => ({
            slug: t.slug, name: t.name, family: "PDF", subfamily: PDF_SUBFAMILY[t.category],
            description: t.description, inputs: [t.accepts.replace(/^\./, "").toUpperCase()],
            outputs: [t.outputLabel], mode: modeOf(t), tasks: [PDF_TASK[t.category]],
            icon: ICON[t.category] ?? "picture_as_pdf", popular: popular(t),
        })),
        ...nonPdfTools.map((t: NonPdfTool) => ({
            slug: t.slug, name: t.name, family: familyFor(CARBON_FAMILIES, t, "Documents & Data"),
            subfamily: "", description: t.description,
            inputs: [(t.accepts ?? "").replace(/^\./, "").toUpperCase() || "Any"],
            outputs: [t.outputLabel ?? "file"], mode: modeOf(t), tasks: ["Convert"],
            icon: ICON[t.category] ?? "description", popular: popular(t),
        })),
    ],
};

/* ── Structured Privacy OS ────────────────────────────────────────────── */

export const STRUCTURED_CATALOGUE = {
    meta: {
        declaredTotal: tools.length + nonPdfTools.length,
        declaredPdf: tools.length,
        declaredNonPdf: nonPdfTools.length,
        pdfSubfamilies: CARBON_REGISTRY.plannedPdfSubfamilies,
        publicCopy: `${tools.length + nonPdfTools.length} free file tools`,
        dataset: "real",
        note: "Derived from the PrivaTools registry at runtime.",
    },
    records: [
        ...tools.map((t: Tool) => ({
            slug: t.slug, name: t.name, purpose: t.description, family: "PDF",
            subfamily: PDF_SUBFAMILY[t.category], task: PDF_TASK[t.category],
            mode: modeOf(t), input: t.accepts.replace(/^\./, "").toUpperCase(),
            output: t.outputLabel, popular: popular(t),
        })),
        ...nonPdfTools.map((t: NonPdfTool) => ({
            slug: t.slug, name: t.name, purpose: t.description,
            family: familyFor(STRUCTURED_FAMILIES, t, "Documents & Data"),
            task: "Convert", mode: modeOf(t),
            input: (t.accepts ?? "").replace(/^\./, "").toUpperCase() || "ANY",
            output: t.outputLabel ?? "file", popular: popular(t),
        })),
    ],
};

/** Sanity figures, exported so tests can assert against the registry itself. */
export const CATALOGUE_COUNTS = {
    total: tools.length + nonPdfTools.length,
    pdf: tools.length,
    nonPdf: nonPdfTools.length,
};
