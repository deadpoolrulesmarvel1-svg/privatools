import { type Target, convertSubtitles } from "./subtitle-conversion";
/**
 * SubtitleConverterUI — SRT ↔ VTT (and basic ASS → SRT/VTT) in-browser.
 *
 * Multi-file: conversion runs client-side (no server), so instead of
 * useMultiFileProcessor we keep a local FileEntry-shaped queue, convert
 * sequentially, and end on the shared result (N=1 → direct download,
 * N>1 → zip via buildZip). A file that doesn't parse would fail the same way
 * again, so no failure here is offered a retry.
 */
import { useMemo, useState, useCallback } from "react";
import { Download, Sparkles } from "lucide-react";
import { downloadBlob, withErrorKind } from "@/lib/api";
import { buildZip } from "@/lib/zip";
import { emitToolRun, isTransientFailure, runOutcome, toolErrorKind } from "@/lib/toolRun";
import type { FileEntry } from "@/hooks/useMultiFileProcessor";
import { useToolDefaults } from "@/hooks/useToolDefaults";
import { FileIntake, StudioActionBar, StudioLayout, StudioProgress } from "@/skins/experience/ToolStudio";
import { ProcessorFiles, ProcessorResult } from "@/skins/experience/ProcessorStudio";
import { useDownloadOnce } from "@/skins/experience/useDownloadOnce";
import { downloadStarted } from "@/skins/experience/studio-outcome";
import { fileCount } from "@/skins/experience/file-format-label";

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

const ACCEPTS = ".srt,.vtt,.ass";
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
    // Back from a result, focus returns to the intake rather than the page top.
    const [returning, setReturning] = useState(false);

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

    const clearAll = useCallback(() => { setEntries([]); setTexts({}); }, []);

    // Live parse per file — powers the cue counter and the pre-flight error
    // list exactly like the old single-file `result` memo.
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
    const retryableCount = entries.filter(e => e.status === "failed" && e.retryable).length;

    const process = useCallback(async (retry: boolean | "transient" = false) => {
        setPhase("processing");
        const ids = entries
            .filter(e => retry === "transient" ? e.status === "failed" && e.retryable : retry ? e.status === "failed" : (e.status === "queued" || e.status === "failed"))
            .map(e => e.id);
        setEntries(prev => prev.map(e => ids.includes(e.id) ? { ...e, status: "queued", error: undefined, errorKind: undefined, retryable: undefined } : e));
        let done = 0, failed = 0;
        let firstFailure: unknown = null;
        for (const id of ids) {
            const en = entries.find(e => e.id === id);
            if (!en) continue;
            setEntries(prev => prev.map(e => e.id === id ? { ...e, status: "running" } : e));
            try {
                const text = texts[id] ?? await en.file.text();
                const r = convertSubtitles(text, target);
                if (!r.ok) throw withErrorKind(new Error(r.error), "bad_input");
                const baseName = (en.name || "subtitles").replace(/\.[^.]+$/, "");
                const blob = new Blob([r.output], { type: target === "srt" ? "application/x-subrip" : "text/vtt" });
                setEntries(prev => prev.map(e => e.id === id
                    ? { ...e, status: "done", blob, outName: `${baseName}.${target}` }
                    : e,
                ));
                done++;
            } catch (err) {
                const msg = err instanceof Error ? err.message : String(err);
                const kind = toolErrorKind(err);
                setEntries(prev => prev.map(e => e.id === id ? { ...e, status: "failed", error: msg, errorKind: kind === "cancelled" ? undefined : kind, retryable: isTransientFailure(err) } : e));
                failed++;
                firstFailure ??= err;
            }
        }
        const outcome = runOutcome(done, failed);
        if (outcome) emitToolRun({ outcome, files: done + failed }, firstFailure);
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

    useDownloadOnce(phase === "done", doneCount, downloadResults);

    const loadSample = () => {
        // Synthesize a File from the sample text so the existing queue path works.
        const f = new File([SAMPLE_SRT], "sample.srt", { type: "application/x-subrip" });
        addFiles([f]);
    };

    if (phase === "done") {
        const startOver = (files?: File[]) => {
            clearAll();
            if (files) addFiles(files);
            setReturning(true); setPhase("idle");
        };
        return <ProcessorResult proc={{ entries, doneCount, failedCount, retryableCount }} noun="file" verb="converted" accepts={ACCEPTS}
            title={doneCount > 1 ? `${doneCount} files converted to .${target}.` : `Saved as .${target}.`}
            detail={downloadStarted(doneCount)}
            onDownload={downloadResults} onRetry={() => void process("transient")}
            onStartOver={startOver} more="Convert more" />;
    }

    const busy = phase === "processing";
    return <StudioLayout options={<div>
        <h2>Convert to</h2>
        <div className="ts-choices">{(["vtt", "srt"] as Target[]).map(t => <button type="button" className="ts-choice" key={t} aria-pressed={target === t} disabled={busy} onClick={() => setTarget(t)}>
            <strong>{t === "vtt" ? "WebVTT" : "SubRip"}</strong><span>.{t}</span>
        </button>)}</div>
    </div>} action={<StudioActionBar ready={entries.length > 0} count={entries.length ? fileCount(entries.length) : undefined}>
        <button type="button" className="ts-primary-button" onClick={() => void process(false)} disabled={!hasConvertible || busy}>
            <Download size={16} aria-hidden="true" /> Download .{target}{entries.length > 1 ? ` — ${entries.length} files` : ""}{totalCues > 0 && ` (${totalCues} cues)`}
        </button>
    </StudioActionBar>}>
        <FileIntake accepts={ACCEPTS} multiple title="Pick a subtitle file" detail=".srt · .vtt · .ass"
            compact={entries.length > 0} disabled={busy} autoFocus={returning} onFiles={addFiles} />
        {entries.length === 0 && <button type="button" className="ts-text-button" onClick={loadSample}><Sparkles size={15} aria-hidden="true" /> Try sample</button>}
        <ProcessorFiles proc={{ entries, removeFile, clearAll }} busy={busy} label="Selected subtitle files" />
        {invalidEntries.length > 0 && <div className="ts-error" role="alert">
            {invalidEntries.map(en => <p key={en.id}>{entries.length > 1 ? `${en.name}: ` : ""}{liveResults.get(en.id)!.error}</p>)}
        </div>}
        {busy && <StudioProgress label="Converting your subtitles" detail={`${doneCount} of ${entries.length} files completed`} />}
    </StudioLayout>;
}
