/**
 * NoiseRemoverUI — Voice Noise Remover: steady background noise out of a
 * speech recording, in this browser.
 *
 * The sound is read and decoded a piece at a time on the page
 * (lib/noise/source.ts) and cleaned in a worker by RNNoise, Xiph's speech
 * noise suppressor, as WebAssembly served from this site (lib/noise). The
 * visitor listens to the original and the cleaned sound, then downloads a
 * WAV. Nothing is uploaded, and nothing downloads but the page's own code.
 */
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { AudioLines, Download } from "lucide-react";
import { downloadBlob, formatFileSize, MAX_FILE_SIZE, MAX_FILE_SIZE_LABEL } from "@/lib/api";
import { nonPdfTools } from "@/data/non-pdf-tools";
import { emitToolRun, isTransientFailure, toolErrorKind, type ToolErrorKind } from "@/lib/toolRun";
import { useToolDefaults } from "@/hooks/useToolDefaults";
import type { NoiseResult, NoiseStage } from "@/lib/noise/engine";
import { NoiseEngineError, outOfMemory } from "@/lib/noise/errors";
import { lengthWords, MAX_SECONDS, MAX_STEREO_SECONDS, NoiseInputError, WHOLE_FILE_SECONDS } from "@/lib/noise/source";
import { focusIfIdle } from "@/skins/experience/focus-result";
import { FileIntake, LocalFilePreview, StudioActionBar, StudioActions, StudioFile, StudioLayout, StudioProgress, StudioResult } from "@/skins/experience/ToolStudio";
import { retryLine } from "@/skins/experience/studio-outcome";
import "./noise-remover.css";

const SLUG = "remove-background-noise";
/** The lengths this page cleans, in words. */
const LIMITS = `up to ${MAX_SECONDS / 60} minutes of mono or ${MAX_STEREO_SECONDS / 60} of stereo`;
/**
 * What the PrivaTools server takes from Audio Converter, Extract Audio and
 * Cut / Trim Video & Audio: 200 MB (max_bytes in phase6_tools.py's
 * audio_converter, MAX_VIDEO_SIZE in non_pdf_tools.py), less than the 500 MB
 * a page takes. Transcribe Audio works in the browser, up to MAX_FILE_SIZE.
 */
const SERVER_MEDIA_MAX = 200 * 1024 * 1024;
const SERVER_MEDIA_MAX_LABEL = "200 MB";
/** What the readers take: MP4, MOV, M4A, WebM, MKV, MP3 and WAV in pieces; Ogg, Opus, FLAC and AAC whole. */
const ACCEPTS = ".mp3,.wav,.m4a,.aac,.ogg,.oga,.opus,.flac,.webm,.mp4,.m4v,.mov,.mkv";
/** Containers that hold video, and so go to Extract Audio rather than Audio Converter. */
const VIDEO = /\.(mp4|m4v|mov|webm|mkv)$/i;
/** A WebM can be a video or a recording, so it gets words that are true either way. */
function fileKind(name: string): "video" | "webm" | "recording" {
    return /\.webm$/i.test(name) ? "webm" : VIDEO.test(name) ? "video" : "recording";
}
/** Below this, about −80 dBFS, the recording holds no sound to clean. */
const SILENT_PEAK = 1e-4;
/** RNNoise rated less than this share of the recording as speech. */
const LITTLE_SPEECH = 0.05;

type Settings = { strength: number };
const DEFAULTS: Settings = { strength: 100 };

/** "4:05" or "1:02:03", in whole seconds as players count them. */
function clock(seconds: number): string {
    const whole = Math.max(0, Math.floor(seconds + 1e-6));
    const h = Math.floor(whole / 3600);
    const m = Math.floor(whole / 60) % 60;
    const s = String(whole % 60).padStart(2, "0");
    return h ? `${h}:${String(m).padStart(2, "0")}:${s}` : `${m}:${s}`;
}

/** A length for the result: its clock, or "under a second" where the clock would read 0:00. */
function length(seconds: number): string {
    return seconds < 1 ? "under a second" : clock(seconds);
}

function minutesLeft(seconds: number): string {
    if (seconds < 60) return "less than a minute left";
    if (seconds < 90) return "about a minute left";
    return `about ${Math.round(seconds / 60)} minutes left`;
}

/** What a strength keeps, in words. */
function strengthWords(strength: number): string {
    return strength >= 100 ? "only the cleaned sound" : `${strength}% cleaned sound, ${100 - strength}% original`;
}

interface Failure {
    title: string;
    detail: string;
    /** A reason shown on the file's row. */
    reason: string;
    /** Another attempt could work: the download of the noise remover dropped. */
    retryable: boolean;
    kind?: ToolErrorKind;
    /** Another tool that can help, with what it does with the file. */
    help?: ReactNode;
}

/** Whether a server-backed PrivaTools tool takes this file: its type, by the tool's own list, and its size. */
function takes(slug: string, file: File): boolean {
    const extension = /\.[^.]+$/.exec(file.name)?.[0].toLowerCase();
    const tool = nonPdfTools.find(entry => entry.slug === slug);
    return Boolean(extension && tool?.accepts.split(",").includes(extension)) && file.size <= SERVER_MEDIA_MAX;
}

/** A tool that can save the sound as an MP3, which this page reads a minute at a time, and what using it means. */
function mp3Maker(file: File): ReactNode {
    const video = VIDEO.test(file.name);
    if (video && takes("extract-audio", file)) {
        return <><a href="/tools/extract-audio">Extract Audio</a> can save its sound as an MP3 on the PrivaTools server, which means uploading the video for temporary processing; the MP3 then works here, {LIMITS}.</>;
    }
    if (!video && takes("audio-converter", file)) {
        return <><a href="/tools/audio-converter">Audio Converter</a> can turn it into an MP3 on the PrivaTools server, which means uploading the recording for temporary processing; the MP3 then works here, {LIMITS}.</>;
    }
    if (file.size > SERVER_MEDIA_MAX) {
        return <>It is larger than the {SERVER_MEDIA_MAX_LABEL} that {video ? "Extract Audio" : "Audio Converter"} takes, so save it as MP3 or MP4 with an audio or video app on your device; those work here {LIMITS}.</>;
    }
    return <>An audio or video app on your device can save it as MP3 or MP4, which work here {LIMITS}.</>;
}

function failureFor(error: unknown, file: File): Failure {
    if (error instanceof NoiseInputError) {
        if (error.problem === "empty") return { title: "This file is empty.", detail: "It holds no data, so there is no sound to clean. Choose the file again, or a copy that plays.", reason: "Empty file", retryable: false, kind: "bad_input" };
        if (error.problem === "no-sound") return { title: "This file has no sound.", detail: `${error.message} Nothing was sent anywhere.`, reason: "No sound track", retryable: false, kind: "bad_input" };
        if (error.problem === "too-long") return {
            title: "This recording is too long to clean here.", detail: error.message, reason: `Longer than ${MAX_SECONDS / 60} minutes of sound`, retryable: false, kind: "too_large",
            help: takes("trim-media", file)
                ? <>To clean it in parts of up to {MAX_SECONDS / 60} minutes of mono or {MAX_STEREO_SECONDS / 60} of stereo, cut it with <a href="/tools/trim-media">Cut / Trim Video &amp; Audio</a>, which uploads the file to PrivaTools for temporary processing, or with an audio app on your device.</>
                : <>To clean it, cut it into parts of up to {MAX_SECONDS / 60} minutes of mono or {MAX_STEREO_SECONDS / 60} of stereo with an audio or video app on your device{file.size > SERVER_MEDIA_MAX ? `: it is larger than the ${SERVER_MEDIA_MAX_LABEL} Cut / Trim Video & Audio takes` : ""}.</>,
        };
        if (error.problem === "too-long-stereo") return {
            title: "This stereo recording is too long to clean here.",
            detail: `${error.message} The cleaned sound is kept in this browser’s memory, and stereo needs twice as much as mono.`,
            reason: `Stereo longer than ${MAX_STEREO_SECONDS / 60} minutes`, retryable: false, kind: "too_large",
            help: takes("trim-media", file)
                ? <>To clean it in parts of up to {MAX_STEREO_SECONDS / 60} minutes, cut it with <a href="/tools/trim-media">Cut / Trim Video &amp; Audio</a>, which uploads the file to PrivaTools for temporary processing, or with an audio app on your device. An audio app can also save it as mono, which works here up to {MAX_SECONDS / 60} minutes.</>
                : <>To clean it, cut it into parts of up to {MAX_STEREO_SECONDS / 60} minutes, or save it as mono, which works here up to {MAX_SECONDS / 60} minutes, with an audio or video app on your device{file.size > SERVER_MEDIA_MAX ? `: it is larger than the ${SERVER_MEDIA_MAX_LABEL} Cut / Trim Video & Audio takes` : ""}.</>,
        };
        if (error.problem === "too-long-whole") return { title: "This file is too long to read whole.", detail: error.message, reason: `Longer than ${WHOLE_FILE_SECONDS / 60} minutes in this format`, retryable: false, kind: "too_large", help: mp3Maker(file) };
        return {
            title: "This browser can’t read the sound in this file.", detail: "Nothing was sent anywhere.", reason: error.message, retryable: false, kind: "bad_input",
            help: <>{mp3Maker(file)} A different browser may also be able to read it.</>,
        };
    }
    const kind = toolErrorKind(error);
    if (kind === "network" || kind === "server" || kind === "timeout") {
        return { title: "The noise remover couldn’t be downloaded.", detail: `It comes from this site, about 3 MB, the first time you clean a recording. ${retryLine([kind])}`, reason: "The download didn’t finish", retryable: isTransientFailure(error), kind };
    }
    if (error instanceof NoiseEngineError && (error.reason === "wasm" || error.reason === "worker")) {
        const { reason } = error;
        return {
            title: "The noise remover couldn’t start.",
            detail: reason === "wasm"
                ? "This browser didn’t let it run WebAssembly, the code it is built on, so nothing was cleaned. A browser setting or an extension that blocks WebAssembly can cause this."
                : "This browser couldn’t start it in the background, where it runs so the page stays responsive. A current version of Chrome, Edge, Firefox or Safari can.",
            reason: error.message || "It couldn’t start", retryable: false, kind: "browser",
        };
    }
    if (outOfMemory(error as Error)) {
        return { title: "This browser ran out of memory.", detail: "Nothing was cleaned. Closing other tabs frees memory, and a shorter recording needs less.", reason: "Out of memory", retryable: false, kind: "browser" };
    }
    return { title: "The noise couldn’t be removed.", detail: "Something failed in this browser while the sound was being cleaned. Nothing was sent anywhere.", reason: error instanceof Error && error.message ? error.message : "The noise remover stopped with an error", retryable: false, kind: "browser" };
}

type Phase = "idle" | NoiseStage | "done" | "failed";

/** What the progress box says at each stage of a run. */
const STAGES: Record<NoiseStage, { label: string; detail: string }> = {
    reading: { label: "Reading the sound", detail: "Finding the sound in this browser and checking it can be decoded." },
    starting: { label: "Starting the noise remover", detail: "RNNoise, about 3 MB, comes from this site the first time. Your file stays here." },
    cleaning: { label: "Removing background noise", detail: "RNNoise on this device. Keep this tab open." },
};
/** How often the progress moves, in milliseconds: a screen reader hears the box's changes, so not at every step. */
const PROGRESS_EVERY = 1000;
/** The strength's steps, in percent: 95% still keeps some of the original, about 26 dB under it. */
const STRENGTH_STEP = 5;

export function NoiseRemoverUI() {
    const [stored, , { setField }] = useToolDefaults(SLUG, DEFAULTS);
    // A remembered value from an older version is checked before it is used.
    const strength = useMemo(() => {
        const value = Number(stored.strength);
        return Number.isFinite(value) ? Math.min(100, Math.max(10, Math.round(value / STRENGTH_STEP) * STRENGTH_STEP)) : DEFAULTS.strength;
    }, [stored.strength]);
    const [file, setFile] = useState<File | null>(null);
    const [phase, setPhase] = useState<Phase>("idle");
    const [readPercent, setReadPercent] = useState<number | undefined>();
    const [progress, setProgress] = useState({ done: 0, total: 0, started: 0 });
    const [result, setResult] = useState<(NoiseResult & { strength: number; took: number }) | null>(null);
    const [failure, setFailure] = useState<Failure | null>(null);
    // Back from a result, focus waits on the intake.
    const [returning, setReturning] = useState(false);
    const run = useRef(0);
    const stop = useRef<AbortController | null>(null);
    const shown = useRef(0);
    const stage = phase === "reading" || phase === "starting" || phase === "cleaning" ? phase : null;
    const busy = stage !== null;
    const removeButton = useRef<HTMLButtonElement>(null);
    const strengthInput = useRef<HTMLInputElement>(null);
    const progressBox = useRef<HTMLDivElement>(null);
    // Where focus goes when the control that held it goes away or is disabled: set by the handler that does it.
    const focusNext = useRef<"cancel" | "remove" | "strength" | null>(null);

    // Leaving the page ends a run, and its worker with it.
    useEffect(() => () => { run.current++; stop.current?.abort(); }, []);

    useEffect(() => {
        const next = focusNext.current;
        if (!next) return;
        const target = next === "cancel" ? progressBox.current?.querySelector<HTMLButtonElement>(".ts-progress button")
            : next === "remove" ? removeButton.current : strengthInput.current;
        if (!target) return;
        focusNext.current = null;
        // A run disables "Remove noise" and the slider (Ctrl+Enter starts one from there), which some browsers leave
        // holding focus for a moment; anywhere else the visitor went keeps it.
        const disabledByRun = document.activeElement === removeButton.current || document.activeElement === strengthInput.current;
        if (disabledByRun) target.focus();
        else focusIfIdle(target);
    }, [phase]);

    const clean = useCallback(async () => {
        if (!file || busy) return;
        const id = ++run.current;
        const current = () => id === run.current;
        const controller = new AbortController();
        stop.current = controller;
        setFailure(null);
        setResult(null);
        setReadPercent(undefined);
        shown.current = 0;
        focusNext.current = "cancel";
        setPhase("reading");
        const began = performance.now();
        try {
            // The engine, RNNoise's address and the worker load only now, when a recording is cleaned.
            const { removeNoise } = await import("@/lib/noise/engine");
            const cleaned = await removeNoise(file, {
                strength: strength / 100,
                signal: controller.signal,
                onStage: stage => {
                    if (!current()) return;
                    setPhase(stage);
                    // The speed, for the time left, is measured from when cleaning starts.
                    if (stage === "cleaning") setProgress({ done: 0, total: 0, started: performance.now() });
                },
                onRead: fraction => { if (current()) setReadPercent(fraction * 100); },
                onProgress: (done, total) => {
                    if (!current()) return;
                    const now = performance.now();
                    if (shown.current && now - shown.current < PROGRESS_EVERY) return;
                    shown.current = now;
                    setProgress(previous => ({ ...previous, done, total }));
                },
            });
            if (!current()) return;
            if (cleaned.stats.inputPeak < SILENT_PEAK) {
                emitToolRun({ outcome: "error", files: 1, errorKind: "bad_input" });
                setFailure({ title: "This recording is silent.", detail: "Every part of it is silence, so there was nothing to clean. Nothing was sent anywhere.", reason: "Silent", retryable: false, kind: "bad_input" });
                setPhase("failed");
                return;
            }
            // A run with stretches this browser couldn't decode is partial.
            emitToolRun(cleaned.gaps.length ? { outcome: "partial", files: 1, errorKind: "browser" } : { outcome: "success", files: 1 });
            setResult({ ...cleaned, strength, took: (performance.now() - began) / 1000 });
            setPhase("done");
        } catch (error) {
            if (!current()) return;
            if (toolErrorKind(error) === "cancelled") { setPhase("idle"); return; }
            const found = failureFor(error, file);
            emitToolRun({ outcome: "error", files: 1, errorKind: found.kind }, error);
            setFailure(found);
            setPhase("failed");
        } finally {
            if (stop.current === controller) stop.current = null;
        }
    }, [file, busy, strength]);

    const cancel = () => {
        run.current++;
        stop.current?.abort();
        focusNext.current = "remove";
        setPhase("idle");
    };

    const choose = (files: File[]) => {
        const [next] = files;
        if (!next) return;
        run.current++;
        stop.current?.abort();
        setFile(next);
        setResult(null);
        setFailure(null);
        setPhase("idle");
    };
    const startOver = () => {
        run.current++;
        setFile(null);
        setResult(null);
        setFailure(null);
        setReturning(true);
        setPhase("idle");
    };
    const backToSettings = () => {
        focusNext.current = "strength";
        setResult(null);
        setFailure(null);
        setPhase("idle");
    };

    useEffect(() => {
        const onKey = (event: KeyboardEvent) => {
            if ((event.metaKey || event.ctrlKey) && event.key === "Enter" && file && phase === "idle") {
                event.preventDefault();
                void clean();
            }
        };
        window.addEventListener("keydown", onKey);
        return () => window.removeEventListener("keydown", onKey);
    }, [file, phase, clean]);

    if (phase === "done" && result && file) {
        return <NoiseResultView file={file} result={result} onAgain={backToSettings} onStartOver={startOver} />;
    }

    if (phase === "failed" && failure && file) {
        return <StudioResult tone="failure" title={failure.title} detail={failure.detail}>
            <StudioFile name={file.name} status="error" detail={failure.reason} />
            {failure.help && <p className="ts-note nr-help">{failure.help}</p>}
            <StudioActions tone="failure" retryCount={failure.retryable ? 1 : 0} onRetry={() => void clean()}
                choose={{ accepts: ACCEPTS, label: "Choose a different file", onFiles: choose }} />
        </StudioResult>;
    }

    const eta = progress.done > 0 && progress.total > progress.done && progress.started
        ? ((performance.now() - progress.started) / 1000) * ((progress.total - progress.done) / progress.done) : null;

    return <StudioLayout className="nr-studio" options={<>
        <div>
            <h2>Strength</h2>
            <div className="ts-setting">
                <label htmlFor="nr-strength">How much of the cleaned sound · {strength}%</label>
                <input ref={strengthInput} id="nr-strength" type="range" min={10} max={100} step={STRENGTH_STEP} value={strength} disabled={busy}
                    aria-valuetext={`${strength}%: ${strengthWords(strength)}`}
                    onChange={event => setField("strength", Number(event.target.value))} />
            </div>
            <p className="nr-hint">At 100% you hear only the cleaned sound. If the voice sounds thin or watery, lower it a step or two: the rest is your original, noise and all, mixed back in.</p>
        </div>
        <div>
            <h2>Made for speech</h2>
            <p className="nr-hint">It takes steady noise from under a voice: hum, a fan, traffic, the hiss of a room. It isn’t for music, and it doesn’t remove other voices or echo. It turns the noise down rather than recreating the voice, so very loud noise can leave traces and very quiet speech can come out thinner.</p>
            <a className="ts-caption nr-credits" href="/third-party/rnnoise.txt" target="_blank" rel="noreferrer">RNNoise credits &amp; licences</a>
        </div>
    </>} action={<StudioActionBar ready={!!file} count={file ? { video: "1 video", webm: "1 file", recording: "1 recording" }[fileKind(file.name)] : undefined}>
        <button ref={removeButton} type="button" className="ts-primary-button" onClick={() => void clean()} disabled={!file || busy}>
            <AudioLines size={16} aria-hidden="true" /> Remove noise
        </button>
    </StudioActionBar>}>
        {!file
            ? <FileIntake accepts={ACCEPTS} title="Choose a recording or video" autoFocus={returning} onFiles={choose}
                detail={`MP3, WAV, M4A, OGG, FLAC, WebM, MP4 and more · ${LIMITS}, ${WHOLE_FILE_SECONDS / 60} for OGG and FLAC · made for speech`} />
            : <section aria-label="Chosen file" className="nr-chosen">
                <StudioFile name={file.name} detail={`${formatFileSize(file.size)} · ${{ video: "video: its sound is cleaned", webm: "WebM: its sound is cleaned", recording: "recording" }[fileKind(file.name)]}`}
                    onRemove={busy ? undefined : startOver} removeLabel={`Remove ${file.name}`} />
                {!busy && <LocalFilePreview file={file} name={file.name} label="Original" />}
            </section>}
        {stage && <div ref={progressBox} className="nr-progress">
            {/* One box for every stage, so its Cancel keeps focus from one to the next. */}
            <StudioProgress label={STAGES[stage].label} detail={STAGES[stage].detail} onCancel={cancel}
                progress={stage === "reading" ? readPercent : stage === "cleaning" && progress.total ? (progress.done / progress.total) * 100 : undefined} />
            {/* The clock changes every second, so it stays out of the box a screen reader announces. */}
            {stage === "cleaning" && <p className="ts-caption nr-clock">
                {progress.total ? `${clock(progress.done)} of ${clock(progress.total)}` : clock(progress.done)}{eta !== null ? ` · ${minutesLeft(eta)} at this speed` : ""}
            </p>}
        </div>}
    </StudioLayout>;
}

/** The end of a run: the original and the cleaned sound to compare, the download, and what to know. */
function NoiseResultView({ file, result, onAgain, onStartOver }: {
    file: File; result: NoiseResult & { strength: number; took: number }; onAgain: () => void; onStartOver: () => void;
}) {
    const stem = file.name.replace(/\.[^.]+$/, "") || "recording";
    const name = `${stem}-clean.wav`;
    const kind = fileKind(file.name);
    const { stats, gaps } = result;
    const speech = stats.heardFrames ? stats.speechFrames / stats.heardFrames : 0;
    const ranges = gaps.map(gap => `${clock(gap.start)}–${clock(gap.end)}`).join(", ");
    const tone = gaps.length ? "partial" : "success";
    const title = gaps.length ? (gaps.length > 1 ? "Noise reduced, with gaps." : "Noise reduced, with a gap.") : "Background noise reduced.";
    const detail = gaps.length
        ? `This browser couldn’t decode ${ranges} of the sound, so that part is silent in the WAV. Listen to the rest before you download it.`
        : "Listen to the original and the cleaned sound, the pauses especially, before you download the WAV.";
    const notes = [
        speech < LITTLE_SPEECH ? "RNNoise heard little speech in this recording. It is made for voices: music and other sounds can come out much quieter, or damaged." : "",
        stats.sourceChannels > 2 ? `The file has ${stats.sourceChannels} channels; they were mixed to one before cleaning, as speech sits in the centre.` : "",
        kind === "video" ? "From a video, only the cleaned sound comes back: put it back with the picture in a video editor." : "",
        kind === "webm" ? "Only the cleaned sound comes back. If the WebM is a video, put the WAV back with the picture in a video editor." : "",
    ].filter(Boolean);
    return <StudioResult tone={tone} title={title} detail={detail}>
        <dl className="ts-stats">
            <div><dt>Length</dt><dd>{length(result.seconds)}</dd></div>
            <div><dt>Strength</dt><dd>{result.strength}%</dd></div>
            <div><dt>WAV</dt><dd>{formatFileSize(result.wav.size)}</dd></div>
            <div><dt>Took</dt><dd>{length(result.took)}</dd></div>
        </dl>
        <Compare original={file} cleaned={result.wav} name={file.name} />
        {notes.map(note => <p className="ts-note" key={note}>{note}</p>)}
        <div className="ts-actions">
            <button type="button" className="ts-primary-button" onClick={() => downloadBlob(result.wav, name)}><Download size={16} aria-hidden="true" /> Download WAV</button>
            <button type="button" className="ts-secondary-button" onClick={onAgain}>Change the strength</button>
            <button type="button" className="ts-text-button" onClick={onStartOver}>Clean another file</button>
        </div>
        <p className="ts-caption nr-next">The WAV is {stats.channels === 2 ? "stereo" : "mono"}, 16-bit, at 48 kHz, the rate RNNoise works at, and was made on this device; nothing was uploaded. {result.wav.size <= SERVER_MEDIA_MAX
            ? <>WAV files are large: <a href="/tools/audio-converter">Audio Converter</a> can make an MP3 of it, which means uploading the WAV to PrivaTools for temporary processing.</>
            : <>At {formatFileSize(result.wav.size)} it is larger than the {SERVER_MEDIA_MAX_LABEL} that Audio Converter takes, so an audio app on your device can make an MP3 of it.</>}
            {result.wav.size <= MAX_FILE_SIZE
                ? <> To turn the speech into text, download the WAV, open <a href="/tools/transcribe-audio">Transcribe Audio</a> and choose the downloaded file.</>
                : <> It is also larger than the {MAX_FILE_SIZE_LABEL} that Transcribe Audio takes.</>}</p>
    </StudioResult>;
}

/** The original and the cleaned sound, each in its own player; playing one pauses the other. */
function Compare({ original, cleaned, name }: { original: File; cleaned: Blob; name: string }) {
    const [urls, setUrls] = useState<{ before: string; after: string } | null>(null);
    const before = useRef<HTMLAudioElement>(null);
    const after = useRef<HTMLAudioElement>(null);
    useEffect(() => {
        const next = { before: URL.createObjectURL(original), after: URL.createObjectURL(cleaned) };
        setUrls(next);
        return () => { URL.revokeObjectURL(next.before); URL.revokeObjectURL(next.after); };
    }, [original, cleaned]);
    if (!urls) return null;
    // Read at the time of playing: the players exist by then.
    const pause = (other: { current: HTMLAudioElement | null }) => () => { if (other.current && !other.current.paused) other.current.pause(); };
    return <section className="nr-compare" aria-labelledby="nr-compare-title">
        <h3 id="nr-compare-title">Compare before and after</h3>
        <figure>
            <figcaption>Original</figcaption>
            <audio ref={before} src={urls.before} controls preload="metadata" aria-label={`Original: ${name}`} onPlay={pause(after)} />
        </figure>
        <figure>
            <figcaption>Cleaned</figcaption>
            <audio ref={after} src={urls.after} controls preload="metadata" aria-label="Cleaned sound" onPlay={pause(before)} />
        </figure>
    </section>;
}
