/**
 * SubtitleConverterUI — SRT ↔ VTT (and basic ASS → SRT/VTT) in-browser.
 * Workshop: lab-card with cue counter, format toggle, signal-green CTA.
 *
 * Multi-file: conversion runs client-side (no server), so instead of
 * useMultiFileProcessor we keep a local FileEntry-shaped queue, convert
 * sequentially, and reuse the same done-panel pattern (N=1 → direct
 * download, N>1 → zip via buildZip).
 */
import { useMemo, useRef, useState, useCallback, useEffect } from "react";
import { Upload, AlertCircle, Download, ShieldCheck, Sparkles, CheckCircle2, RotateCcw } from "lucide-react";
import { cn } from "@/lib/utils";
import { downloadBlob } from "@/lib/api";
import { buildZip } from "@/lib/zip";
import type { FileEntry } from "@/hooks/useMultiFileProcessor";
import { MultiFileQueue } from "./MultiFileQueue";
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

/** Pure conversion — same logic (and messages) the single-file UI used. */
function convertSubtitles(text: string, target: Target): { ok: boolean; output: string; count: number; error: string } {
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
}

let entryCounter = 0;
function makeEntry(file: File): FileEntry {
    return {
        id: `${Date.now().toString(36)}-${++entryCounter}`,
        file,
        name: file.name,
        size: file.size,
        status: "queued",
    };
}

const SUBTITLE_CONVERTER_DEFAULTS: { target: Target } = {
    target: "vtt",
};

export function SubtitleConverterUI() {
    const [config, , { setField }] = useToolDefaults("subtitle-converter", SUBTITLE_CONVERTER_DEFAULTS);
    const { target } = config;
    const setTarget = useCallback((v: React.SetStateAction<typeof SUBTITLE_CONVERTER_DEFAULTS["target"]>) => setField("target", v), [setField]);

    const [entries, setEntries] = useState<FileEntry[]>([]);
    // File contents, loaded eagerly on add so the live cue counter (and the
    // synchronous convert loop) can work off strings.
    const [texts, setTexts] = useState<Record<string, string>>({});
    const [phase, setPhase] = useState<"idle" | "processing" | "done">("idle");

    const [drag, setDrag] = useState(false);
    const inputRef = useRef<HTMLInputElement>(null);

    const addFiles = useCallback((list: FileList | File[]) => {
        const arr = Array.from(list);
        if (!arr.length) return;
        const fresh = arr.map(makeEntry);
        setEntries(prev => [...prev, ...fresh]);
        for (const en of fresh) {
            void en.file.text().then(t => setTexts(prev => ({ ...prev, [en.id]: t })));
        }
    }, []);

    const removeFile = useCallback((id: string) => {
        setEntries(prev => prev.filter(e => e.id !== id));
        setTexts(prev => { const next = { ...prev }; delete next[id]; return next; });
    }, []);

    const reorder = useCallback((from: number, to: number) => {
        setEntries(prev => {
            if (from === to || from < 0 || to < 0 || from >= prev.length || to >= prev.length) return prev;
            const next = [...prev];
            const [moved] = next.splice(from, 1);
            next.splice(to, 0, moved);
            return next;
        });
    }, []);

    const clearAll = useCallback(() => { setEntries([]); setTexts({}); }, []);

    // Live parse per file — powers the cue counter and the pre-flight error
    // banner exactly like the old single-file `result` memo.
    const liveResults = useMemo(() => {
        const m = new Map<string, ReturnType<typeof convertSubtitles>>();
        for (const en of entries) {
            const text = texts[en.id];
            if (text !== undefined) m.set(en.id, convertSubtitles(text, target));
        }
        return m;
    }, [entries, texts, target]);

    const totalCues = entries.reduce((s, en) => {
        const r = liveResults.get(en.id);
        return s + (r?.ok ? r.count : 0);
    }, 0);
    const invalidEntries = entries.filter(en => {
        const r = liveResults.get(en.id);
        return r !== undefined && !r.ok;
    });
    const hasConvertible = entries.some(en => liveResults.get(en.id)?.ok);

    const doneCount = entries.filter(e => e.status === "done").length;
    const failedCount = entries.filter(e => e.status === "failed").length;

    const process = useCallback(async (retryOnly = false) => {
        setPhase("processing");
        const ids = entries
            .filter(e => retryOnly ? e.status === "failed" : (e.status === "queued" || e.status === "failed"))
            .map(e => e.id);
        setEntries(prev => prev.map(e => ids.includes(e.id) ? { ...e, status: "queued", error: undefined } : e));
        for (const id of ids) {
            const en = entries.find(e => e.id === id);
            if (!en) continue;
            setEntries(prev => prev.map(e => e.id === id ? { ...e, status: "running" } : e));
            try {
                const text = texts[id] ?? await en.file.text();
                const r = convertSubtitles(text, target);
                if (!r.ok) throw new Error(r.error);
                const baseName = (en.name || "subtitles").replace(/\.[^.]+$/, "");
                const blob = new Blob([r.output], { type: target === "srt" ? "application/x-subrip" : "text/vtt" });
                setEntries(prev => prev.map(e => e.id === id
                    ? { ...e, status: "done", blob, outName: `${baseName}.${target}` }
                    : e,
                ));
            } catch (err) {
                const msg = err instanceof Error ? err.message : String(err);
                setEntries(prev => prev.map(e => e.id === id ? { ...e, status: "failed", error: msg } : e));
            }
        }
        setPhase("done");
    }, [entries, texts, target]);

    const downloadResults = useCallback(() => {
        const done = entries.filter(e => e.status === "done" && e.blob);
        if (done.length === 0) return;
        if (done.length === 1) {
            downloadBlob(done[0].blob!, done[0].outName || done[0].name);
            return;
        }
        void (async () => {
            const items = await Promise.all(done.map(async e => ({
                name: e.outName || e.name,
                data: new Uint8Array(await e.blob!.arrayBuffer()),
            })));
            downloadBlob(buildZip(items), "archive_subtitles.zip");
        })();
    }, [entries]);

    const downloadedRef = useRef(false);
    useEffect(() => {
        if (phase === "done" && !downloadedRef.current && doneCount > 0) {
            downloadedRef.current = true;
            downloadResults();
        }
    }, [phase, doneCount, downloadResults]);

    const loadSample = () => {
        // Synthesize a File from the sample text so the existing queue path works.
        const f = new File([SAMPLE_SRT], "sample.srt", { type: "application/x-subrip" });
        addFiles([f]);
    };

    if (phase === "done") {
        const isMulti = entries.length > 1;
        return (
            <div className="rounded-2xl border border-accent/30 bg-accent/[0.05] overflow-hidden animate-fade-up">
                <div className="relative p-7 sm:p-9 animate-corner-extend">
                    <CornerMarks />
                    <div className="flex items-start gap-5">
                        <div className="h-14 w-14 rounded-2xl bg-accent/15 border border-accent/35 flex items-center justify-center shrink-0 animate-success-pop">
                            <CheckCircle2 size={24} className="text-accent" strokeWidth={1.75} />
                        </div>
                        <div className="flex-1 min-w-0">
                            <p className="section-mark mb-2">Converted</p>
                            <h2 className="font-display text-[26px] font-bold text-foreground tracking-[-0.025em] leading-tight" style={{ fontVariationSettings: '"opsz" 144, "SOFT" 50' }}>
                                {isMulti
                                    ? <><span className="italic text-accent">{doneCount}</span> file{doneCount === 1 ? "" : "s"} converted to <span className="italic text-accent">.{target}</span>{failedCount > 0 ? <> · <span className="text-destructive italic">{failedCount} failed</span></> : null}</>
                                    : <>Saved as <span className="italic text-accent">.{target}</span></>}
                            </h2>
                            {isMulti && doneCount > 0 && (
                                <p className="font-mono text-[11px] tracking-[0.04em] text-muted-foreground mt-1">
                                    {doneCount > 1 ? "ZIP downloaded" : "File downloaded"}
                                </p>
                            )}
                            <div className="mt-5 flex flex-wrap gap-2">
                                {doneCount > 0 && (
                                    <button onClick={downloadResults} className="inline-flex items-center gap-1.5 h-9 px-4 rounded-md bg-foreground text-background text-[13px] font-semibold hover:opacity-90">
                                        <Download size={13} /> Download {doneCount > 1 ? "ZIP" : "again"}
                                    </button>
                                )}
                                {failedCount > 0 && (
                                    <button
                                        onClick={() => { downloadedRef.current = false; void process(true); }}
                                        className="inline-flex items-center gap-1.5 h-9 px-4 rounded-md border border-copper bg-copper-soft/40 text-[13px] font-medium text-foreground hover:bg-copper-soft/60 transition-colors"
                                    >
                                        Retry {failedCount} failed
                                    </button>
                                )}
                                <button
                                    onClick={() => { clearAll(); setPhase("idle"); downloadedRef.current = false; }}
                                    className="inline-flex items-center gap-1.5 h-9 px-4 rounded-md border border-border bg-card text-[13px] font-medium text-foreground hover:bg-secondary/60 transition-colors"
                                >
                                    <RotateCcw size={12} /> Convert more
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        );
    }

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
                {entries.length === 0 && (
                    <button
                        type="button"
                        onClick={loadSample}
                        className="font-medium shrink-0 inline-flex items-center gap-1 px-2 h-7 rounded-md border border-accent/40 bg-accent/[0.08] text-[11px] text-accent hover:bg-accent/[0.12] transition-colors"
                    >
                        <Sparkles size={11} /> Try sample
                    </button>
                )}
            </div>

            <div
                onDragOver={e => { e.preventDefault(); setDrag(true); }}
                onDragLeave={() => setDrag(false)}
                onDrop={e => { e.preventDefault(); setDrag(false); if (e.dataTransfer.files.length) addFiles(e.dataTransfer.files); }}
                onClick={() => inputRef.current?.click()}
                onKeyDown={e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); inputRef.current?.click(); } }}
                role="button" tabIndex={0} aria-label="Upload subtitle files"
                className={cn(
                    "dropzone-surface relative flex flex-col items-center justify-center gap-3 rounded-2xl border-2 border-dashed cursor-pointer transition-colors py-12 px-6 text-center group",
                    drag ? "border-accent bg-accent/[0.06]" : "border-border-strong bg-paper-2/30 hover:border-accent/55 hover:bg-accent/[0.04]"
                )}
            >
                <CornerMarks />
                <input ref={inputRef} type="file" accept=".srt,.vtt,.ass" multiple className="hidden" onChange={e => { if (e.target.files?.length) addFiles(e.target.files); e.target.value = ""; }} />
                <div className={cn("h-12 w-12 rounded-xl flex items-center justify-center transition-colors", drag ? "bg-accent/20 border border-accent/45" : "bg-accent/10 border border-accent/30 group-hover:bg-accent/15")}>
                    <Upload size={20} className="text-accent" strokeWidth={1.75} />
                </div>
                <p className="font-display text-[18px] font-semibold text-foreground tracking-[-0.02em]">
                    {entries.length ? "Add more files" : "Pick a subtitle file"}
                </p>
                <p className="font-medium text-[11.5px] text-muted-foreground">.srt · .vtt · .ass</p>
            </div>

            {entries.length > 0 && (
                <MultiFileQueue
                    entries={entries}
                    reorderable={false}
                    onRemove={removeFile}
                    onReorder={reorder}
                    onClearAll={clearAll}
                    onRetryFailed={() => { downloadedRef.current = false; void process(true); }}
                    busy={phase === "processing"}
                />
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
                                <p className="font-medium text-[11px] text-muted-foreground mt-0.5">.{t}</p>
                            </button>
                        );
                    })}
                </div>
            </div>

            {invalidEntries.length > 0 && (
                <div className="rounded-lg border border-destructive/30 bg-destructive/[0.06] px-3 py-2.5 text-[13px] text-destructive space-y-1">
                    {invalidEntries.map(en => (
                        <p key={en.id} className="flex items-center gap-2">
                            <AlertCircle size={13} className="shrink-0" />
                            {entries.length > 1 ? `${en.name}: ` : ""}{liveResults.get(en.id)!.error}
                        </p>
                    ))}
                </div>
            )}

            <button
                onClick={() => void process(false)}
                disabled={!hasConvertible || phase === "processing"}
                className="btn-accent disabled:opacity-60 disabled:cursor-not-allowed"
            >
                <Download size={13} /> Download .{target}{entries.length > 1 ? ` — ${entries.length} files` : ""}
                {totalCues > 0 && <span className="font-mono text-[11px] tracking-wider text-accent ml-1">({totalCues} cues)</span>}
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
