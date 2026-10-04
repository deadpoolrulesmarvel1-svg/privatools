/**
 * Language pairs for in-browser translation.
 *
 * Backed by Helsinki-NLP's OPUS-MT models in the Xenova ONNX conversions, which
 * run through transformers.js entirely on the user's device — the same
 * local-first arrangement Summarize PDF and Smart Redact already use. Nothing
 * is uploaded and no API key is involved.
 *
 * The pair list is NOT a guess. It was generated from the HuggingFace model
 * index and each entry was checked for ONNX weights before being listed here.
 * The matrix is deliberately asymmetric because the models are: Romanian has an
 * en->ro model but no ro->en one, while Japanese, Korean, Polish, Thai, Turkish
 * and Estonian have ->en models with no en-> counterpart. Offering a pair whose
 * model does not exist would fail after a long download, which is the worst
 * possible moment to find out.
 */

export interface Language {
    code: string;
    name: string;
}

/** Every language reachable in at least one direction. */
export const LANGUAGES: Record<string, string> = {
    af: "Afrikaans",
    ar: "Arabic",
    cs: "Czech",
    da: "Danish",
    de: "German",
    en: "English",
    es: "Spanish",
    et: "Estonian",
    fi: "Finnish",
    fr: "French",
    hi: "Hindi",
    hu: "Hungarian",
    id: "Indonesian",
    it: "Italian",
    ja: "Japanese",
    ko: "Korean",
    nl: "Dutch",
    pl: "Polish",
    ro: "Romanian",
    ru: "Russian",
    sv: "Swedish",
    th: "Thai",
    tr: "Turkish",
    uk: "Ukrainian",
    vi: "Vietnamese",
    zh: "Chinese",
};

/** Targets reachable FROM English. */
export const FROM_ENGLISH = [
    "af", "ar", "cs", "da", "de", "es", "fi", "fr", "hi", "hu",
    "id", "it", "nl", "ro", "ru", "sv", "uk", "vi", "zh",
] as const;

/** Sources translatable INTO English. */
export const TO_ENGLISH = [
    "af", "ar", "cs", "da", "de", "es", "et", "fi", "fr", "hi", "hu", "id",
    "it", "ja", "ko", "nl", "pl", "ru", "sv", "th", "tr", "uk", "vi", "zh",
] as const;

/** Model download size, so the UI can warn before a long first run. */
export const APPROX_MODEL_MB = 107;

export function modelIdFor(source: string, target: string): string | null {
    if (source === target) return null;
    if (source === "en") {
        return (FROM_ENGLISH as readonly string[]).includes(target)
            ? `Xenova/opus-mt-en-${target}`
            : null;
    }
    if (target === "en") {
        return (TO_ENGLISH as readonly string[]).includes(source)
            ? `Xenova/opus-mt-${source}-en`
            : null;
    }
    // Non-English pairs would need pivoting through English, which means two
    // model downloads and compounded errors. Not offered rather than offered badly.
    return null;
}

export function isSupported(source: string, target: string): boolean {
    return modelIdFor(source, target) !== null;
}

/** Targets valid for a chosen source, for populating the second dropdown. */
export function targetsFor(source: string): string[] {
    if (source === "en") return [...FROM_ENGLISH];
    return (TO_ENGLISH as readonly string[]).includes(source) ? ["en"] : [];
}

/** Sources we can translate from at all. */
export function availableSources(): string[] {
    return ["en", ...TO_ENGLISH].filter((v, i, a) => a.indexOf(v) === i);
}

export function languageName(code: string): string {
    return LANGUAGES[code] ?? code;
}

export interface TargetLanguage {
    /** What the model is told to translate into, and what the page shows. */
    name: string;
    /** The tag a file name and a VTT header carry: ISO 639-1, with the region players use for Chinese. */
    code: string;
}

/**
 * Targets offered with the visitor's own AI key: a language model translates
 * into any of these from whatever language the text is in, which it works
 * out itself, far beyond the one-directional OPUS-MT pairs above.
 */
export const BYOK_TARGETS: readonly TargetLanguage[] = [
    { name: "English", code: "en" }, { name: "Spanish", code: "es" }, { name: "French", code: "fr" },
    { name: "German", code: "de" }, { name: "Italian", code: "it" }, { name: "Portuguese", code: "pt" },
    { name: "Dutch", code: "nl" }, { name: "Polish", code: "pl" }, { name: "Ukrainian", code: "uk" },
    { name: "Russian", code: "ru" }, { name: "Turkish", code: "tr" }, { name: "Arabic", code: "ar" },
    { name: "Hebrew", code: "he" }, { name: "Hindi", code: "hi" }, { name: "Bengali", code: "bn" },
    { name: "Indonesian", code: "id" }, { name: "Vietnamese", code: "vi" }, { name: "Thai", code: "th" },
    { name: "Chinese (Simplified)", code: "zh-CN" }, { name: "Chinese (Traditional)", code: "zh-TW" },
    { name: "Japanese", code: "ja" }, { name: "Korean", code: "ko" }, { name: "Swedish", code: "sv" },
    { name: "Norwegian", code: "no" }, { name: "Danish", code: "da" }, { name: "Finnish", code: "fi" },
    { name: "Czech", code: "cs" }, { name: "Romanian", code: "ro" }, { name: "Greek", code: "el" },
    { name: "Hungarian", code: "hu" },
];

/** The BYOK targets by name, as Translate PDF lists them. */
export const BYOK_LANGS: readonly string[] = BYOK_TARGETS.map(language => language.name);

export function byokTarget(name: string): TargetLanguage | undefined {
    return BYOK_TARGETS.find(language => language.name === name);
}
