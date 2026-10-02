/** "1 PDF", "3 images": a count of what will be run, for a tool's action bar. */
export function fileCount(count: number, noun = "file", plural = `${noun}s`): string {
    return `${count} ${count === 1 ? noun : plural}`;
}

/** The accepted types a count can name, each by what one of them is called. */
const NOUNS: [pattern: RegExp, noun: string][] = [
    [/^(\.pdf|application\/pdf)$/, "PDF"],
    [/^(\.(png|jpe?g|webp|gif|bmp|tiff?|heic|heif|avif|svg|ico)|image\/.+)$/, "image"],
    [/^(\.(mp4|mov|webm|avi|mkv|m4v|wmv|flv|3gp|mpe?g)|video\/.+)$/, "video"],
    [/^(\.(mp3|wav|m4a|ogg|oga|flac|aac|opus|wma|aiff?)|audio\/.+)$/, "audio file"],
];

/**
 * What one of the files a tool takes is called, for fileCount: "PDF" when it
 * takes only PDFs, "image", "video" or "audio file" when it takes only those,
 * otherwise "file".
 */
export function fileNoun(accepts?: string): string {
    const parts = (accepts ?? "").split(",").map(part => part.trim().toLowerCase()).filter(Boolean);
    const nouns = new Set(parts.map(part => NOUNS.find(([pattern]) => pattern.test(part))?.[1] ?? "file"));
    return nouns.size === 1 ? [...nouns][0] : "file";
}

export function fileFormatLabel(accepts?: string) {
    const first = (accepts?.split(",")[0] || "file").trim();
    if (first === "*" || first === "*/*") return "FILE";
    if (first.endsWith("/*")) return first.split("/")[0].toUpperCase();
    return first.replace(/^\./, "").split("/").pop()?.replace("jpeg", "jpg").toUpperCase() || "FILE";
}
