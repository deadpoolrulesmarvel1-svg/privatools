/** "1 PDF", "3 images": a count of what will be run, for a tool's action bar. */
export function fileCount(count: number, noun = "file", plural = `${noun}s`): string {
    return `${count} ${count === 1 ? noun : plural}`;
}

export function fileFormatLabel(accepts?: string) {
    const first = (accepts?.split(",")[0] || "file").trim();
    if (first === "*" || first === "*/*") return "FILE";
    if (first.endsWith("/*")) return first.split("/")[0].toUpperCase();
    return first.replace(/^\./, "").split("/").pop()?.replace("jpeg", "jpg").toUpperCase() || "FILE";
}
