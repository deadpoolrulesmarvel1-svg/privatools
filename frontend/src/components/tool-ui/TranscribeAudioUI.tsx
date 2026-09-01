/**
 * TranscribeAudioUI — speech to text, two ways:
 *
 *   · On this device: OpenAI Whisper (tiny/base) through transformers.js.
 *     The model downloads once (~41/74 MB), caches in the browser, and the
 *     recording never leaves the tab.
 *   · Your own key: the provider's transcription API (OpenAI, Groq, or a
 *     self-hosted OpenAI-compatible server) — much better accuracy, the
 *     audio goes browser → provider directly, never through PrivaTools.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { AlertCircle, Ban, CheckCircle2, Copy, Download, FileAudio, Loader2, Mic, RotateCcw, Check } from "lucide-react";
import { cn, friendlyError } from "@/lib/utils";
import { downloadBlob, formatFileSize, MAX_FILE_SIZE, MAX_FILE_SIZE_LABEL } from "@/lib/api";
import { FileUploadZone } from "./FileUploadZone";
import { consumeFileHandoff } from "@/lib/file-handoff";
import { useByok } from "@/hooks/useByok";
import { ByokPanel } from "@/components/byok/ByokPanel";
import { getBaseUrl, getKey } from "@/lib/byok/keyStore";
import { transcribe } from "@/lib/byok/client";
import { providerById, supportsTranscription, TRANSCRIBE_MODELS } from "@/lib/byok/providers";
import { ByokError } from "@/lib/byok/errors";

type WhisperSize = "tiny" | "base";
const WHISPER: Record<WhisperSize, { hfId: string; label: string; size: string }> = {
    tiny: { hfId: "Xenova/whisper-tiny", label: "Tiny", size: "~41 MB" },
    base: { hfId: "Xenova/whisper-base", label: "Base", size: "~74 MB" },
};

interface Segment { start: number; end: number; text: string; }

// One pipeline per model size, kept across runs.
const asrCache = new Map<string, Promise<unknown>>();
async function getAsr(hfId: string, onProgress: (pct: number) => void) {
    const cached = asrCache.get(hfId);
    if (cached) { onProgress(100); return cached; }
    const promise = (async () => {
        const { pipeline, env } = await import("@huggingface/transformers");
        env.allowLocalModels = false;
        env.allowRemoteModels = true;
        return pipeline("automatic-speech-recognition", hfId, {
            progress_callback: (info: { status: string; progress?: number }) => {
                if (info.status === "progress" && typeof info.progress === "number") {
                    onProgress(Math.min(100, Math.max(0, Math.round(info.progress))));
                } else if (info.status === "ready") onProgress(100);
            },
        } as never);
    })();
    asrCache.set(hfId, promise);
    try { return await promise; } catch (e) { asrCache.delete(hfId); throw e; }
}

/** Decode any browser-supported audio file to mono 16 kHz Float32. */
async function decodeTo16kMono(file: File): Promise<Float32Array> {
    const ctx = new AudioContext({ sampleRate: 16000 });
    try {
        const buf = await ctx.decodeAudioData(await file.arrayBuffer());
        if (buf.numberOfChannels === 1) return buf.getChannelData(0);
        const a = buf.getChannelData(0), b = buf.getChannelData(1);
        const mono = new Float32Array(buf.length);
        for (let i = 0; i < buf.length; i++) mono[i] = (a[i] + b[i]) / 2;
        return mono;
    } finally {
        void ctx.close();
    }
}

function fmtTime(s: number): string {
    const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
    const ms = Math.round((sec % 1) * 1000);
    const pad = (n: number, w = 2) => String(Math.floor(n)).padStart(w, "0");
    return `${pad(h)}:${pad(m)}:${pad(sec)},${String(ms).padStart(3, "0")}`;
}

function toSrt(segs: Segment[]): string {
    return segs.map((s, i) => `${i + 1}\n${fmtTime(s.start)} --> ${fmtTime(s.end)}\n${s.text.trim()}\n`).join("\n");
}

export function TranscribeAudioUI() {
    const byok = useByok();
    const [file, setFile] = useState<File | null>(null);
    const [engine, setEngine] = useState<"local" | "byok">("local");
    const [whisper, setWhisper] = useState<WhisperSize>("tiny");
    const [byokModel, setByokModel] = useState("");
    const [phase, setPhase] = useState<"idle" | "loading-model" | "transcribing" | "done">("idle");
    const [modelPct, setModelPct] = useState(0);
    const [text, setText] = useState("");
    const [segments, setSegments] = useState<Segment[]>([]);
    const [error, setError] = useState<string | null>(null);
    const [copied, setCopied] = useState(false);
    const cancelRef = useRef(false);
    const abortRef = useRef<AbortController | null>(null);

    useEffect(() => {
        let cancelled = false;
        consumeFileHandoff("transcribe-audio").then(f => { if (!cancelled && f) setFile(f); });
        return () => { cancelled = true; };
    }, []);
    useEffect(() => () => abortRef.current?.abort(), []);

    const byokProviderOk = byok.ready && supportsTranscription(providerById(byok.provider) ?? { shape: "anthropic" } as never);

    const run = useCallback(async () => {
        if (!file) return;
        if (file.size > MAX_FILE_SIZE) { setError(`That file is ${formatFileSize(file.size)}. The maximum is ${MAX_FILE_SIZE_LABEL}.`); return; }
        cancelRef.current = false;
        setError(null); setText(""); setSegments([]); setCopied(false);
        try {
            if (engine === "byok") {
                if (!byokProviderOk) throw new Error("Pick a provider with a transcription API (OpenAI, Groq, or self-hosted) and save a key first.");
                const apiKey = await getKey(byok.provider);
                if (!apiKey) throw new Error("That saved key could not be read. Enter it again.");
                const controller = new AbortController();
                abortRef.current = controller;
                setPhase("transcribing");
                const out = await transcribe({
                    providerId: byok.provider,
                    apiKey,
                    model: byokModel,
                    file,
                    baseUrl: getBaseUrl(byok.provider),
                    signal: controller.signal,
                });
                if (cancelRef.current) return;
                setText(out);
                setPhase("done");
                return;
            }
            // Local Whisper
            setPhase("loading-model");
            setModelPct(0);
            const asr = await getAsr(WHISPER[whisper].hfId, setModelPct) as (
                audio: Float32Array,
                opts: Record<string, unknown>,
            ) => Promise<{ text?: string; chunks?: Array<{ timestamp: [number, number | null]; text: string }> }>;
            if (cancelRef.current) return;
            setPhase("transcribing");
            const audio = await decodeTo16kMono(file);
            if (cancelRef.current) return;
            const result = await asr(audio, {
                chunk_length_s: 30,
                stride_length_s: 5,
                return_timestamps: true,
            });
            if (cancelRef.current) return;
            const segs: Segment[] = (result.chunks ?? [])
                .filter(c => c.text.trim())
                .map(c => ({ start: c.timestamp[0] ?? 0, end: c.timestamp[1] ?? (c.timestamp[0] ?? 0) + 5, text: c.text }));
            setSegments(segs);
            setText((result.text ?? segs.map(s => s.text).join(" ")).trim());
            setPhase("done");
        } catch (e: unknown) {
            if (cancelRef.current) return;
            const msg = e instanceof ByokError ? e.userMessage
                : e instanceof Error && /decodeAudioData|decoding/i.test(e.message) ? "Couldn't decode that file — convert it to MP3 or WAV first (the Audio Converter tool does this)."
                : e instanceof Error ? e.message : "Transcription failed";
            setError(friendlyError(msg, "Couldn't transcribe that recording."));
            setPhase("idle");
        }
    }, [file, engine, whisper, byokModel, byok.provider, byokProviderOk]);

    const stem = (file?.name ?? "recording").replace(/\.[^.]+$/, "");
    const busy = phase === "loading-model" || phase === "transcribing";

    if (phase === "done") {
        const words = text.split(/\s+/).filter(Boolean).length;
        return (
            <div className="space-y-3 animate-fade-up">
                <div className="rounded-2xl border border-accent/30 bg-accent/[0.05] p-6">
                    <div className="flex items-start gap-4">
                        <div className="h-12 w-12 rounded-2xl bg-accent/15 border border-accent/35 flex items-center justify-center shrink-0 animate-success-pop">
                            <CheckCircle2 size={22} className="text-accent" strokeWidth={1.75} />
                        </div>
                        <div className="flex-1 min-w-0">
                            <p className="section-mark mb-1.5">Transcribed</p>
                            <h2 className="font-display text-[24px] font-bold text-foreground tracking-[-0.025em] leading-tight">
                                <span className="italic text-accent">{words.toLocaleString()}</span> words
                            </h2>
                            <p className="font-mono text-[11px] tracking-[0.04em] text-muted-foreground mt-1">
                                {engine === "byok"
                                    ? `via your ${providerById(byok.provider)?.label ?? "provider"} key — audio went straight to them`
                                    : `Whisper ${WHISPER[whisper].label} on your device — nothing uploaded`}
                            </p>
                            <div className="mt-4 flex flex-wrap gap-2">
                                <button onClick={() => downloadBlob(new Blob([text], { type: "text/plain;charset=utf-8" }), `${stem}_transcript.txt`)}
                                    className="inline-flex items-center gap-1.5 h-9 px-4 rounded-md bg-foreground text-background text-[13px] font-semibold hover:opacity-90">
                                    <Download size={13} /> Download .txt
                                </button>
                                {segments.length > 0 && (
                                    <button onClick={() => downloadBlob(new Blob([toSrt(segments)], { type: "text/plain;charset=utf-8" }), `${stem}.srt`)}
                                        className="inline-flex items-center gap-1.5 h-9 px-4 rounded-md border border-border bg-card text-[13px] font-medium text-foreground hover:bg-secondary/60 transition-colors">
                                        <Download size={13} /> Subtitles (.srt)
                                    </button>
                                )}
                                <button onClick={() => { void navigator.clipboard.writeText(text).then(() => { setCopied(true); setTimeout(() => setCopied(false), 2000); }).catch(() => {}); }}
                                    className="inline-flex items-center gap-1.5 h-9 px-4 rounded-md border border-border bg-card text-[13px] font-medium text-foreground hover:bg-secondary/60 transition-colors">
                                    {copied ? <><Check size={13} className="text-accent" /> Copied</> : <><Copy size={13} /> Copy</>}
                                </button>
                                <button onClick={() => { setPhase("idle"); setFile(null); setText(""); setSegments([]); }}
                                    className="inline-flex items-center gap-1.5 h-9 px-4 rounded-md border border-border bg-card text-[13px] font-medium text-foreground hover:bg-secondary/60 transition-colors">
                                    <RotateCcw size={12} /> Transcribe another
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
                <div className="rounded-xl border border-border bg-card overflow-hidden">
                    <div className="font-medium px-4 py-2 border-b border-border bg-paper-2/40 text-[11.5px] text-muted-foreground">Transcript</div>
                    <div className="max-h-96 overflow-y-auto p-4">
                        {segments.length > 0 ? (
                            <div className="space-y-2">
                                {segments.map((s, i) => (
                                    <p key={i} className="text-[13.5px] leading-relaxed text-foreground">
                                        <span className="font-mono text-[10.5px] text-muted-foreground mr-2">{fmtTime(s.start).slice(0, 8)}</span>
                                        {s.text.trim()}
                                    </p>
                                ))}
                            </div>
                        ) : (
                            <p className="text-[13.5px] leading-relaxed text-foreground whitespace-pre-wrap">{text}</p>
                        )}
                    </div>
                </div>
            </div>
        );
    }

    return (
        <div className="space-y-4">
            <FileUploadZone
                file={file}
                onFileSelect={setFile}
                onClear={() => setFile(null)}
                accept=".mp3,.wav,.m4a,.ogg,.opus,.webm,.flac,.aac"
                label="Drop a recording to transcribe"
                hint="Meetings, voice notes, interviews · MP3, WAV, M4A, OGG, FLAC"
            />

            {/* Engine */}
            <div className="rounded-xl border border-border bg-card overflow-hidden">
                <div className="font-medium px-4 py-2 border-b border-border bg-paper-2/40 text-[11.5px] text-muted-foreground">
                    Where the AI runs
                </div>
                <div className="p-3 space-y-3">
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                        <button type="button" onClick={() => setEngine("local")} aria-pressed={engine === "local"} disabled={busy}
                            className={cn("rounded-lg border p-3 text-left transition-colors",
                                engine === "local" ? "border-accent bg-accent/[0.07]" : "border-border hover:border-accent/40")}>
                            <span className="block text-[13.5px] font-medium text-foreground">On this device</span>
                            <span className="block text-[11.5px] text-muted-foreground mt-0.5 leading-snug">
                                Free, no key. Whisper downloads once ({WHISPER[whisper].size}), then works offline.
                                The recording never leaves your browser.
                            </span>
                        </button>
                        <button type="button" onClick={() => setEngine("byok")} aria-pressed={engine === "byok"} disabled={busy}
                            className={cn("rounded-lg border p-3 text-left transition-colors",
                                engine === "byok" ? "border-accent bg-accent/[0.07]" : "border-border hover:border-accent/40")}>
                            <span className="block text-[13.5px] font-medium text-foreground">My own API key</span>
                            <span className="block text-[11.5px] text-muted-foreground mt-0.5 leading-snug">
                                Much better accuracy. OpenAI, Groq, or self-hosted — the audio goes to them, not to us.
                            </span>
                        </button>
                    </div>

                    {engine === "local" && (
                        <div className="flex items-center gap-2">
                            <span className="font-medium text-[11px] text-muted-foreground">Model</span>
                            {(Object.keys(WHISPER) as WhisperSize[]).map(k => (
                                <button key={k} type="button" onClick={() => setWhisper(k)} aria-pressed={whisper === k} disabled={busy}
                                    className={cn("rounded-md border px-2.5 py-1 text-[12px] transition-colors",
                                        whisper === k ? "border-accent bg-accent/10 text-foreground" : "border-border text-muted-foreground hover:border-accent/40")}>
                                    {WHISPER[k].label} · {WHISPER[k].size}
                                </button>
                            ))}
                        </div>
                    )}

                    {engine === "byok" && (
                        <>
                            <ByokPanel byok={byok} purpose="This recording is sent to the provider you choose, using your key." />
                            {byok.ready && !byokProviderOk && (
                                <p className="text-[12px] text-copper flex items-center gap-1.5">
                                    <AlertCircle size={12} /> {providerById(byok.provider)?.label} has no transcription API — pick OpenAI, Groq, or a self-hosted endpoint.
                                </p>
                            )}
                            {byokProviderOk && (
                                <label className="block">
                                    <span className="font-medium text-[11px] text-muted-foreground">Model (optional)</span>
                                    <input type="text" value={byokModel} onChange={e => setByokModel(e.target.value)}
                                        placeholder={TRANSCRIBE_MODELS[byok.provider] ?? "whisper-1"}
                                        className="mt-1 w-full rounded-md border border-border bg-background px-2.5 py-1.5 text-[13px] font-mono" />
                                </label>
                            )}
                        </>
                    )}
                </div>
            </div>

            {error && (
                <div className="flex items-center gap-2 rounded-lg border border-destructive/30 bg-destructive/[0.06] px-3 py-2.5 text-[13px] text-destructive" role="alert">
                    <AlertCircle size={13} className="shrink-0" />{error}
                </div>
            )}

            {busy && (
                <div className="rounded-xl border border-accent/30 bg-accent/[0.05] p-4 space-y-2 animate-fade-in">
                    <p className="font-medium text-[12px] text-accent">
                        {phase === "loading-model" && `Downloading Whisper ${WHISPER[whisper].label} — ${modelPct}%`}
                        {phase === "transcribing" && (engine === "byok" ? "Transcribing with your key…" : "Listening — this runs entirely in your browser…")}
                    </p>
                    {phase === "loading-model" && (
                        <div className="h-1.5 rounded-full bg-border/60 overflow-hidden">
                            <div className="h-full rounded-full bg-accent transition-[width] duration-300" style={{ width: `${modelPct}%` }} />
                        </div>
                    )}
                    <button onClick={() => { cancelRef.current = true; abortRef.current?.abort(); setPhase("idle"); }}
                        className="inline-flex items-center gap-1.5 text-[12px] text-muted-foreground hover:text-foreground transition-colors">
                        <Ban size={11} /> Cancel
                    </button>
                </div>
            )}

            {!busy && (
                <button onClick={() => void run()} disabled={!file || (engine === "byok" && !byokProviderOk)}
                    className="btn-accent disabled:opacity-60 disabled:cursor-not-allowed">
                    <Mic size={13} /> Transcribe
                </button>
            )}

            {file && file.size > 25 * 1024 * 1024 && engine === "byok" && (
                <p className="flex items-center gap-2 text-[12px] text-muted-foreground">
                    <FileAudio size={12} /> Provider APIs usually cap uploads around 25 MB — trim or convert long recordings first.
                </p>
            )}
        </div>
    );
}
