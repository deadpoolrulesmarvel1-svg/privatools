/**
 * SubtitleGeneratorUI — subtitles from a video or recording, made in this
 * browser.
 *
 * The sound is read from the file about a minute at a time
 * (lib/subtitles/media), Whisper turns it into timed text on this device
 * (lib/whisper.ts, lib/subtitles/recognize.ts), and the text is laid out as
 * captions (lib/subtitles/captions.ts). The visitor reads and corrects them
 * against the video, then downloads SRT or VTT. Nothing is uploaded; the
 * model comes from Hugging Face on the first run and the browser keeps it.
 */
import { memo, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Captions, Download } from "lucide-react";
import { downloadBlob, formatFileSize, SERVER_MEDIA_MAX, SERVER_MEDIA_MAX_LABEL } from "@/lib/api";
import { nonPdfTools } from "@/data/non-pdf-tools";
import { emitToolRun, isTransientFailure, toolErrorKind, type ToolErrorKind } from "@/lib/toolRun";
import { useToolDefaults } from "@/hooks/useToolDefaults";
import { listCachedModels, formatBytes } from "@/lib/localModels";
import { subtitleTime, toSrt, toVtt, type SpeechSegment } from "@/lib/speechTranscript";
import { loadWhisper, stopWhisper, WHISPER, type WhisperSize } from "@/lib/whisper";
import { buildCues, layoutFor, type CaptionStyle } from "@/lib/subtitles/captions";
import { isSpeechLanguage, languageName, SPEECH_LANGUAGES } from "@/lib/subtitles/languages";
import { MAX_SECONDS, MediaError, openAudio } from "@/lib/subtitles/media/extract";
import { recognizeSpeech, type AudioChunk } from "@/lib/subtitles/recognize";
import { FileIntake, LocalFilePreview, StudioActionBar, StudioActions, StudioFile, StudioLayout, StudioProgress, StudioResult } from "@/skins/experience/ToolStudio";
import { retryLine } from "@/skins/experience/studio-outcome";
import "./subtitle-generator.css";

const SLUG = "subtitle-generator";
/** What the readers take: MP4, MOV, M4A, WebM, MKV, MP3 and WAV in pieces; Ogg, Opus, FLAC and AAC whole. */
const ACCEPTS = ".mp4,.m4v,.mov,.webm,.mkv,.mp3,.m4a,.wav,.ogg,.oga,.opus,.flac,.aac";
const VIDEO = /\.(mp4|m4v|mov|webm|mkv)$/i;

type Settings = { model: WhisperSize; language: string; style: CaptionStyle };

/** Base, or Tiny on a phone-sized screen or a device that says it has 4 GB of memory or less: Whisper Base needs about 2 GB. */
function suggestedModel(): WhisperSize {
    const memory = (navigator as { deviceMemory?: number }).deviceMemory;
    if (typeof memory === "number" && memory <= 4) return "tiny";
    return typeof window.matchMedia === "function" && window.matchMedia("(max-width: 560px)").matches ? "tiny" : "base";
}

const STYLES: { id: CaptionStyle; label: string; use: string }[] = [
    { id: "two", label: "Two lines", use: "For players, TV and YouTube." },
    { id: "one", label: "One line", use: "Less text on screen at once." },
    { id: "short", label: "Short", use: "For vertical video and reels." },
];

/** "4:05" or "1:02:03". */
function clock(seconds: number): string {
    const whole = Math.max(0, Math.round(seconds));
    const h = Math.floor(whole / 3600);
    const m = Math.floor(whole / 60) % 60;
    const s = String(whole % 60).padStart(2, "0");
    return h ? `${h}:${String(m).padStart(2, "0")}:${s}` : `${m}:${s}`;
}

/** A cue's time in the editor: to the tenth of a second, with hours only when the file has them. */
function cueClock(seconds: number, hours: boolean): string {
    const time = subtitleTime(seconds, ".");
    return (hours ? time : time.slice(3)).slice(0, -2);
}

function minutesLeft(seconds: number): string {
    if (seconds < 60) return "less than a minute left";
    if (seconds < 90) return "about a minute left";
    return `about ${Math.round(seconds / 60)} minutes left`;
}

type Phase = "idle" | "reading" | "model" | "listening" | "stopping" | "done" | "failed";

interface Result {
    cues: SpeechSegment[];
    /** How many captions Whisper's words made, before any were cleared. */
    written: number;
    stopped: boolean;
    doneSeconds: number;
    totalSeconds: number;
    unreadable: { start: number; end: number }[];
    /** Stretches where Whisper wrote only a loop, left out. */
    unclear: { start: number; end: number }[];
    language: string;
    model: WhisperSize;
    seconds: number;
}

interface Failure {
    title: string;
    detail: string;
    /** A reason shown on the file's row. */
    reason: string;
    /** Another attempt could work: the model download dropped. */
    retryable: boolean;
    kind?: ToolErrorKind;
    /** No words were heard: the language or model may be the cause, so offer the settings again. */
    settings?: boolean;
    /** Another tool that can help, with what it does with the file. */
    help?: ReactNode;
}

/**
 * Whether a server-backed PrivaTools tool takes this file: its type, by the
 * tool's own list, and its size. Extract Audio, Audio Converter and Cut / Trim
 * Video & Audio take SERVER_MEDIA_MAX on the server.
 */
function takes(slug: string, file: File): boolean {
    const extension = /\.[^.]+$/.exec(file.name)?.[0].toLowerCase();
    const tool = nonPdfTools.find(entry => entry.slug === slug);
    return Boolean(extension && tool?.accepts.split(",").includes(extension)) && file.size <= SERVER_MEDIA_MAX;
}

/** A tool that can save the sound as an MP3, which this page reads up to 3 hours, and what using it means. */
function mp3Maker(file: File): ReactNode {
    const video = VIDEO.test(file.name);
    if (video && takes("extract-audio", file)) {
        return <><a href="/tools/extract-audio">Extract Audio</a> can save its sound as an MP3 on the PrivaTools server, which means uploading the video for temporary processing; the MP3 then works here, up to {MAX_SECONDS / 3600} hours.</>;
    }
    if (!video && takes("audio-converter", file)) {
        return <><a href="/tools/audio-converter">Audio Converter</a> can turn it into an MP3 on the PrivaTools server, which means uploading the recording for temporary processing; the MP3 then works here, up to {MAX_SECONDS / 3600} hours.</>;
    }
    if (file.size > SERVER_MEDIA_MAX) {
        return <>It is larger than the {SERVER_MEDIA_MAX_LABEL} that {video ? "Extract Audio" : "Audio Converter"} takes, so save it as MP4 or MP3 with a video or audio app on your device; those work here up to {MAX_SECONDS / 3600} hours.</>;
    }
    return <>A video or audio app on your device can save it as MP4 or MP3, which work here up to {MAX_SECONDS / 3600} hours.</>;
}

function failureFor(error: unknown, file: File): Failure {
    if (error instanceof MediaError) {
        if (error.problem === "empty") return { title: "This file is empty.", detail: "It holds no data, so there is no sound to read. Choose the file again, or a copy that plays.", reason: "Empty file", retryable: false, kind: "bad_input" };
        if (error.problem === "no-sound") return { title: "This file has no sound track.", detail: "There is nothing in it to subtitle.", reason: "No sound track", retryable: false, kind: "bad_input" };
        if (error.problem === "too-long") return {
            title: "This file is too long to subtitle here.", detail: error.message, reason: `Longer than ${MAX_SECONDS / 3600} hours of sound`, retryable: false, kind: "too_large",
            help: takes("trim-media", file)
                ? <>To subtitle it in parts of up to {MAX_SECONDS / 3600} hours, cut it with <a href="/tools/trim-media">Cut / Trim Video &amp; Audio</a>, which uploads the file to PrivaTools for temporary processing.</>
                : <>To subtitle it, cut it into parts of up to {MAX_SECONDS / 3600} hours with a video or audio app on your device{file.size > SERVER_MEDIA_MAX ? `: it is larger than the ${SERVER_MEDIA_MAX_LABEL} Cut / Trim Video & Audio takes` : ""}.</>,
        };
        if (error.problem === "too-long-whole") return {
            title: "This file is too long to read whole.", detail: error.message, reason: "Too long for this format", retryable: false, kind: "too_large", help: mp3Maker(file),
        };
        return {
            title: "This browser can’t read the sound in this file.", detail: "Nothing was sent anywhere.", reason: error.message, retryable: false, kind: "bad_input",
            help: <>{mp3Maker(file)} A different browser may also be able to read it.</>,
        };
    }
    const kind = toolErrorKind(error);
    if (kind === "cancelled") {
        return { title: "The subtitles weren’t finished.", detail: "Whisper was stopped before it finished, as it is when the page is left. Generate them again to start over.", reason: "Stopped", retryable: true };
    }
    if (kind === "network" || kind === "timeout") {
        return { title: "Whisper couldn’t be downloaded.", detail: `The model comes from Hugging Face on the first run. ${retryLine([kind])}`, reason: "The model download didn’t finish", retryable: isTransientFailure(error), kind };
    }
    return { title: "Subtitles couldn’t be made.", detail: "Something failed in this browser while the subtitles were being made. Closing other tabs frees memory, and Whisper Tiny needs less than Base.", reason: error instanceof Error && error.message ? error.message : "Whisper stopped with an error", retryable: false, kind };
}

/** The first chunk, already read, then the rest. */
async function* resume(first: IteratorResult<AudioChunk>, rest: AsyncGenerator<AudioChunk>): AsyncGenerator<AudioChunk> {
    if (!first.done) yield first.value;
    yield* rest;
}

export function SubtitleGeneratorUI() {
    const [defaults] = useState<Settings>(() => ({ model: suggestedModel(), language: "en", style: "two" }));
    const [stored, , { setField }] = useToolDefaults(SLUG, defaults);
    // A remembered value from an older version is checked before it is used.
    const settings = useMemo(() => ({
        model: stored.model === "tiny" || stored.model === "base" ? stored.model : defaults.model,
        language: isSpeechLanguage(stored.language) ? stored.language : "en",
        style: STYLES.some(style => style.id === stored.style) ? stored.style : "two",
    } as Settings), [stored.model, stored.language, stored.style, defaults.model]);
    const [file, setFile] = useState<File | null>(null);
    const [phase, setPhase] = useState<Phase>("idle");
    const [readPercent, setReadPercent] = useState<number | undefined>();
    const [modelPercent, setModelPercent] = useState(0);
    const [progress, setProgress] = useState({ done: 0, total: 0, started: 0 });
    const [result, setResult] = useState<Result | null>(null);
    const [failure, setFailure] = useState<Failure | null>(null);
    const [cached, setCached] = useState<Record<string, number>>({});
    // Back from a result, focus waits on the intake.
    const [returning, setReturning] = useState(false);
    const run = useRef(0);
    const stop = useRef<AbortController | null>(null);
    const reading = useRef<AbortController | null>(null);
    const busy = phase === "reading" || phase === "model" || phase === "listening" || phase === "stopping";

    // What is really in this browser's model cache, for the model choices.
    const refreshCache = useCallback(() => {
        void listCachedModels().then(models => setCached(Object.fromEntries(models.map(model => [model.hfId, model.bytes]))));
    }, []);
    useEffect(() => { refreshCache(); }, [refreshCache]);
    // Leaving the page ends a run, and Whisper with it: its result would have nowhere to go.
    useEffect(() => () => { run.current++; stop.current?.abort(); reading.current?.abort(); stopWhisper(); }, []);

    const generate = useCallback(async () => {
        if (!file || busy) return;
        const id = ++run.current;
        const current = () => id === run.current;
        const controller = new AbortController();
        stop.current = controller;
        const read = new AbortController();
        reading.current = read;
        const { model, language, style } = settings;
        setFailure(null);
        setResult(null);
        setReadPercent(undefined);
        setPhase("reading");
        try {
            const source = await openAudio(file, { signal: read.signal, onRead: bytes => { if (current()) setReadPercent((bytes / file.size) * 100); } });
            const chunks = source.chunks();
            // The first piece is decoded before the model is fetched: a file this browser can't read fails here.
            const first = await chunks.next();
            if (!current()) { await chunks.return(undefined); return; }
            setModelPercent(0);
            setPhase("model");
            const whisper = await loadWhisper(model, percent => { if (current()) setModelPercent(percent); });
            if (!current()) { await chunks.return(undefined); return; }
            refreshCache();
            const started = performance.now();
            setProgress({ done: 0, total: source.durationSeconds, started });
            setPhase("listening");
            const heard = await recognizeSpeech(resume(first, chunks), whisper, {
                language,
                totalSeconds: source.durationSeconds,
                signal: controller.signal,
                onProgress: (done, total) => { if (current()) setProgress({ done, total, started }); },
            });
            if (!current()) return;
            const cues = buildCues(heard.segments, layoutFor(language, style), heard.totalSeconds);
            const seconds = (performance.now() - started) / 1000;
            if (!cues.length) {
                // Stopped before any words: back to the settings, as a cancel.
                if (heard.stopped) { setPhase("idle"); return; }
                if (heard.unclear.length) {
                    emitToolRun({ outcome: "error", files: 1, errorKind: "browser" });
                    setFailure({ title: "Whisper couldn’t make out the words.", detail: `It wrote the same words over and over, so they were left out.${model === "tiny" ? " The Base model may hear them better." : ""} Check that ${languageName(language)} is the language spoken.`, reason: "Whisper repeated itself", retryable: false, kind: "browser", settings: true });
                    setPhase("failed");
                    return;
                }
                emitToolRun({ outcome: "error", files: 1, errorKind: "bad_input" });
                setFailure({ title: "No speech was found.", detail: `Whisper heard no words it could write down. If people do speak in it, check that ${languageName(language)} is the language they speak${model === "tiny" ? ", or try the Base model" : ""}.`, reason: "No speech found", retryable: false, kind: "bad_input", settings: true });
                setPhase("failed");
                return;
            }
            // A run the visitor stopped is not counted; one with stretches left without captions is partial.
            if (!heard.stopped) emitToolRun(heard.unreadable.length || heard.unclear.length ? { outcome: "partial", files: 1, errorKind: "browser" } : { outcome: "success", files: 1 });
            setResult({ cues, written: cues.length, stopped: heard.stopped, doneSeconds: heard.doneSeconds, totalSeconds: heard.totalSeconds, unreadable: heard.unreadable, unclear: heard.unclear, language, model, seconds });
            setPhase("done");
        } catch (error) {
            if (!current()) return;
            // A failed run may leave Whisper's worker unable to run again: the next one starts a new worker.
            if (!(error instanceof MediaError)) stopWhisper();
            const found = failureFor(error, file);
            emitToolRun({ outcome: "error", files: 1, errorKind: found.kind }, error);
            setFailure(found);
            setPhase("failed");
        }
    }, [file, busy, settings, refreshCache]);

    const cancel = () => {
        if (phase === "listening") {
            // Stops after the stretch Whisper is on, keeping what it has written.
            stop.current?.abort();
            setPhase("stopping");
            return;
        }
        run.current++;
        stop.current?.abort();
        reading.current?.abort();
        // A model still loading is stopped with the worker; the download starts again next time.
        if (phase === "model") stopWhisper();
        setPhase("idle");
    };

    const choose = (files: File[]) => {
        const [next] = files;
        if (!next) return;
        run.current++;
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
    const backToSettings = () => { setFailure(null); setPhase("idle"); };
    const editCue = useCallback((index: number, text: string) => {
        setResult(current => current && { ...current, cues: current.cues.map((cue, i) => i === index ? { ...cue, text } : cue) });
    }, []);

    useEffect(() => {
        const onKey = (event: KeyboardEvent) => {
            if ((event.metaKey || event.ctrlKey) && event.key === "Enter" && file && phase === "idle") {
                event.preventDefault();
                void generate();
            }
        };
        window.addEventListener("keydown", onKey);
        return () => window.removeEventListener("keydown", onKey);
    }, [file, phase, generate]);

    if (phase === "done" && result && file) {
        return <SubtitleResult file={file} result={result} onEdit={editCue} onStartOver={startOver} />;
    }

    if (phase === "failed" && failure && file) {
        return <StudioResult tone="failure" title={failure.title} detail={failure.detail}>
            <StudioFile name={file.name} status="error" detail={failure.reason} />
            {failure.help && <p className="ts-note sg-help">{failure.help}</p>}
            <StudioActions tone="failure" retryCount={failure.retryable ? 1 : 0} onRetry={() => void generate()}
                choose={{ accepts: ACCEPTS, label: "Choose a different file", onFiles: choose }}
                more={failure.settings && <button type="button" className="ts-text-button" onClick={backToSettings}>Change the language or model</button>} />
        </StudioResult>;
    }

    const layout = layoutFor(settings.language, settings.style);
    const eta = progress.done > 0 && progress.total > progress.done
        ? ((performance.now() - progress.started) / 1000) * ((progress.total - progress.done) / progress.done) : null;

    return <StudioLayout className="sg-studio" options={<>
        <div>
            <h2>Spoken language</h2>
            <div className="ts-setting">
                <label htmlFor="sg-language">Language in the file</label>
                <select id="sg-language" value={settings.language} disabled={busy} onChange={event => setField("language", event.target.value)}>
                    {SPEECH_LANGUAGES.map(language => <option key={language.code} value={language.code}>{language.name}</option>)}
                </select>
            </div>
            <p className="sg-hint">Whisper doesn’t work out the language here, so choose the one spoken. It writes best in widely spoken languages.</p>
        </div>
        <div>
            <h2>Model</h2>
            <div className="ts-choices">{(["base", "tiny"] as WhisperSize[]).map(size => {
                const bytes = cached[WHISPER[size].hfId];
                return <button type="button" className="ts-choice" key={size} aria-pressed={settings.model === size} disabled={busy} onClick={() => setField("model", size)}>
                    <strong>Whisper {WHISPER[size].label}</strong>
                    <span>{size === "base" ? "More accurate, slower." : "Faster, less accurate."} {bytes ? `In this browser (${formatBytes(bytes)}).` : `Downloads ${WHISPER[size].size.replace("~", "about ")} once.`}</span>
                </button>;
            })}</div>
            <p className="sg-hint">Whisper runs on this device’s processor. On a two-core test computer, Base took about 45 seconds per minute of sound and used about 2 GB of memory; Tiny took about 20 seconds and 1 to 2 GB. Most laptops are faster. On a phone, choose Tiny.</p>
        </div>
        <div>
            <h2>Captions</h2>
            <div className="ts-choices">{STYLES.map(style => {
                const shape = layoutFor(settings.language, style.id);
                return <button type="button" className="ts-choice" key={style.id} aria-pressed={settings.style === style.id} disabled={busy} onClick={() => setField("style", style.id)}>
                    <strong>{style.label}</strong>
                    <span>{shape.maxLines === 2 ? "Up to 2 lines" : "1 line"} of {shape.maxLineChars} characters. {style.use}</span>
                </button>;
            })}</div>
            <p className="sg-hint">Each caption stays on screen for at most 7 seconds.</p>
        </div>
    </>} action={<StudioActionBar ready={!!file} count={file ? (VIDEO.test(file.name) ? "1 video" : "1 recording") : undefined}>
        <button type="button" className="ts-primary-button" onClick={() => void generate()} disabled={!file || busy}>
            <Captions size={16} aria-hidden="true" /> Generate subtitles
        </button>
    </StudioActionBar>}>
        {!file
            ? <FileIntake accepts={ACCEPTS} title="Choose a video or recording" autoFocus={returning} onFiles={choose}
                detail={`MP4, MOV, WebM, MKV, MP3, M4A, WAV and more · up to ${MAX_SECONDS / 3600} hours of sound · works best on clear speech`} />
            : <section aria-label="Chosen file" className="sg-chosen">
                <StudioFile name={file.name} detail={`${formatFileSize(file.size)} · ${VIDEO.test(file.name) ? "video" : "recording"}`}
                    onRemove={busy ? undefined : startOver} removeLabel={`Remove ${file.name}`} />
                {!busy && <LocalFilePreview file={file} name={file.name} />}
            </section>}
        {phase === "reading" && <StudioProgress label="Reading the sound" progress={readPercent} onCancel={cancel}
            detail="Finding the sound track in this browser and checking it can be decoded." />}
        {phase === "model" && <StudioProgress label={cached[WHISPER[settings.model].hfId] ? `Loading Whisper ${WHISPER[settings.model].label}` : `Downloading Whisper ${WHISPER[settings.model].label}`}
            progress={modelPercent} onCancel={cancel}
            detail={cached[WHISPER[settings.model].hfId] ? "From this browser’s storage." : `${WHISPER[settings.model].size.replace("~", "About ")} from Hugging Face, once. Your file stays here.`} />}
        {(phase === "listening" || phase === "stopping") && <StudioProgress
            label={phase === "stopping" ? "Stopping after this stretch" : "Writing subtitles"}
            progress={progress.total ? (progress.done / progress.total) * 100 : undefined}
            onCancel={phase === "listening" ? cancel : undefined} cancelLabel="Stop and keep what’s done"
            detail={`${clock(progress.done)} of ${clock(progress.total)}${eta !== null ? ` · ${minutesLeft(eta)} at this speed` : ""} · Whisper ${WHISPER[settings.model].label} on this device. Keep this tab open.`} />}
        {!busy && file && <p className="sg-hint sg-expect">Captions come out as {layout.maxLines === 2 ? "up to two lines" : "one line"} of {layout.maxLineChars} characters, in {languageName(settings.language)}. Music, people talking over each other and strong accents make mistakes likelier, so you’ll check them before you download. Steady background noise, such as a fan or traffic, can be turned down first with <a href="/tools/remove-background-noise">Voice Noise Remover</a>, also in this browser.</p>}
    </StudioLayout>;
}

/** The end of a run: what was made, the captions to check and correct against the video, and the downloads. */
function SubtitleResult({ file, result, onEdit, onStartOver }: { file: File; result: Result; onEdit: (index: number, text: string) => void; onStartOver: () => void }) {
    const stem = file.name.replace(/\.[^.]+$/, "") || "subtitles";
    const kept = result.cues.filter(cue => cue.text.trim());
    const gaps = result.unreadable.reduce((sum, range) => sum + (range.end - range.start), 0);
    const ranges = (list: { start: number; end: number }[]) => list.map(range => `${clock(range.start)}–${clock(range.end)}`).join(", ");
    const missing = [
        gaps > 0 ? `This browser couldn’t decode ${clock(gaps)} of the sound (${ranges(result.unreadable)}), so that part has none.` : "",
        result.unclear.length ? `Whisper wrote the same words over and over at ${ranges(result.unclear)}, so they were left out and that part has none.` : "",
    ].filter(Boolean).join(" ");
    const tone = result.stopped || missing ? "partial" : "success";
    const title = result.stopped ? `Subtitles for the first ${clock(result.doneSeconds)}.`
        : missing ? (result.unreadable.length + result.unclear.length > 1 ? "Subtitles, with gaps." : "Subtitles, with a gap.")
            : `${result.written.toLocaleString()} ${result.written === 1 ? "caption" : "captions"} written.`;
    const detail = result.stopped
        ? `You stopped at ${clock(result.doneSeconds)} of ${clock(result.totalSeconds)}, so the rest has no captions. Check these before you download them.`
        : missing ? `${missing} Check the rest before you download.`
            : "Play the file and read along: correct any words, then download.";
    const save = (format: "srt" | "vtt") => downloadBlob(
        new Blob([format === "srt" ? toSrt(result.cues) : toVtt(result.cues)], { type: format === "srt" ? "application/x-subrip;charset=utf-8" : "text/vtt;charset=utf-8" }),
        `${stem}.${format}`,
    );
    return <StudioResult tone={tone} title={title} detail={detail}>
        <dl className="ts-stats">
            <div><dt>Captions</dt><dd>{kept.length.toLocaleString()}</dd></div>
            <div><dt>Sound</dt><dd>{clock(result.doneSeconds)}</dd></div>
            <div><dt>Language</dt><dd>{languageName(result.language)}</dd></div>
            <div><dt>Took</dt><dd>{clock(result.seconds)}</dd></div>
        </dl>
        <CaptionEditor file={file} cues={result.cues} language={result.language} onEdit={onEdit} />
        <div className="ts-actions">
            <button type="button" className="ts-primary-button" onClick={() => save("srt")} disabled={!kept.length}><Download size={16} aria-hidden="true" /> Download SRT</button>
            <button type="button" className="ts-secondary-button" onClick={() => save("vtt")} disabled={!kept.length}><Download size={16} aria-hidden="true" /> Download VTT</button>
            <button type="button" className="ts-text-button" onClick={onStartOver}>Subtitle another file</button>
        </div>
        <p className="ts-caption sg-next">Whisper {WHISPER[result.model].label} wrote these on this device; nothing was uploaded. To show them in the picture itself, <a href="/tools/add-subtitles">Add Subtitles</a> burns the SRT into the video, which means uploading the video and the subtitles to PrivaTools for temporary processing. <a href="/tools/subtitle-converter">Subtitle Converter</a> changes between SRT and VTT in this browser. To translate them, download the SRT, open <a href="/tools/subtitle-translator">Subtitle Translator</a> and choose the downloaded file.</p>
    </StudioResult>;
}

const CueRow = memo(function CueRow({ index, cue, hours, playing, onText, onSeek }: {
    index: number; cue: SpeechSegment; hours: boolean; playing: boolean;
    onText: (index: number, text: string) => void; onSeek?: (seconds: number) => void;
}) {
    const from = cueClock(cue.start, hours);
    const to = cueClock(cue.end, hours);
    return <li className="sg-cue" data-playing={playing || undefined}>
        {onSeek
            ? <button type="button" className="sg-cue-time" onClick={() => onSeek(cue.start)} aria-label={`Play from ${from}`}>{from} – {to}</button>
            : <span className="sg-cue-time">{from} – {to}</span>}
        <textarea dir="auto" rows={2} value={cue.text} spellCheck aria-label={`Caption ${index + 1}, ${from} to ${to}`}
            onChange={event => onText(index, event.target.value)} />
    </li>;
});

/** The file, playing with the captions as they now read, beside every caption to correct. */
function CaptionEditor({ file, cues, language, onEdit }: { file: File; cues: SpeechSegment[]; language: string; onEdit: (index: number, text: string) => void }) {
    const video = VIDEO.test(file.name);
    const media = useRef<HTMLMediaElement | null>(null);
    const list = useRef<HTMLOListElement>(null);
    const [mediaUrl, setMediaUrl] = useState("");
    const [trackUrl, setTrackUrl] = useState("");
    const [playing, setPlaying] = useState(-1);
    const hours = cues.some(cue => cue.end >= 3600);
    const latest = useRef(cues);
    latest.current = cues;

    useEffect(() => {
        const url = URL.createObjectURL(file);
        setMediaUrl(url);
        return () => URL.revokeObjectURL(url);
    }, [file]);
    // The player shows the captions as they read now, a moment after each edit.
    useEffect(() => {
        if (!video) return;
        const timer = setTimeout(() => setTrackUrl(URL.createObjectURL(new Blob([toVtt(cues)], { type: "text/vtt" }))), 400);
        return () => clearTimeout(timer);
    }, [cues, video]);
    // A track's address is released once a newer one replaces it, or the editor closes.
    useEffect(() => {
        const track = media.current?.textTracks?.[0];
        if (track) track.mode = "showing";
        return () => { if (trackUrl) URL.revokeObjectURL(trackUrl); };
    }, [trackUrl]);

    const onSeek = useCallback((seconds: number) => {
        const element = media.current;
        if (!element) return;
        element.currentTime = seconds;
        void element.play?.()?.catch(() => {});
    }, []);
    const onTime = () => {
        const now = media.current?.currentTime ?? 0;
        const index = latest.current.findIndex(cue => now >= cue.start && now < cue.end);
        if (index === playing) return;
        setPlaying(index);
        // Keep the playing caption in view inside the list, unless the visitor is typing in it.
        const row = index >= 0 ? list.current?.children[index] as HTMLElement | undefined : undefined;
        if (row && list.current && !list.current.contains(document.activeElement)) {
            // The list is positioned, so a row's offsetTop is measured from the list's top.
            list.current.scrollTop = row.offsetTop - list.current.clientHeight / 3;
        }
    };

    return <section className="sg-editor" aria-labelledby="sg-editor-title">
        <div className="sg-editor-head">
            <h3 id="sg-editor-title">Check the captions</h3>
            <p>Clear a caption to leave it out. A line break you type stays in the file.</p>
        </div>
        {mediaUrl && (video
            ? <video ref={element => { media.current = element; }} className="sg-player" src={mediaUrl} controls preload="metadata" playsInline onTimeUpdate={onTime} aria-label={`${file.name}, with the captions`}>
                {trackUrl && <track key={trackUrl} kind="subtitles" src={trackUrl} srcLang={language} label="Generated captions" default />}
            </video>
            : <audio ref={element => { media.current = element; }} className="sg-player" src={mediaUrl} controls preload="metadata" onTimeUpdate={onTime} aria-label={file.name} />)}
        <ol className="sg-cues" ref={list} aria-label="Captions">
            {cues.map((cue, index) => <CueRow key={index} index={index} cue={cue} hours={hours} playing={index === playing} onText={onEdit} onSeek={mediaUrl ? onSeek : undefined} />)}
        </ol>
    </section>;
}
