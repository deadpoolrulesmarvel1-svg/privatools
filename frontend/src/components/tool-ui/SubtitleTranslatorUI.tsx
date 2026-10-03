/**
 * SubtitleTranslatorUI — an SRT or VTT file in another language, with every
 * cue's number and timing kept.
 *
 * The file is read on this device (lib/subtitles/subtitleFile.ts) and its
 * cues taken apart (cueText.ts). Consecutive cues are translated together as
 * the sentences they form and the translation is put back across the same
 * cues, wrapped to two lines (passages.ts, translateSubtitles.ts). Two
 * translators: OPUS-MT on this device, the pairs Translate PDF uses
 * (lib/translate/opusMt.ts), or the visitor's own AI provider with their key
 * (lib/byok), which takes any pair and sees the dialogue around each line.
 * The visitor reads each line beside its original and corrects any, then
 * downloads SRT or VTT. Nothing goes to PrivaTools.
 */
import { memo, useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { Download, Film, Languages, RotateCcw, Sparkles } from "lucide-react";
import { downloadBlob, formatFileSize } from "@/lib/api";
import { emitToolRun, toolErrorKind, type ToolErrorKind } from "@/lib/toolRun";
import { useToolDefaults } from "@/hooks/useToolDefaults";
import { useByok } from "@/hooks/useByok";
import { ByokPanel } from "@/components/byok/ByokPanel";
import { getBaseUrl, getKey } from "@/lib/byok/keyStore";
import { providerById } from "@/lib/byok/providers";
import { translateLinesWithByok } from "@/lib/byok/tasks";
import { formatBytes, listCachedModels } from "@/lib/localModels";
import { storeFileHandoff } from "@/lib/file-handoff";
import { navigateTo } from "@/lib/navigation";
import {
    APPROX_MODEL_MB, BYOK_TARGETS, FROM_ENGLISH, TO_ENGLISH, availableSources, byokTarget, languageName, modelIdFor, targetsFor,
    type TargetLanguage,
} from "@/lib/translate/languages";
import { loadDeviceTranslator, MAX_INPUT_TOKENS } from "@/lib/translate/opusMt";
import { layoutFor } from "@/lib/subtitles/captions";
import { convertCueMarkup } from "@/lib/subtitles/cueText";
import { cuesOf, formatTime, readSubtitleFile, SubtitleFileError, type SubtitleDocument, type SubtitleFormat } from "@/lib/subtitles/subtitleFile";
import {
    assembleCues, exportSubtitles, guessLanguageFromScript, planTranslation, subPlan, translateOnDevice, translateWithModel, translatedFileName,
    type ItemOutcome, type RunResult, type TranslatedCue, type TranslationPlan,
} from "@/lib/subtitles/translateSubtitles";
import { FileIntake, StudioActionBar, StudioActions, StudioFile, StudioLayout, StudioProgress, StudioResult } from "@/skins/experience/ToolStudio";
import { retryLine } from "@/skins/experience/studio-outcome";
import "./subtitle-translator.css";

const SLUG = "subtitle-translator";
const ACCEPTS = ".srt,.vtt";

type Engine = "device" | "byok";
type Settings = { engine: Engine; source: string; target: string; byokTarget: string; byokModel: string };
const DEFAULTS: Settings = { engine: "device", source: "en", target: "es", byokTarget: "Spanish", byokModel: "" };

/** A short talk, made up for trying the tool: a sentence across two cues, two speakers in one, and italics. */
const SAMPLE = `1
00:00:01,000 --> 00:00:03,200
Welcome back to the workshop.

2
00:00:03,400 --> 00:00:05,900
Today we're going to look at

3
00:00:06,000 --> 00:00:08,500
how to keep your files private.

4
00:00:09,000 --> 00:00:11,500
- Can I translate subtitles here?
- Yes, right in this browser.

5
00:00:12,000 --> 00:00:14,500
<i>Every timing stays where it was.</i>
`;

/**
 * Languages Add Subtitles can't draw: the release image's only fonts are
 * DejaVu Sans, Serif and Mono and OpenSymbol (what its apt-get install pulls
 * in, checked 2026-10-03), which have no Chinese, Japanese, Korean, Thai or
 * Devanagari and Bengali letters.
 */
const NO_SERVER_FONT = new Set(["zh", "ja", "ko", "th", "hi", "bn"]);

const n = (value: number) => value.toLocaleString("en-US");
const plural = (count: number, one: string, many = `${one}s`) => `${n(count)} ${count === 1 ? one : many}`;
const FORMAT_NAME: Record<SubtitleFormat, string> = { srt: "SRT", vtt: "VTT" };

interface Chosen {
    file: File;
    doc?: SubtitleDocument;
    problem?: { title: string; detail: string; ass: boolean };
    /** The source language the file's letters named, when the page switched to it. */
    switchedTo?: string;
}

interface RunInfo {
    engine: Engine;
    /** On this device: the pair's codes. */
    source?: string;
    to: TargetLanguage;
    provider?: string;
    providerLabel?: string;
    model?: string;
}

type EditableCue = TranslatedCue & { edited?: boolean };

interface Result {
    file: File;
    doc: SubtitleDocument;
    plan: TranslationPlan;
    outcomes: (ItemOutcome | undefined)[];
    cues: EditableCue[];
    run: RunInfo;
    seconds: number;
    /** Why the run stopped before the end, worded for the visitor. */
    stopped?: string;
}

interface Failure {
    title: string;
    detail: string;
    /** A few words for the file's row. */
    reason: string;
    /** Another attempt could work: a download that dropped, a provider that was busy. */
    retryable: boolean;
    kind?: ToolErrorKind;
}

type Phase = "idle" | "model" | "translating" | "done" | "failed";

const isAbort = (error: unknown) => (error as { name?: string })?.name === "AbortError" || (error as { kind?: string })?.kind === "Aborted";

/** An error that is the provider set-up's, for the page's own refusals before anything is sent. */
function setupError(message: string): Error {
    return Object.assign(new Error(message), { name: "ByokError", kind: "BadKey", userMessage: message });
}

/** What ended a run before it translated anything, for the visitor. */
function failureFor(error: unknown, run: RunInfo): Failure {
    const e = error as { name?: string; kind?: string; userMessage?: string; message?: string; __kind?: string };
    const kind = toolErrorKind(error);
    if (e?.__kind === "bad_input") {
        return { title: "There is nothing to translate.", detail: e.message ?? "", reason: "Nothing to translate", retryable: false, kind: "bad_input" };
    }
    if (e?.name === "ByokError") {
        const busy = e.kind === "RateLimited" || e.kind === "ProviderDown";
        return {
            title: `${run.providerLabel ?? "Your AI provider"} didn’t translate the subtitles.`, detail: e.userMessage || e.message || "The provider refused the request.",
            reason: "Refused by your AI provider", retryable: busy, kind: "provider",
        };
    }
    if (e?.name === "NumberedReplyError") {
        return {
            title: "The model’s replies didn’t match the lines.",
            detail: "Its replies didn’t keep each line’s number, even in smaller batches, so nothing was translated rather than risk words landing in the wrong cue. Another model may follow the format better.",
            reason: "Replies didn’t match the lines", retryable: false, kind: "provider",
        };
    }
    if (e?.name === "EmptyTranslation") {
        return {
            title: "The model gave no translation.",
            detail: "It returned nothing for any line. Check that “From” is the language the subtitles are in, or use your own AI key.",
            reason: "No translation", retryable: false, kind: "browser",
        };
    }
    if (kind === "network" || kind === "timeout") {
        return {
            title: "The translation model couldn’t be downloaded.", detail: `It comes from Hugging Face the first time, about ${APPROX_MODEL_MB} MB for the pair. ${retryLine([kind])}`,
            reason: "The model download didn’t finish", retryable: true, kind,
        };
    }
    return {
        title: "The translation stopped in this browser.",
        detail: `Something failed while the model ran${e?.message ? ` (${e.message})` : ""}. Closing other tabs frees memory; your own AI key moves the work to your provider.`,
        reason: "Stopped in this browser", retryable: false, kind: kind === "cancelled" ? undefined : kind,
    };
}

/** Why a run stopped early, as a sentence for a partial result. */
function stoppedReason(error: unknown): string {
    const e = error as { name?: string; userMessage?: string; message?: string };
    if (e?.name === "ByokError" && e.userMessage) return e.userMessage;
    if (toolErrorKind(error) === "network") return "The connection dropped.";
    return e?.message ? `Something failed in this browser (${e.message}).` : "Something failed in this browser.";
}

export function SubtitleTranslatorUI() {
    const byok = useByok();
    const [stored, , { setField }] = useToolDefaults(SLUG, DEFAULTS);
    // A remembered value from an older version is checked before it is used.
    const settings = useMemo<Settings>(() => {
        const source = availableSources().includes(stored.source) ? stored.source : "en";
        const targets = targetsFor(source);
        return {
            engine: stored.engine === "byok" ? "byok" : "device",
            source,
            target: targets.includes(stored.target) ? stored.target : targets[0],
            byokTarget: byokTarget(stored.byokTarget) ? stored.byokTarget : DEFAULTS.byokTarget,
            byokModel: typeof stored.byokModel === "string" ? stored.byokModel : "",
        };
    }, [stored.engine, stored.source, stored.target, stored.byokTarget, stored.byokModel]);
    const [chosen, setChosen] = useState<Chosen | null>(null);
    const [phase, setPhase] = useState<Phase>("idle");
    const [modelPercent, setModelPercent] = useState(0);
    const [progress, setProgress] = useState({ done: 0, total: 0, started: 0 });
    const [result, setResult] = useState<Result | null>(null);
    const [failure, setFailure] = useState<Failure | null>(null);
    // The run in progress, which a translation of the marked cues takes from its result rather than the options.
    const [active, setActive] = useState<RunInfo | null>(null);
    const [cached, setCached] = useState<Record<string, number>>({});
    const [returning, setReturning] = useState(false);
    const runId = useRef(0);
    const readId = useRef(0);
    const abort = useRef<AbortController | null>(null);
    const busy = phase === "model" || phase === "translating";
    const ids = useId();

    const refreshCache = useCallback(() => {
        void listCachedModels().then(models => setCached(Object.fromEntries(models.map(model => [model.hfId, model.bytes]))));
    }, []);
    useEffect(() => { refreshCache(); }, [refreshCache]);
    // Leaving the page ends a run: its result would have nowhere to go.
    useEffect(() => () => { runId.current++; abort.current?.abort(); }, []);

    const setSource = useCallback((next: string) => {
        setField("source", next);
        const targets = targetsFor(next);
        if (!targets.includes(settings.target)) setField("target", targets[0]);
    }, [setField, settings.target]);

    const choose = useCallback((files: File[]) => {
        const [file] = files;
        if (!file) return;
        const id = ++readId.current;
        runId.current++;
        setResult(null);
        setFailure(null);
        setPhase("idle");
        setChosen({ file });
        readSubtitleFile(file).then(doc => {
            if (id !== readId.current) return;
            const guessed = guessLanguageFromScript(cuesOf(doc).map(cue => cue.lines.join(" ")));
            const switchedTo = guessed && guessed !== settings.source && (TO_ENGLISH as readonly string[]).includes(guessed) ? guessed : undefined;
            if (switchedTo) setSource(switchedTo);
            setChosen({ file, doc, switchedTo });
        }, (error: unknown) => {
            if (id !== readId.current) return;
            const problem = error instanceof SubtitleFileError
                ? { title: error.title, detail: error.detail, ass: error.problem === "ass" }
                : { title: `${file.name} couldn’t be read.`, detail: "This browser couldn’t open the file. Choose it again, or a copy of it.", ass: false };
            setChosen({ file, problem });
            emitToolRun({ outcome: "error", files: 1 }, error);
        });
    }, [settings.source, setSource]);

    const loadSample = () => choose([new File([SAMPLE], "sample.srt", { type: "application/x-subrip" })]);

    const startOver = () => {
        runId.current++;
        readId.current++;
        abort.current?.abort();
        setChosen(null);
        setResult(null);
        setFailure(null);
        setReturning(true);
        setPhase("idle");
    };

    const translate = useCallback(async (again?: Result) => {
        const doc = again?.doc ?? chosen?.doc;
        const file = again?.file ?? chosen?.file;
        if (!doc || !file) return;
        const run: RunInfo = again?.run ?? (settings.engine === "device"
            ? { engine: "device", source: settings.source, to: { name: languageName(settings.target), code: settings.target } }
            : {
                engine: "byok", to: byokTarget(settings.byokTarget) ?? BYOK_TARGETS[1], provider: byok.provider,
                providerLabel: providerById(byok.provider)?.label, model: settings.byokModel.trim() || providerById(byok.provider)?.models[0] || "",
            });
        const id = ++runId.current;
        const current = () => id === runId.current;
        const controller = new AbortController();
        abort.current = controller;
        const fullPlan = again?.plan ?? planTranslation(doc);
        // Again: only the lines still marked, and none the visitor has corrected since.
        const editedCues = new Set(again ? again.cues.flatMap((cue, index) => (cue.edited ? [index] : [])) : []);
        const wanted = fullPlan.items.map((_, index) => index).filter(index => {
            if (!again) return true;
            const outcome = again.outcomes[index];
            return outcome?.status !== "done" && !editedCues.has(fullPlan.items[index].cue);
        });
        const { plan, map } = subPlan(fullPlan, wanted);
        setFailure(null);
        setActive(run);
        const started = performance.now();
        const onProgress = (done: number, total: number) => { if (current()) setProgress({ done, total, started }); };
        try {
            if (!plan.items.length) {
                throw Object.assign(new Error("Nothing in this file has words to translate: its cues hold only music notes, numbers or nothing at all."), { __kind: "bad_input" });
            }
            let outcome: RunResult;
            if (run.engine === "device") {
                const modelId = modelIdFor(run.source ?? "en", run.to.code);
                if (!modelId) throw Object.assign(new Error("That pair of languages has no model on this device."), { __kind: "bad_input" });
                setModelPercent(0);
                setPhase("model");
                const translator = await loadDeviceTranslator(modelId, percent => { if (current()) setModelPercent(percent); });
                if (!current()) return;
                refreshCache();
                setProgress({ done: 0, total: plan.items.length, started: performance.now() });
                setPhase("translating");
                outcome = await translateOnDevice(plan, translator, { maxTokens: MAX_INPUT_TOKENS, signal: controller.signal, onProgress });
            } else {
                if (!run.provider || !byok.configured.includes(run.provider)) throw setupError("Add an API key first, or switch to the on-device model.");
                const apiKey = await getKey(run.provider);
                if (!apiKey) throw setupError("That saved key could not be read. Enter it again.");
                if (!current()) return;
                setProgress({ done: 0, total: plan.items.length, started: performance.now() });
                setPhase("translating");
                const provider = run.provider;
                outcome = await translateWithModel(plan, (lines, signal) => translateLinesWithByok({
                    providerId: provider, apiKey, model: run.model ?? "", baseUrl: getBaseUrl(provider), signal, targetLanguage: run.to.name, lines,
                }), { signal: controller.signal, onProgress });
            }
            if (!current()) return;
            const outcomes = again ? [...again.outcomes] : new Array<ItemOutcome | undefined>(fullPlan.items.length).fill(undefined);
            outcome.outcomes.forEach((value, k) => { if (value) outcomes[map[k]] = value; });
            const layout = layoutFor(run.to.code.split("-")[0], "two");
            const assembled = assembleCues(doc, fullPlan, outcomes, layout);
            const touched = new Set(map.map(index => fullPlan.items[index].cue));
            const cues: EditableCue[] = again
                ? again.cues.map((cue, index) => (touched.has(index) && !cue.edited ? assembled[index] : cue))
                : assembled;
            const translated = outcomes.filter(value => value?.status === "done").length;
            const seconds = (performance.now() - started) / 1000;
            if (translated === 0) {
                // Nothing came back: what stopped the run, or every batch's replies, or a model that wrote nothing.
                const cause = outcome.stoppedBy
                    ?? Object.assign(new Error("No line was translated."), { name: run.engine === "byok" ? "NumberedReplyError" : "EmptyTranslation" });
                emitToolRun({ outcome: "error", files: 1, errorKind: run.engine === "byok" ? "provider" : "browser" }, outcome.stoppedBy);
                setFailure(failureFor(cause, run));
                setPhase("failed");
                return;
            }
            const missing = cues.some(cue => cue.status === "failed" && !cue.edited);
            if (missing) emitToolRun({ outcome: "partial", files: 1, errorKind: run.engine === "byok" ? "provider" : "browser" }, outcome.stoppedBy);
            else emitToolRun({ outcome: "success", files: 1 });
            setResult({ file, doc, plan: fullPlan, outcomes, cues, run, seconds: (again?.seconds ?? 0) + seconds, stopped: outcome.stoppedBy ? stoppedReason(outcome.stoppedBy) : undefined });
            setPhase("done");
        } catch (error) {
            if (!current()) return;
            if (isAbort(error)) { setPhase(again ? "done" : "idle"); return; }
            emitToolRun({ outcome: "error", files: 1 }, error);
            setFailure(failureFor(error, run));
            if (again) setResult(again);
            setPhase("failed");
        }
    }, [chosen, settings, byok.provider, byok.configured, refreshCache]);

    const cancel = () => {
        runId.current++;
        abort.current?.abort();
        setPhase(result ? "done" : "idle");
    };

    const editCue = useCallback((index: number, text: string) => {
        setResult(current => current && { ...current, cues: current.cues.map((cue, i) => (i === index ? { ...cue, text, edited: true } : cue)) });
    }, []);

    useEffect(() => {
        const onKey = (event: KeyboardEvent) => {
            if ((event.metaKey || event.ctrlKey) && event.key === "Enter" && chosen?.doc && phase === "idle") {
                event.preventDefault();
                void translate();
            }
        };
        window.addEventListener("keydown", onKey);
        return () => window.removeEventListener("keydown", onKey);
    }, [chosen, phase, translate]);

    if (phase === "done" && result) {
        return <TranslationResult result={result} onEdit={editCue} onAgain={() => void translate(result)} onStartOver={startOver}
            onSettings={() => { setResult(null); setPhase("idle"); }} />;
    }
    if (phase === "failed" && failure) {
        const back = () => { setFailure(null); setPhase(result ? "done" : "idle"); };
        return <StudioResult tone="failure" title={failure.title} detail={failure.detail}>
            {chosen && <StudioFile name={chosen.file.name} status="error" detail={failure.reason} />}
            <StudioActions tone="failure" retryCount={failure.retryable ? 1 : 0} onRetry={() => void translate(result ?? undefined)}
                choose={{ accepts: ACCEPTS, label: "Choose a different file", onFiles: choose }}
                more={<button type="button" className="ts-text-button" onClick={back}>{result ? "Back to the translation" : "Change the translator or languages"}</button>} />
        </StudioResult>;
    }

    const doc = chosen?.doc;
    const cueCount = doc ? cuesOf(doc).length : 0;
    const modelId = modelIdFor(settings.source, settings.target);
    const modelBytes = modelId ? cached[modelId] : undefined;
    const ready = !!doc && (settings.engine === "device" ? !!modelId : byok.ready);
    const pairNote = settings.source === "en"
        ? `On this device English translates into ${FROM_ENGLISH.length} languages, and ${TO_ENGLISH.length} languages into English: each model works one way.`
        : `On this device ${languageName(settings.source)} translates into English only: each model works one way. For ${languageName(settings.source)} into another language, use your own AI key, which takes any pair.`;
    const eta = progress.done > 0 && progress.total > progress.done
        ? ((performance.now() - progress.started) / 1000) * ((progress.total - progress.done) / progress.done) : null;
    const where = active?.engine === "byok" ? `with your ${active.providerLabel ?? "AI"} key.` : "on this device. Keep this tab open.";

    return <StudioLayout className="st-studio" options={<>
        <div>
            <h2>Translator</h2>
            <div className="ts-choices">
                <button type="button" className="ts-choice" aria-pressed={settings.engine === "device"} disabled={busy} onClick={() => setField("engine", "device")}>
                    <strong>On this device</strong>
                    <span>Free, no key. A model for each language pair downloads once, about {APPROX_MODEL_MB} MB. English into {FROM_ENGLISH.length} languages, or {TO_ENGLISH.length} into English.</span>
                </button>
                <button type="button" className="ts-choice" aria-pressed={settings.engine === "byok"} disabled={busy} onClick={() => setField("engine", "byok")}>
                    <strong>Your own AI key</strong>
                    <span>Any pair of languages, with the dialogue around each line as context. Billed by your provider; the text goes to them, not to PrivaTools.</span>
                </button>
            </div>
        </div>
        <div>
            <h2>Languages</h2>
            {settings.engine === "device" ? <>
                <div className="st-fields">
                    <div className="ts-setting">
                        <label htmlFor={`${ids}-from`}>From</label>
                        <select id={`${ids}-from`} value={settings.source} disabled={busy} onChange={event => setSource(event.target.value)}>
                            {availableSources().map(code => <option key={code} value={code}>{languageName(code)}</option>)}
                        </select>
                    </div>
                    <div className="ts-setting">
                        <label htmlFor={`${ids}-to`}>Into</label>
                        <select id={`${ids}-to`} value={settings.target} disabled={busy} onChange={event => setField("target", event.target.value)}>
                            {targetsFor(settings.source).map(code => <option key={code} value={code}>{languageName(code)}</option>)}
                        </select>
                    </div>
                </div>
                <p className="st-hint">{pairNote}{settings.source !== "en" && <> <button type="button" className="st-link" disabled={busy} onClick={() => setField("engine", "byok")}>Use my own AI key</button></>}</p>
                <p className="st-hint">{modelBytes
                    ? `The ${languageName(settings.source)} → ${languageName(settings.target)} model is in this browser (${formatBytes(modelBytes)}).`
                    : `The ${languageName(settings.source)} → ${languageName(settings.target)} model downloads from Hugging Face on the first run, about ${APPROX_MODEL_MB} MB, and your browser keeps it.`}</p>
            </> : <>
                <div className="st-fields">
                    <div className="ts-setting">
                        <label htmlFor={`${ids}-into`}>Translate into</label>
                        <select id={`${ids}-into`} value={settings.byokTarget} disabled={busy} onChange={event => setField("byokTarget", event.target.value)}>
                            {BYOK_TARGETS.map(language => <option key={language.code} value={language.name}>{language.name}</option>)}
                        </select>
                    </div>
                    <div className="ts-setting">
                        <label htmlFor={`${ids}-model`}>Model (optional)</label>
                        <input id={`${ids}-model`} type="text" value={settings.byokModel} disabled={busy} spellCheck={false} autoComplete="off"
                            placeholder={providerById(byok.provider)?.models[0] ?? "provider default"} onChange={event => setField("byokModel", event.target.value)} />
                    </div>
                </div>
                <p className="st-hint">The model works out which language the subtitles are in.</p>
            </>}
        </div>
    </>} action={<StudioActionBar ready={!!doc} count={doc ? plural(cueCount, "cue") : undefined}>
        <button type="button" className="ts-primary-button" onClick={() => void translate()} disabled={!ready || busy}>
            <Languages size={16} aria-hidden="true" /> Translate
        </button>
    </StudioActionBar>}>
        {!chosen
            ? <>
                <FileIntake accepts={ACCEPTS} title="Choose a subtitle file" autoFocus={returning} onFiles={choose} disabled={busy}
                    detail={`SRT or VTT · read on this device · numbers and timings kept`} />
                <button type="button" className="ts-text-button st-sample" onClick={loadSample}><Sparkles size={15} aria-hidden="true" /> Try a sample</button>
            </>
            : <section aria-label="Chosen file" className="st-chosen">
                <StudioFile name={chosen.file.name} status={chosen.problem ? "error" : undefined}
                    detail={chosen.problem ? `${formatFileSize(chosen.file.size)} · can’t be translated` : doc
                        ? `${formatFileSize(chosen.file.size)} · ${FORMAT_NAME[doc.format]} · ${plural(cueCount, "cue")}${doc.encoding !== "UTF-8" ? ` · ${doc.encoding}` : ""} · read on this device`
                        : `${formatFileSize(chosen.file.size)} · reading…`}
                    onRemove={busy ? undefined : startOver} removeLabel={`Remove ${chosen.file.name}`} />
                {chosen.problem && <div className="ts-error" role="alert">
                    <p><strong>{chosen.problem.title}</strong> {chosen.problem.detail}{chosen.problem.ass && <> <a href="/tools/subtitle-converter">Open Subtitle Converter</a>.</>}</p>
                </div>}
                {chosen.switchedTo && settings.engine === "device" && <p className="st-hint">Its letters are {languageName(chosen.switchedTo)}, so it will be translated from {languageName(chosen.switchedTo)}. Change “From” if that’s wrong.</p>}
                {doc && !busy && <FirstCues doc={doc} />}
            </section>}
        {settings.engine === "byok" && <details className="st-provider" open={!byok.ready}>
            <summary><span>Your AI key</span><strong>{byok.ready ? providerById(byok.provider)?.label ?? "Key saved" : "Choose your provider and key"}</strong></summary>
            <ByokPanel byok={byok} purpose="The subtitles’ text is sent from this browser to the provider you choose, with your key, in numbered batches. It never passes through PrivaTools." />
        </details>}
        {/* One progress element through both steps, so its Cancel is the same button when the model has loaded. */}
        {busy && <StudioProgress onCancel={cancel}
            label={phase === "model" ? (modelBytes ? "Loading the translation model" : "Downloading the translation model") : "Translating your subtitles"}
            progress={phase === "model" ? modelPercent : progress.total ? (progress.done / progress.total) * 100 : undefined}
            detail={phase === "model"
                ? (modelBytes ? "From this browser’s storage." : `About ${APPROX_MODEL_MB} MB from Hugging Face, once. Your subtitles stay here.`)
                : `${n(progress.done)} of ${plural(progress.total, "line")}${eta !== null ? ` · about ${Math.max(1, Math.round(eta / 60))} min left at this speed` : ""} · ${where}`} />}
        {!busy && doc && settings.engine === "device" && !modelId && <p className="ts-note">This pair has no model on this device.</p>}
    </StudioLayout>;
}

/** The file's first cues as read, to check it is the right file, in the language chosen, before a model downloads. */
function FirstCues({ doc }: { doc: SubtitleDocument }) {
    const cues = cuesOf(doc);
    const hours = cues.some(cue => cue.end >= 3600);
    const shown = cues.slice(0, 5);
    return <figure className="st-peek">
        <figcaption>The first {shown.length === 1 ? "cue" : `${shown.length} cues`}, as read</figcaption>
        <ol>{shown.map((cue, index) => <li key={index}>
            <span className="st-cue-time">{cueClock(cue.start, hours)}</span>
            <span dir="auto">{cue.lines.join("\n")}</span>
        </li>)}</ol>
        {cues.length > shown.length && <p className="st-hint">and {plural(cues.length - shown.length, "more cue")}.</p>}
    </figure>;
}

/* ── The result ──────────────────────────────────────────────────────── */

function TranslationResult({ result, onEdit, onAgain, onStartOver, onSettings }: {
    result: Result; onEdit: (index: number, text: string) => void; onAgain: () => void; onStartOver: () => void; onSettings: () => void;
}) {
    const { doc, cues, run, file } = result;
    const ownFormat = doc.format;
    const otherFormat: SubtitleFormat = ownFormat === "srt" ? "vtt" : "srt";
    const total = cues.length;
    const failed = cues.filter(cue => cue.status === "failed" && !cue.edited).length;
    const kept = cues.filter(cue => cue.status === "kept").length;
    const translated = total - failed - kept;
    const dropped = cues.reduce((sum, cue) => sum + (cue.edited ? 0 : cue.dropped), 0);
    const long = cues.filter(cue => cue.long && !cue.edited).length;
    const check = cues.filter(cue => cue.check && !cue.edited).length;
    const lineLength = layoutFor(run.to.code.split("-")[0], "two").maxLineChars;
    // What the other format leaves out, for the line under the downloads: the same count writeSubtitles
    // makes, kept per cue text, so a correction recounts one cue rather than the file.
    const tagCounts = useRef(new Map<string, number>());
    const conversion = useMemo(() => {
        let tags = 0;
        for (const cue of cues) {
            let count = tagCounts.current.get(cue.text);
            if (count === undefined) {
                count = convertCueMarkup(cue.text, ownFormat, otherFormat).dropped;
                tagCounts.current.set(cue.text, count);
            }
            tags += count;
        }
        return { tags, settings: cuesOf(doc).filter(cue => cue.settings).length, blocks: doc.blocks.length - cues.length };
    }, [cues, doc, ownFormat, otherFormat]);
    const [handing, setHanding] = useState(false);

    const save = (format: SubtitleFormat) => {
        const { text } = exportSubtitles(doc, cues, format, run.to.code);
        downloadBlob(new Blob([text], { type: format === "srt" ? "application/x-subrip;charset=utf-8" : "text/vtt;charset=utf-8" }), translatedFileName(file.name, run.to.code, format));
    };
    const burnIn = async () => {
        setHanding(true);
        try {
            const { text } = exportSubtitles(doc, cues, "srt", run.to.code);
            await storeFileHandoff(new File([text], translatedFileName(file.name, run.to.code, "srt"), { type: "application/x-subrip" }), "add-subtitles");
        } finally {
            // Add Subtitles opens in this page, which still holds the file; if storing failed, the downloaded SRT can be chosen there.
            navigateTo("/tools/add-subtitles");
        }
    };

    const by = run.engine === "device"
        ? `from ${languageName(run.source ?? "en")} into ${run.to.name}, on this device`
        : `into ${run.to.name}, with your ${run.providerLabel ?? "AI"} key`;
    const title = failed ? `${n(translated)} of ${plural(translated + failed, "cue")} translated.` : `${plural(translated, "cue")} translated.`;
    const detail = [
        `Machine translation ${by}. Read it beside the original before you use it; correct any line below.`,
        result.stopped ? `The translation stopped before the end: ${result.stopped}` : "",
        failed ? `${plural(failed, "cue")} ${failed === 1 ? "wasn’t" : "weren’t"} translated and keep${failed === 1 ? "s" : ""} the original text; ${failed === 1 ? "it’s" : "they’re"} marked below.` : "",
    ].filter(Boolean).join(" ");
    const notes = [
        check ? `${plural(check, "cue")} came out much longer than the original, which is how the model looks when it invents words: read ${check === 1 ? "it" : "them"} first.` : "",
        long ? `${plural(long, "cue")} run${long === 1 ? "s" : ""} past two lines of ${lineLength} characters; the timing stays as it was, so you may want to shorten ${long === 1 ? "it" : "them"}.` : "",
        dropped ? `${plural(dropped, "formatting span")} inside the words (such as one word in italics) couldn’t be carried and ${dropped === 1 ? "was" : "were"} left out.` : "",
    ].filter(Boolean);
    const conversionNote = [
        conversion.settings ? plural(conversion.settings, ownFormat === "vtt" ? "cue setting" : "position") : "",
        conversion.blocks ? plural(conversion.blocks, "NOTE, STYLE or REGION block", "NOTE, STYLE or REGION blocks") : "",
        conversion.tags ? plural(conversion.tags, ownFormat === "vtt" ? "voice or class span" : "colour or position tag") : "",
    ].filter(Boolean);

    return <StudioResult tone={failed ? "partial" : "success"} title={title} detail={detail}>
        <dl className="ts-stats">
            <div><dt>Translated</dt><dd>{n(translated)}</dd></div>
            {failed > 0 && <div><dt>Not translated</dt><dd>{n(failed)}</dd></div>}
            <div><dt>Into</dt><dd>{run.to.name}</dd></div>
            <div><dt>Took</dt><dd>{result.seconds < 60 ? `${Math.max(1, Math.round(result.seconds))} s` : `${Math.round(result.seconds / 60)} min`}</dd></div>
        </dl>
        {notes.length > 0 && <div className="ts-note">{notes.map(note => <p key={note}>{note}</p>)}</div>}
        <CueEditor result={result} onEdit={onEdit} />
        <div className="ts-actions">
            <button type="button" className="ts-primary-button" onClick={() => save(ownFormat)}><Download size={16} aria-hidden="true" /> Download {FORMAT_NAME[ownFormat]}</button>
            <button type="button" className="ts-secondary-button" onClick={() => save(otherFormat)}><Download size={16} aria-hidden="true" /> Download {FORMAT_NAME[otherFormat]}</button>
            {failed > 0 && <button type="button" className="ts-secondary-button" onClick={onAgain}><RotateCcw size={16} aria-hidden="true" /> Translate the {plural(failed, "marked cue")} again</button>}
            <button type="button" className="ts-text-button" onClick={onSettings}>Change the languages</button>
            <button type="button" className="ts-text-button" onClick={onStartOver}>Translate another file</button>
        </div>
        <p className="ts-caption st-saves">
            Saves {translatedFileName(file.name, run.to.code, ownFormat)} or {translatedFileName(file.name, run.to.code, otherFormat)}, with every cue’s {ownFormat === "srt" ? "number" : "identifier"} and timing as they were.
            {failed > 0 && (failed === 1 ? " In both, the cue that wasn’t translated keeps its original text." : ` In both, the ${n(failed)} cues that weren’t translated keep their original text.`)}
            {conversionNote.length > 0 && ` As ${FORMAT_NAME[otherFormat]}, the file leaves out what ${FORMAT_NAME[otherFormat]} can’t hold: ${conversionNote.join(", ")}.`}
        </p>
        {NO_SERVER_FONT.has(run.to.code.split("-")[0])
            ? <p className="ts-caption st-next">Add Subtitles can’t burn {run.to.name} into a video: it draws subtitles with the DejaVu fonts on the PrivaTools server, which have no {run.to.name} letters, so they would come out as boxes. Load the SRT or VTT in your video player or editor instead.</p>
            : <div className="st-next">
                <button type="button" className="ts-secondary-button" onClick={() => void burnIn()} disabled={handing}><Film size={16} aria-hidden="true" /> Burn into a video</button>
                <p className="ts-caption">Add Subtitles burns the translated SRT into your video on the PrivaTools server, which means uploading the video and the subtitles for temporary processing. The translation itself stays on this page until then.</p>
            </div>}
    </StudioResult>;
}

/** "00:01:02.5", with hours only when the file has them. */
function cueClock(seconds: number, hours: boolean): string {
    const time = formatTime(seconds, "vtt");
    return (hours ? time : time.slice(3)).slice(0, -2);
}

function marksOf(cue: EditableCue, lineLength: number): { kind: string; label: string }[] {
    if (cue.edited) return [];
    const marks: { kind: string; label: string }[] = [];
    if (cue.status === "failed") marks.push({ kind: "failed", label: "Not translated" });
    if (cue.check) marks.push({ kind: "check", label: "Much longer than the original" });
    if (cue.repeated) marks.push({ kind: "note", label: "Repeats the line before" });
    if (cue.long) marks.push({ kind: "note", label: `Over two lines of ${lineLength}` });
    return marks;
}

/** How long typing pauses before a correction reaches the result (and its counts); leaving the box sends it at once. */
const COMMIT_AFTER_MS = 400;

/**
 * One cue. The box keeps its own draft while the visitor types, so a long
 * file's thousands of rows are not drawn again on every key; the correction
 * reaches the result when typing pauses, when the box loses focus (as it
 * does before any button is pressed), or when the row goes.
 */
const CueRow = memo(function CueRow({ index, cue, label, from, to, sourceLang, targetLang, lineLength, onText }: {
    index: number; cue: EditableCue; label: string; from: string; to: string; sourceLang?: string; targetLang: string; lineLength: number;
    onText: (index: number, text: string) => void;
}) {
    const [draft, setDraft] = useState(cue.text);
    const committed = useRef(cue.text);
    const latest = useRef(cue.text);
    const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
    const commit = useCallback(() => {
        clearTimeout(timer.current);
        if (latest.current !== committed.current) {
            committed.current = latest.current;
            onText(index, latest.current);
        }
    }, [index, onText]);
    // A new text from outside, such as the marked cues translated again, replaces the draft.
    useEffect(() => {
        if (cue.text !== committed.current) {
            committed.current = cue.text;
            latest.current = cue.text;
            setDraft(cue.text);
        }
    }, [cue.text]);
    useEffect(() => commit, [commit]);
    const marks = marksOf(cue, lineLength);
    const rows = Math.min(4, Math.max(2, draft.split("\n").length));
    return <li className="st-cue" data-status={cue.edited ? "edited" : cue.status} data-marked={marks.length > 0 || undefined}>
        <div className="st-cue-meta">
            <span className="st-cue-number">{label}</span>
            <span className="st-cue-time">{from} – {to}</span>
            {marks.map(mark => <span key={mark.kind + mark.label} className="st-mark" data-kind={mark.kind}>{mark.label}</span>)}
        </div>
        <p className="st-cue-source" lang={sourceLang} dir="auto">{cue.source}</p>
        <textarea dir="auto" lang={targetLang} rows={rows} value={draft} spellCheck
            aria-label={`Translation of cue ${label}, ${from} to ${to}`} onBlur={commit}
            onChange={event => {
                latest.current = event.target.value;
                setDraft(event.target.value);
                clearTimeout(timer.current);
                timer.current = setTimeout(commit, COMMIT_AFTER_MS);
            }} />
        {cue.status === "failed" && !cue.edited && cue.reason && <p className="st-cue-reason">{cue.reason}</p>}
    </li>;
});

/**
 * Cues a page of the check holds. Each row is a text box, and a page of
 * thousands made every key a long task (about 200 ms a key at 10,000 cues on
 * a two-core test machine, against under 60 ms at this size).
 */
const PAGE_SIZE = 500;

/** Every cue: its original beside its translation, to read and correct, a page at a time. */
function CueEditor({ result, onEdit }: { result: Result; onEdit: (index: number, text: string) => void }) {
    const { doc, cues, run } = result;
    const timings = cuesOf(doc);
    const hours = timings.some(cue => cue.end >= 3600);
    const lineLength = layoutFor(run.to.code.split("-")[0], "two").maxLineChars;
    // The cues marked when "only marked" was turned on: a cue corrected since stays in view while it is worked on.
    const [onlyMarked, setOnlyMarked] = useState<number[] | null>(null);
    const [page, setPage] = useState(0);
    const list = useRef<HTMLOListElement>(null);
    const marked = useMemo(() => cues.flatMap((cue, index) => (marksOf(cue, lineLength).length > 0 ? [index] : [])), [cues, lineLength]);
    // The indexes shown, in order: every cue, or the marked ones; then this page of them.
    const filtered = onlyMarked?.length ? onlyMarked : null;
    const total = filtered ? filtered.length : cues.length;
    const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
    const at = Math.min(page, pages - 1);
    const first = at * PAGE_SIZE;
    const shown: number[] = [];
    for (let k = first; k < Math.min(total, first + PAGE_SIZE); k++) shown.push(filtered ? filtered[k] : k);
    const turn = (next: number) => { setPage(next); if (list.current) list.current.scrollTop = 0; };
    const pager = pages > 1 && <nav className="st-pager" aria-label="Pages of cues">
        <button type="button" className="ts-secondary-button" disabled={at === 0} onClick={() => turn(at - 1)}>Previous {n(PAGE_SIZE)}</button>
        <span aria-live="polite">{filtered ? "Marked cues" : "Cues"} {n(first + 1)}–{n(first + shown.length)} of {n(total)}</span>
        <button type="button" className="ts-secondary-button" disabled={at >= pages - 1} onClick={() => turn(at + 1)}>Next {n(Math.min(PAGE_SIZE, total - first - shown.length))}</button>
    </nav>;
    return <section className="st-editor" aria-labelledby="st-editor-title">
        <div className="st-editor-head">
            <h3 id="st-editor-title">Check the translation <span className="st-badge">Machine translation</span></h3>
            <p>Each cue’s original is beside its translation. Correct any of them: a line break you type stays in the file, and the timing never changes.</p>
            {(marked.length > 0 || onlyMarked) && <label className="ts-check"><input type="checkbox" checked={!!onlyMarked} onChange={event => { setOnlyMarked(event.target.checked ? marked : null); setPage(0); }} />
                <span>Show only the {plural(onlyMarked ? onlyMarked.length : marked.length, "marked cue")}</span></label>}
        </div>
        {pager}
        <div className="st-columns" aria-hidden="true"><span>Original</span><span>{run.to.name}</span></div>
        <ol className="st-cues" aria-label="Cues" ref={list}>
            {shown.map(index => <CueRow key={index} index={index} cue={cues[index]} label={timings[index].id?.trim() || String(index + 1)}
                from={cueClock(timings[index].start, hours)} to={cueClock(timings[index].end, hours)}
                sourceLang={run.source} targetLang={run.to.code} lineLength={lineLength} onText={onEdit} />)}
        </ol>
    </section>;
}
