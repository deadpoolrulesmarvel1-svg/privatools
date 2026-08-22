/**
 * SubtitleConverterUI — SRT ↔ VTT (and basic ASS → SRT/VTT) in-browser.
 * Workshop: lab-card with cue counter, format toggle, signal-green CTA.
 */
import { useMemo, useRef, useState, useCallback} from "react";
import { Upload, AlertCircle, X, FileText, Download, ShieldCheck, Sparkles } from "lucide-react";
import { cn } from "@/lib/utils";
import { downloadBlob, formatFileSize } from "@/lib/api";
import { useToolDefaults } from "@/hooks/useToolDefaults";

const SAMPLE_SRT = `1
00:00:00,500 --> 00:00:03,200
Welcome to PrivaTools.

2
00:00:03,500 --> 00:00:07,800
Subtitle conversion runs entirely in your browser.

3
00:00:08,100 --> 00:00:11,400
No upload — your captions never touch a server.
`;

type Target = "srt" | "vtt";

interface Cue { index: number; start: number; end: number; text: string }

function parseTime(t: string): number {
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
    return cues.map(c => `${c.index}\n${formatTime(c.start, ",")} --> ${formatTime(c.end, ",")}\n${c.text}`).join("\n\n") + "\n";
}
function toVtt(cues: Cue[]): string {
    return "WEBVTT\n\n" + cues.map(c => `${formatTime(c.start, ".")} --> ${formatTime(c.end, ".")}\n${c.text}`).join("\n\n") + "\n";
}

const SUBTITLE_CONVERTER_DEFAULTS: { target: Target } = {
    target: "vtt",
};

export function SubtitleConverterUI() {
    const [config, , { setField }] = useToolDefaults("subtitle-converter", SUBTITLE_CONVERTER_DEFAULTS);
    const { target } = config;
    const setTarget = useCallback((v: React.SetStateAction<typeof SUBTITLE_CONVERTER_DEFAULTS["target"]>) => setField("target", v), [setField]);
    const [file, setFile] = useState<File | null>(null);
    const [text, setText] = useState("");

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

    const loadSample = () => {
        // Synthesize a File from the sample text so the existing rendering path works.
        const f = new File([SAMPLE_SRT], "sample.srt", { type: "application/x-subrip" });
        setFile(f);
        setText(SAMPLE_SRT);
    };

    return (
        <div className="space-y-4">
            <div className="rounded-xl border border-accent/30 bg-accent/[0.05] px-4 py-3 flex items-start gap-3">
                <ShieldCheck size={16} className="text-accent shrink-0 mt-0.5" />
                <div className="flex-1 min-w-0">
                    <p className="text-[13px] text-foreground leading-snug">
                        <span className="text-[11px] text-accent font-medium mr-1.5"> 100% in-browser</span>
                        Parsing happens in JavaScript — subtitles never touch a server.
                    </p>
                </div>
                {!file && (
                    <button
                        type="button"
                        onClick={loadSample}
                        className="font-medium shrink-0 inline-flex items-center gap-1 px-2 h-7 rounded-md border border-accent/40 bg-accent/[0.08] text-[11px] text-accent hover:bg-accent/[0.12] transition-colors"
                    >
                        <Sparkles size={11} /> Try sample
                    </button>
                )}
            </div>

            {!file ? (
                <div
                    onDragOver={e => { e.preventDefault(); setDrag(true); }}
                    onDragLeave={() => setDrag(false)}
                    onDrop={e => { e.preventDefault(); setDrag(false); onPick(e.dataTransfer.files[0] || null); }}
                    onClick={() => inputRef.current?.click()}
                    onKeyDown={e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); inputRef.current?.click(); } }}
                    role="button" tabIndex={0} aria-label="Upload subtitle file"
                    className={cn(
                        "dropzone-surface relative flex flex-col items-center justify-center gap-3 rounded-2xl border-2 border-dashed cursor-pointer transition-colors py-12 px-6 text-center group",
                        drag ? "border-accent bg-accent/[0.06]" : "border-border-strong bg-paper-2/30 hover:border-accent/55 hover:bg-accent/[0.04]"
                    )}
                >
                    <CornerMarks />
                    <input ref={inputRef} type="file" accept=".srt,.vtt,.ass" className="hidden" onChange={e => { onPick(e.target.files?.[0] || null); e.target.value = ""; }} />
                    <div className={cn("h-12 w-12 rounded-xl flex items-center justify-center transition-colors", drag ? "bg-accent/20 border border-accent/45" : "bg-accent/10 border border-accent/30 group-hover:bg-accent/15")}>
                        <Upload size={20} className="text-accent" strokeWidth={1.75} />
                    </div>
                    <p className="font-display text-[18px] font-semibold text-foreground tracking-[-0.02em]">Pick a subtitle file</p>
                    <p className="font-medium text-[11.5px] text-muted-foreground">.srt · .vtt · .ass</p>
                </div>
            ) : (
                <div className="flex items-center gap-3 rounded-xl border border-accent/30 bg-accent/[0.04] px-4 py-3">
                    <div className="h-10 w-10 rounded-lg bg-accent/12 border border-accent/30 flex items-center justify-center shrink-0">
                        <FileText size={15} className="text-accent" />
                    </div>
                    <div className="flex-1 min-w-0">
                        <p className="text-[14px] font-medium text-foreground truncate">{file.name}</p>
                        <p className="font-medium text-[11.5px] text-muted-foreground mt-0.5">
                            {formatFileSize(file.size)}{result.ok && ` · ${result.count} cues`}
                        </p>
                    </div>
                    <button onClick={() => onPick(null)} aria-label="Remove" className="h-7 w-7 inline-flex items-center justify-center rounded text-muted-foreground hover:text-foreground hover:bg-secondary/60">
                        <X size={13} />
                    </button>
                </div>
            )}

            <div className="rounded-xl border border-border bg-card overflow-hidden">
                <div className="font-medium px-4 py-2 border-b border-border bg-paper-2/40 text-[11.5px] text-muted-foreground">
                    Convert to
                </div>
                <div className="p-3 grid grid-cols-2 gap-2">
                    {(["vtt", "srt"] as Target[]).map(t => {
                        const active = target === t;
                        return (
                            <button
                                key={t}
                                onClick={() => setTarget(t)}
                                className={cn(
                                    "rounded-lg border p-3 text-center transition-colors",
                                    active ? "border-accent bg-accent/[0.06]" : "border-border hover:border-border-strong hover:bg-secondary/40"
                                )}
                            >
                                <p className={cn("font-display text-[14px] font-semibold tracking-[-0.015em]", active ? "text-accent" : "text-foreground")}>
                                    {t === "vtt" ? "WebVTT" : "SubRip"}
                                </p>
                                <p className="font-medium text-[11px] text-muted-foreground/85 mt-0.5">.{t}</p>
                            </button>
                        );
                    })}
                </div>
            </div>

            {!result.ok && file && (
                <div className="flex items-center gap-2 rounded-lg border border-destructive/30 bg-destructive/[0.06] px-3 py-2.5 text-[13px] text-destructive">
                    <AlertCircle size={13} className="shrink-0" />{result.error}
                </div>
            )}

            <button onClick={handleDownload} disabled={!result.ok} className="btn-accent disabled:opacity-60 disabled:cursor-not-allowed">
                <Download size={13} /> Download .{target}
                {result.ok && <span className="font-mono text-[11px] tracking-wider text-accent/70 ml-1">({result.count} cues)</span>}
            </button>
        </div>
    );
}

function CornerMarks() {
    const cls = "corner-mark absolute h-3 w-3 pointer-events-none";
    return (
        <>
            <span className={`${cls} -top-1 -left-1`}><span className="absolute top-0 left-0 h-px w-3 bg-accent/70" /><span className="absolute top-0 left-0 w-px h-3 bg-accent/70" /></span>
            <span className={`${cls} -top-1 -right-1`}><span className="absolute top-0 right-0 h-px w-3 bg-accent/70" /><span className="absolute top-0 right-0 w-px h-3 bg-accent/70" /></span>
            <span className={`${cls} -bottom-1 -left-1`}><span className="absolute bottom-0 left-0 h-px w-3 bg-accent/70" /><span className="absolute bottom-0 left-0 w-px h-3 bg-accent/70" /></span>
            <span className={`${cls} -bottom-1 -right-1`}><span className="absolute bottom-0 right-0 h-px w-3 bg-accent/70" /><span className="absolute bottom-0 right-0 w-px h-3 bg-accent/70" /></span>
        </>
    );
}
