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
