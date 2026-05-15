/**
 * Subtitle converter — SRT ↔ VTT (and basic ASS → SRT).
 * 100% client-side: parses + emits in the browser.
 */
import { useMemo, useRef, useState } from "react";
import { Upload, AlertCircle, X, FileText, Download } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { downloadBlob, formatFileSize } from "@/lib/api";

type Target = "srt" | "vtt";

interface Cue { index: number; start: number; end: number; text: string }

function parseTime(t: string): number {
    // Accepts "HH:MM:SS,mmm" (SRT) or "HH:MM:SS.mmm" (VTT)
    const m = t.replace(",", ".").match(/^(\d+):(\d{2}):(\d{2})(?:\.(\d+))?$/);
    if (!m) return 0;
    return +m[1] * 3600 + +m[2] * 60 + +m[3] + (+(m[4] || "0") / 1000);
}

function formatTime(sec: number, sep: "," | "."): string {
    const h = Math.floor(sec / 3600);
    const m = Math.floor((sec % 3600) / 60);
    const s = Math.floor(sec % 60);
    const ms = Math.round((sec % 1) * 1000);
    return `${h.toString().padStart(2, "0")}:${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}${sep}${ms.toString().padStart(3, "0")}`;
}

function parseSrtVtt(text: string): Cue[] {
    // Strip VTT header if present
    const body = text.replace(/^WEBVTT[^\n]*\n/, "").trim();
    const blocks = body.split(/\r?\n\r?\n+/).filter(Boolean);
    const cues: Cue[] = [];
    for (const blk of blocks) {
        const lines = blk.split(/\r?\n/);
        let idx = cues.length + 1;
        let timeLine = lines[0];
        if (/^\d+$/.test(lines[0])) { idx = +lines[0]; timeLine = lines[1] || ""; }
        const m = timeLine.match(/^([\d:.,]+)\s*-->\s*([\d:.,]+)/);
        if (!m) continue;
        const text = lines.slice(/^\d+$/.test(lines[0]) ? 2 : 1).join("\n");
        cues.push({ index: idx, start: parseTime(m[1]), end: parseTime(m[2]), text });
    }
    return cues;
}

function parseAss(text: string): Cue[] {
    const lines = text.split(/\r?\n/);
    const cues: Cue[] = [];
    for (const line of lines) {
        if (!line.startsWith("Dialogue:")) continue;
        const parts = line.slice(9).split(",");
        if (parts.length < 10) continue;
        const start = parseTime("0" + parts[1].trim());
        const end = parseTime("0" + parts[2].trim());
        const txt = parts.slice(9).join(",").replace(/\\N/g, "\n").replace(/\{[^}]+\}/g, "");
        cues.push({ index: cues.length + 1, start, end, text: txt });
    }
    return cues;
}

function toSrt(cues: Cue[]): string {
    return cues.map(c =>
        `${c.index}\n${formatTime(c.start, ",")} --> ${formatTime(c.end, ",")}\n${c.text}`
    ).join("\n\n") + "\n";
}

function toVtt(cues: Cue[]): string {
    return "WEBVTT\n\n" + cues.map(c =>
        `${formatTime(c.start, ".")} --> ${formatTime(c.end, ".")}\n${c.text}`
    ).join("\n\n") + "\n";
}

export function SubtitleConverterUI() {
    const [file, setFile] = useState<File | null>(null);
    const [text, setText] = useState("");
    const [target, setTarget] = useState<Target>("vtt");
    const [drag, setDrag] = useState(false);
    const inputRef = useRef<HTMLInputElement>(null);

    const result = useMemo(() => {
        if (!text.trim()) return { ok: false, output: "", count: 0, error: "Upload a subtitle file." };
        try {
            const isAss = /^\[Script Info\]/.test(text) || /^Dialogue:/m.test(text);
            const cues = isAss ? parseAss(text) : parseSrtVtt(text);
            if (!cues.length) return { ok: false, output: "", count: 0, error: "Couldn't find any cues — is the file valid?" };
            const output = target === "srt" ? toSrt(cues) : toVtt(cues);
            return { ok: true, output, count: cues.length, error: "" };
        } catch (err) {
            return { ok: false, output: "", count: 0, error: err instanceof Error ? err.message : String(err) };
        }
    }, [text, target]);

    const onPick = async (f: File | null) => {
        if (!f) { setFile(null); setText(""); return; }
        setFile(f);
        setText(await f.text());
    };

    const handleDownload = () => {
        if (!result.ok) return;
        const baseName = (file?.name || "subtitles").replace(/\.[^.]+$/, "");
        const blob = new Blob([result.output], { type: target === "srt" ? "application/x-subrip" : "text/vtt" });
        downloadBlob(blob, `${baseName}.${target}`);
    };

    return (
        <div className="space-y-4">
            <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/[0.04] px-4 py-3 flex items-start gap-3">
                <FileText size={14} className="text-emerald-400 mt-0.5 shrink-0" />
                <p className="text-[13px] text-muted-foreground leading-snug">
                    <span className="text-foreground font-medium">100% browser-side.</span> Parsing happens in JavaScript — your subtitles never touch a server.
                </p>
            </div>

            {!file ? (
                <div
                    onDragOver={e => { e.preventDefault(); setDrag(true); }}
                    onDragLeave={() => setDrag(false)}
                    onDrop={e => { e.preventDefault(); setDrag(false); onPick(e.dataTransfer.files[0] || null); }}
                    onClick={() => inputRef.current?.click()}
                    onKeyDown={e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); inputRef.current?.click(); } }}
                    role="button"
                    tabIndex={0}
                    aria-label="Upload subtitle file"
                    className={cn(
                        "flex flex-col items-center justify-center gap-3 rounded-2xl border-2 border-dashed cursor-pointer transition-all py-12 px-6 text-center",
                        drag ? "border-accent bg-accent/5" : "border-border hover:border-accent/40 hover:bg-secondary/40 bg-secondary/20"
                    )}
                >
                    <input ref={inputRef} type="file" accept=".srt,.vtt,.ass" className="hidden" onChange={e => onPick(e.target.files?.[0] || null)} />
                    <Upload size={22} className="text-muted-foreground" />
                    <p className="text-sm font-semibold text-foreground">Pick a subtitle file</p>
                    <p className="text-xs text-muted-foreground">.srt, .vtt, or .ass</p>
                </div>
            ) : (
                <div className="flex items-center gap-3 rounded-xl border border-border bg-card/60 px-4 py-3">
                    <FileText size={18} className="text-accent shrink-0" />
                    <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-foreground truncate">{file.name}</p>
                        <p className="text-xs text-muted-foreground">
                            {formatFileSize(file.size)}{result.ok && ` · ${result.count} cues`}
                        </p>
                    </div>
                    <button onClick={() => onPick(null)} aria-label="Remove" className="text-muted-foreground hover:text-foreground">
                        <X size={16} />
                    </button>
                </div>
            )}

            <div className="rounded-xl border border-border bg-card/40 p-5">
                <p className="text-sm font-semibold text-foreground mb-3">Convert to</p>
                <div className="flex gap-2">
                    {(["vtt", "srt"] as Target[]).map(t => (
                        <button
                            key={t}
                            type="button"
                            onClick={() => setTarget(t)}
                            aria-pressed={target === t}
                            className={cn(
                                "flex-1 h-10 rounded-full border text-[14px] font-semibold transition-colors",
                                target === t ? "border-accent bg-accent/5 text-foreground" : "border-border text-muted-foreground hover:bg-secondary/40 hover:text-foreground"
                            )}
                        >
                            {t === "vtt" ? "WebVTT (.vtt)" : "SubRip (.srt)"}
                        </button>
                    ))}
                </div>
            </div>

            {!result.ok && file && (
                <div className="flex items-center gap-2 rounded-xl border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive">
                    <AlertCircle size={15} />{result.error}
                </div>
            )}

            {result.ok && (
                <div className="flex items-center gap-3">
                    <Button onClick={handleDownload} className="rounded-full h-10 px-5 bg-foreground text-background hover:bg-foreground/90">
                        <Download size={14} className="mr-1.5" /> Download .{target}
                    </Button>
                    <span className="text-[12px] text-muted-foreground">{result.count} cues converted</span>
                </div>
            )}
        </div>
    );
}
