/**
 * AiTokenCounterUI — how many tokens a text or a file uses for current AI models.
 *
 * GPT counts are exact and made in this tab with gpt-tokenizer (o200k_base
 * and cl100k_base). Claude and Gemini have no tokenizer this page can run, so
 * their counts come only from the providers' own count methods, with the
 * visitor's key, when the visitor ticks that provider and presses Count: the
 * text then goes from this browser straight to the provider (lib/byok's
 * countTokens). Without a key the page shows no Claude or Gemini number at
 * all, rather than a guess. Files are read here (lib/tokens/extract.ts);
 * nothing is uploaded to PrivaTools. Prices are entered by the visitor:
 * there is no built-in price table to go stale.
 */
import { useCallback, useDeferredValue, useEffect, useId, useMemo, useRef, useState } from "react";
import { Check, Copy, Download, Eye, EyeOff, Hash } from "lucide-react";
import { buildOutputFilename, downloadBlob, formatFileSize, withErrorKind } from "@/lib/api";
import { emitToolRun, isTransientFailure, toolErrorKind, type ToolErrorKind } from "@/lib/toolRun";
import { countTokens } from "@/lib/byok/client";
import { ByokError } from "@/lib/byok/errors";
import { clearKey, getKey, isSessionOnly, listConfigured, saveKey, setSessionOnly } from "@/lib/byok/keyStore";
import { providerById } from "@/lib/byok/providers";
import { GPT_ENCODINGS, countGptTokens, gptEncoding, loadGptEncoder, modelList, type GptEncodingId } from "@/lib/tokens/gpt";
import { ACCEPTS, ReadError, checkTextLength, readFileText, type FileText, type ReadFailure } from "@/lib/tokens/extract";
import { MAX_CHUNK_TOKENS, MIN_CHUNK_TOKENS, TooManyChunksError, chunkPreview, chunksAsText, splitIntoChunks, validChunkSize, type Chunk } from "@/lib/tokens/split";
import { costFor, formatCost, parseAmount } from "@/lib/tokens/cost";
import { FileIntake, StudioActionBar, StudioActions, StudioFile, StudioLayout, StudioProgress, StudioResult } from "@/skins/experience/ToolStudio";
import { focusIfIdle } from "@/skins/experience/focus-result";
import { retryLine } from "@/skins/experience/studio-outcome";
import { fileCount } from "@/skins/experience/file-format-label";
import "./ai-token-counter.css";

type ProviderId = "anthropic" | "gemini";

/** The providers with a count method of their own, as the page names them. */
const PROVIDERS: ReadonlyArray<{ id: ProviderId; family: string; company: string; keyLabel: string }> = [
    { id: "anthropic", family: "Claude", company: "Anthropic", keyLabel: "Anthropic API key" },
    { id: "gemini", family: "Gemini", company: "Google", keyLabel: "Google AI Studio API key" },
];

const n = (value: number) => value.toLocaleString("en-US");
const plural = (count: number, one: string, many = `${one}s`) => `${n(count)} ${count === 1 ? one : many}`;

/** Characters as people count them (code points, so an emoji is one), and words between spaces. */
function textStats(text: string): { characters: number; words: number } {
    let characters = 0;
    for (let i = 0; i < text.length; i++) {
        const code = text.charCodeAt(i);
        if (code < 0xdc00 || code > 0xdfff) characters++;
    }
    let words = 0;
    const word = /\S+/g;
    while (word.exec(text)) words++;
    return { characters, words };
}

type ProviderOutcome =
    | { id: ProviderId; status: "counted"; model: string; tokens: number }
    | { id: ProviderId; status: "failed"; model: string; message: string }
    | { id: ProviderId; status: "not-asked" | "no-key" };

interface CountResult {
    source: { kind: "paste" } | (Omit<FileText, "text"> & { name: string });
    characters: number;
    words: number;
    gpt: Record<GptEncodingId, number>;
    providers: ProviderOutcome[];
    split?: { encoding: GptEncodingId; maxTokens: number; chunks: Chunk[] } | { error: string };
}

interface Failure { message: string; code?: ReadFailure; retryable: boolean; kind?: ToolErrorKind }

type Phase = "idle" | "running" | "done" | "failed";

/** Which providers have a key saved in this browser, and the controls ByokPanel offers for them. */
function useSavedKeys() {
    const [saved, setSaved] = useState<string[]>([]);
    const [sessionOnly, setSessionOnlyState] = useState(isSessionOnly);
    const refresh = useCallback(async () => {
        try { setSaved(await listConfigured()); } catch { setSaved([]); }
    }, []);
    useEffect(() => {
        let alive = true;
        listConfigured().then(list => { if (alive) setSaved(list); }).catch(() => {});
        return () => { alive = false; };
    }, []);
    return {
        saved,
        sessionOnly,
        save: async (id: ProviderId, key: string) => { await saveKey(id, key); await refresh(); },
        remove: async (id: ProviderId) => { await clearKey(id); await refresh(); },
        setSession: async (on: boolean) => { await setSessionOnly(on); setSessionOnlyState(on); await refresh(); },
    };
}

export function AiTokenCounterUI() {
    const [file, setFile] = useState<File | null>(null);
    const [text, setText] = useState("");
    const [phase, setPhase] = useState<Phase>("idle");
    const [step, setStep] = useState<{ label: string; detail?: string; progress?: number }>({ label: "" });
    const [result, setResult] = useState<CountResult | null>(null);
    const [failure, setFailure] = useState<Failure | null>(null);
    const keys = useSavedKeys();
    const [asked, setAsked] = useState<Record<ProviderId, boolean>>({ anthropic: false, gemini: false });
    const [models, setModels] = useState<Record<ProviderId, string>>({
        anthropic: providerById("anthropic")?.models[0] ?? "",
        gemini: providerById("gemini")?.models[0] ?? "",
    });
    const [split, setSplit] = useState(false);
    const [chunkSize, setChunkSize] = useState("1000");
    const [chunkEncoding, setChunkEncoding] = useState<GptEncodingId>("o200k_base");
    // Back from a result: focus returns to the text or the count button, never from elsewhere.
    const [returning, setReturning] = useState(false);
    const abort = useRef<AbortController | null>(null);
    const textBox = useRef<HTMLTextAreaElement>(null);
    const runButton = useRef<HTMLButtonElement>(null);
    const ids = useId();

    // The live figures under the box follow the text a moment behind, so typing in a long paste stays quick.
    const shownText = useDeferredValue(text);
    const stats = useMemo(() => textStats(shownText), [shownText]);
    const chunkTokens = Number(chunkSize);
    const chunkSizeOk = !split || validChunkSize(chunkTokens);
    const hasInput = Boolean(file) || /\S/.test(text);
    const busy = phase === "running";
    // A ticked provider needs a model to count for.
    const modelsOk = PROVIDERS.every(({ id }) => !asked[id] || !keys.saved.includes(id) || models[id].trim().length > 0);
    const canCount = hasInput && !busy && chunkSizeOk && modelsOk;

    useEffect(() => () => abort.current?.abort(), []);
    useEffect(() => {
        if (!returning || phase !== "idle") return;
        setReturning(false);
        focusIfIdle(file ? runButton.current : textBox.current);
    }, [returning, phase, file]);

    const count = useCallback(async () => {
        if (!canCount) return;
        const controller = new AbortController();
        abort.current = controller;
        const { signal } = controller;
        setPhase("running");
        setFailure(null);
        setResult(null);
        try {
            let input: string;
            let source: CountResult["source"];
            if (file) {
                const label = `Reading ${file.name} on this device`;
                setStep({ label });
                const read = await readFileText(file, { signal, onProgress: (page, pages) => setStep({ label, detail: `Page ${n(page)} of ${n(pages)}`, progress: (page / pages) * 100 }) });
                input = read.text;
                const { text: _text, ...rest } = read;
                source = { ...rest, name: file.name };
                if (!input.trim()) throw new ReadError("empty", `${file.name} has no text to count.`);
            } else {
                input = text;
                source = { kind: "paste" };
                checkTextLength(input);
            }

            const counting = "Counting GPT tokens on this device";
            setStep({ label: counting, detail: "Loading the tokenizers" });
            const encoders = await Promise.all(GPT_ENCODINGS.map(encoding => loadGptEncoder(encoding.id)));
            const gpt = {} as Record<GptEncodingId, number>;
            for (const [index, encoding] of GPT_ENCODINGS.entries()) {
                gpt[encoding.id] = await countGptTokens(input, encoders[index], {
                    signal,
                    onProgress: (done, total) => setStep({ label: counting, detail: encoding.id, progress: ((index + (total ? done / total : 1)) / GPT_ENCODINGS.length) * 100 }),
                });
            }

            // Only a provider the visitor ticked, with a key saved, is asked; nothing else leaves this browser.
            const asking = PROVIDERS.filter(({ id }) => asked[id] && keys.saved.includes(id) && models[id].trim().length > 0);
            if (asking.length) {
                setStep({
                    label: asking.length > 1 ? "Asking Anthropic and Google for their counts" : `Asking ${asking[0].company} for its count`,
                    detail: "The text goes from this browser straight to them, with your key.",
                });
            }
            let firstProviderFailure: unknown;
            const providers = await Promise.all(PROVIDERS.map(async ({ id, company }): Promise<ProviderOutcome> => {
                if (!asking.some(provider => provider.id === id)) return { id, status: keys.saved.includes(id) ? "not-asked" : "no-key" };
                const model = models[id].trim();
                try {
                    const apiKey = await getKey(id);
                    if (!apiKey) return { id, status: "no-key" };
                    return { id, status: "counted", model, tokens: await countTokens({ providerId: id, apiKey, model, text: input, signal }) };
                } catch (error) {
                    if (signal.aborted) throw error;
                    firstProviderFailure ??= error;
                    return { id, status: "failed", model, message: error instanceof ByokError ? error.userMessage : `The ${company} count didn’t run: the saved key couldn’t be read in this browser. Save the key again.` };
                }
            }));

            let splitResult: CountResult["split"];
            let splitFailure: unknown;
            if (split) {
                const label = "Splitting into chunks";
                setStep({ label, detail: chunkEncoding });
                const encoder = encoders[GPT_ENCODINGS.findIndex(encoding => encoding.id === chunkEncoding)];
                try {
                    const chunks = await splitIntoChunks(input, chunkTokens, encoder, { signal, onProgress: (done, total) => setStep({ label, detail: chunkEncoding, progress: total ? (done / total) * 100 : 100 }) });
                    splitResult = { encoding: chunkEncoding, maxTokens: chunkTokens, chunks };
                } catch (error) {
                    if (signal.aborted) throw error;
                    splitFailure = error instanceof TooManyChunksError ? withErrorKind(error, "bad_input") : error;
                    splitResult = { error: error instanceof TooManyChunksError ? error.message : "The text couldn’t be split. The counts above are complete." };
                }
            }

            setResult({ source, ...textStats(input), gpt, providers, split: splitResult });
            setPhase("done");
            const cause = firstProviderFailure ?? splitFailure;
            emitToolRun({ outcome: cause ? "partial" : "success", ...(file ? { files: 1 } : {}) }, cause);
        } catch (error) {
            if (signal.aborted || (error as Error)?.name === "AbortError") {
                // A cancel is not a failure: back to the form, nothing reported.
                setPhase("idle");
                return;
            }
            const kind = toolErrorKind(error);
            setFailure({
                message: error instanceof ReadError ? error.message : messageFor(error),
                code: error instanceof ReadError ? error.code : undefined,
                retryable: isTransientFailure(error),
                kind: kind === "cancelled" ? undefined : kind,
            });
            setPhase("failed");
            emitToolRun({ outcome: "error", ...(file ? { files: 1 } : {}) }, error);
        } finally {
            if (abort.current === controller) abort.current = null;
        }
    }, [canCount, file, text, asked, keys.saved, models, split, chunkEncoding, chunkTokens]);

    useEffect(() => {
        const onKey = (event: KeyboardEvent) => {
            if ((event.metaKey || event.ctrlKey) && event.key === "Enter" && phase === "idle" && canCount) {
                event.preventDefault();
                void count();
            }
        };
        window.addEventListener("keydown", onKey);
        return () => window.removeEventListener("keydown", onKey);
    }, [phase, canCount, count]);

    const backToForm = () => { setResult(null); setFailure(null); setReturning(true); setPhase("idle"); };
    const startOver = () => { setFile(null); setText(""); backToForm(); };
    const choose = (files: File[]) => { if (files[0]) { setFile(files[0]); setFailure(null); } };

    if (phase === "done" && result) {
        return <CountResultView result={result} file={file} onEdit={backToForm} onStartOver={startOver} />;
    }

    if (phase === "failed" && failure) {
        return <StudioResult tone="failure" title={file ? "This file couldn’t be counted." : "This text couldn’t be counted."}
            detail={failure.retryable ? `Nothing was counted. ${retryLine([failure.kind])}` : "Nothing was counted. The reason is below."}>
            {file ? <StudioFile name={file.name} status="error" detail={failure.message} /> : <p className="ts-error">{failure.message}</p>}
            {failure.code === "pdf-no-text" && <p className="ts-note"><a href="/tool/ocr-pdf">OCR PDF</a> adds a text layer to a scanned PDF; then count the PDF it makes.</p>}
            {failure.code === "pdf-password" && <p className="ts-note"><a href="/tool/unlock-pdf">Unlock PDF</a> removes a password you know. It uploads the PDF to PrivaTools for temporary processing.</p>}
            <StudioActions tone="failure" retryCount={failure.retryable ? 1 : 0} onRetry={() => void count()}
                choose={{ accepts: ACCEPTS, label: file ? "Choose a different file" : "Choose a file", onFiles: files => { choose(files); backToForm(); } }}
                more={<button type="button" className="ts-text-button" onClick={backToForm}>{file ? "Back to the form" : "Back to the text"}</button>} />
        </StudioResult>;
    }

    const chunkSizeId = `${ids}-chunk-size`;
    const chunkEncodingId = `${ids}-chunk-encoding`;
    return <StudioLayout className="atc-studio" options={<>
        <div className="atc-options-group">
            <h2>Claude and Gemini</h2>
            <p>GPT is counted exactly on this device. Claude and Gemini have no tokenizer this page can run, so their counts come from Anthropic and Google, with your own key, when you choose.</p>
            {PROVIDERS.map(provider => <ProviderCount key={provider.id} provider={provider} busy={busy}
                saved={keys.saved.includes(provider.id)} asked={asked[provider.id]} model={models[provider.id]}
                onAsk={on => setAsked(current => ({ ...current, [provider.id]: on }))}
                onModel={model => setModels(current => ({ ...current, [provider.id]: model }))}
                onSave={async key => { await keys.save(provider.id, key); setAsked(current => ({ ...current, [provider.id]: true })); }}
                onRemove={async () => { await keys.remove(provider.id); setAsked(current => ({ ...current, [provider.id]: false })); }} />)}
            <p className="ts-caption">Your key and the text go straight from this browser to the provider, never through PrivaTools, and its terms apply. Saved keys are encrypted on this device, but someone with access to this browser profile could recover them.</p>
            <SessionOnly on={keys.sessionOnly} busy={busy} onChange={keys.setSession} />
        </div>
        <div className="atc-options-group">
            <h2>Split into chunks</h2>
            <label className="ts-check"><input type="checkbox" checked={split} disabled={busy} onChange={event => setSplit(event.target.checked)} />
                <span>Split the text into chunks of GPT tokens</span></label>
            {split && <div className="atc-split-fields">
                <div className="ts-setting">
                    <label htmlFor={chunkSizeId}>Tokens per chunk</label>
                    <input id={chunkSizeId} type="number" inputMode="numeric" min={MIN_CHUNK_TOKENS} max={MAX_CHUNK_TOKENS} step={1} value={chunkSize} disabled={busy}
                        aria-invalid={!chunkSizeOk} aria-describedby={`${chunkSizeId}-hint`} onChange={event => setChunkSize(event.target.value)} />
                    <p className="ts-caption" id={`${chunkSizeId}-hint`} data-invalid={!chunkSizeOk}>{chunkSizeOk ? "Each chunk holds at most this many tokens." : `Enter a whole number from ${n(MIN_CHUNK_TOKENS)} to ${n(MAX_CHUNK_TOKENS)}.`}</p>
                </div>
                <div className="ts-setting">
                    <label htmlFor={chunkEncodingId}>Counted with</label>
                    <select id={chunkEncodingId} value={chunkEncoding} disabled={busy} onChange={event => setChunkEncoding(event.target.value as GptEncodingId)}>
                        <option value="o200k_base">o200k_base · GPT-5, GPT-4.1, GPT-4o</option>
                        <option value="cl100k_base">cl100k_base · GPT-4, GPT-3.5</option>
                    </select>
                </div>
            </div>}
        </div>
    </>} action={<StudioActionBar ready={hasInput} count={file ? fileCount(1) : text ? plural(stats.characters, "character") : undefined}>
        <button ref={runButton} type="button" className="ts-primary-button" onClick={() => void count()} disabled={!canCount}>
            <Hash size={16} aria-hidden="true" /> Count tokens
        </button>
    </StudioActionBar>}>
        {file
            ? <StudioFile name={file.name} detail={`${formatFileSize(file.size)} · read on this device when you count`} onRemove={busy ? undefined : () => setFile(null)} removeLabel={`Remove ${file.name}`} />
            : <FileIntake accepts={ACCEPTS} title="Choose a file to count" detail="Text, Markdown, CSV, JSON or code, a PDF, or a Word document (.docx). Read on this device." disabled={busy} onFiles={choose} />}
        {file
            ? <p className="ts-caption">The file’s text is counted. Remove it to paste text instead.</p>
            : <div className="ts-setting atc-paste">
                <label htmlFor={`${ids}-text`}>Or paste text</label>
                <textarea ref={textBox} id={`${ids}-text`} value={text} disabled={busy} spellCheck={false} rows={9}
                    placeholder="Paste a prompt, a document or some code." onChange={event => setText(event.target.value)} />
                <p className="ts-caption">{text ? `${plural(stats.characters, "character")} · ${plural(stats.words, "word")}` : "Paste text or choose a file to count."}</p>
            </div>}
        {busy && <StudioProgress label={step.label} detail={step.detail} progress={step.progress} onCancel={() => abort.current?.abort()} />}
    </StudioLayout>;
}

/** Words for a failure the page didn't word itself: a tokenizer that didn't download, or a browser fault. */
function messageFor(error: unknown): string {
    if (toolErrorKind(error) === "network") return "The tokenizer couldn’t be downloaded. Check that this device is online, then try again.";
    return "Something in this browser stopped the count. Try again, or try a shorter text.";
}

function ProviderCount({ provider, saved, asked, model, busy, onAsk, onModel, onSave, onRemove }: {
    provider: (typeof PROVIDERS)[number]; saved: boolean; asked: boolean; model: string; busy: boolean;
    onAsk: (on: boolean) => void; onModel: (model: string) => void; onSave: (key: string) => Promise<void>; onRemove: () => Promise<void>;
}) {
    const id = useId();
    const [draft, setDraft] = useState("");
    const [reveal, setReveal] = useState(false);
    const [working, setWorking] = useState(false);
    const [error, setError] = useState("");
    const details = providerById(provider.id);
    const save = async () => {
        if (!draft.trim()) return;
        setWorking(true); setError("");
        try {
            await onSave(draft.trim());
            // The plaintext leaves component state as soon as it is stored.
            setDraft(""); setReveal(false);
        } catch {
            setError("The key couldn’t be saved. Check that this browser allows site storage, or tick “This session only”.");
        } finally { setWorking(false); }
    };
    const remove = async () => {
        setWorking(true); setError("");
        try { await onRemove(); } catch { setError("The saved key couldn’t be removed. Try again."); } finally { setWorking(false); }
    };
    return <fieldset className="atc-provider" disabled={busy || working}>
        <legend>{provider.family}</legend>
        {saved ? <>
            <label className="ts-check"><input type="checkbox" checked={asked} onChange={event => onAsk(event.target.checked)} />
                <span>Count with {provider.family}: sends the text to {provider.company}</span></label>
            {asked && <div className="ts-setting">
                <label htmlFor={`${id}-model`}>Model</label>
                <input id={`${id}-model`} list={`${id}-models`} value={model} spellCheck={false} autoComplete="off" onChange={event => onModel(event.target.value)} />
                <datalist id={`${id}-models`}>{details?.models.map(name => <option key={name} value={name} />)}</datalist>
                {!model.trim() && <p className="ts-caption" data-invalid="true">Enter the model to count for.</p>}
            </div>}
            <p className="ts-caption atc-key-state">Key saved on this device. <button type="button" className="ts-text-button" onClick={() => void remove()}>Remove key</button></p>
        </> : <>
            <p className="ts-caption">No {provider.family} count without your {provider.company} key.</p>
            <div className="ts-setting">
                <label htmlFor={`${id}-key`}>{provider.keyLabel}</label>
                <div className="ts-password">
                    <input id={`${id}-key`} type={reveal ? "text" : "password"} value={draft} autoComplete="off" spellCheck={false}
                        onChange={event => { setDraft(event.target.value); setError(""); }}
                        onKeyDown={event => { if (event.key === "Enter") { event.preventDefault(); void save(); } }} />
                    <div className="ts-password-actions">
                        <button type="button" className="ts-icon-button" aria-label={reveal ? "Hide key" : "Show key"} aria-pressed={reveal} onClick={() => setReveal(on => !on)}>{reveal ? <EyeOff size={15} /> : <Eye size={15} />}</button>
                    </div>
                </div>
                <div className="atc-key-actions">
                    <button type="button" className="ts-secondary-button" disabled={!draft.trim()} onClick={() => void save()}>Save key</button>
                    {details?.keysUrl && <a href={details.keysUrl} target="_blank" rel="noreferrer noopener">Get a key from {provider.company}</a>}
                </div>
            </div>
        </>}
        {error && <p role="alert" className="ts-caption" data-invalid="true">{error}</p>}
    </fieldset>;
}

function SessionOnly({ on, busy, onChange }: { on: boolean; busy: boolean; onChange: (on: boolean) => Promise<void> }) {
    const [error, setError] = useState("");
    return <>
        <label className="ts-check atc-session"><input type="checkbox" checked={on} disabled={busy}
            onChange={event => { setError(""); onChange(event.target.checked).catch(() => setError("That couldn’t be changed. Your previous setting still applies.")); }} />
            <span><strong>This session only.</strong> Keep keys only until this tab closes, and remove the keys saved in this browser. Use it on a shared or borrowed computer.</span></label>
        {error && <p role="alert" className="ts-caption" data-invalid="true">{error}</p>}
    </>;
}

// ── The result ────────────────────────────────────────────────────────────

function CountResultView({ result, file, onEdit, onStartOver }: { result: CountResult; file: File | null; onEdit: () => void; onStartOver: () => void }) {
    const { source } = result;
    const providerFailed = result.providers.some(outcome => outcome.status === "failed");
    const splitFailed = Boolean(result.split && "error" in result.split);
    const partial = providerFailed || splitFailed;
    const what = source.kind === "paste" ? "your text" : source.name;
    const read = source.kind === "pdf" && source.pages ? ` from ${plural(source.pages, "page")}` : "";
    const detail = `${plural(result.characters, "character")} and ${plural(result.words, "word")}${read}, read on this device.${partial ? ` ${providerFailed ? "A count you asked for didn’t come back; the reason is with it." : "The text wasn’t split; the reason is below."}` : ""}`;

    const priced = [
        ...GPT_ENCODINGS.map(encoding => ({ id: encoding.id as string, label: `${modelList(encoding.models)} (${encoding.id})`, tokens: result.gpt[encoding.id] })),
        ...result.providers.flatMap(outcome => outcome.status === "counted" ? [{ id: outcome.id as string, label: `${providerLabel(outcome.id)} (${outcome.model})`, tokens: outcome.tokens }] : []),
    ];

    return <StudioResult tone={partial ? "partial" : "success"} title={`Token counts for ${what}`} detail={detail}>
        <ul className="atc-counts" aria-label="Token counts">
            {GPT_ENCODINGS.map(encoding => <li key={encoding.id} className="atc-count" data-state="exact">
                <span className="atc-count-name">{modelList(encoding.models)} <code>{encoding.id}</code></span>
                <strong className="atc-count-value">{plural(result.gpt[encoding.id], "token")}</strong>
                <span className="atc-count-how">Exact. Counted on this device.</span>
            </li>)}
            {result.providers.map(outcome => <ProviderRow key={outcome.id} outcome={outcome} />)}
        </ul>
        <p className="ts-caption">GPT counts are of the text alone; an API request adds a few tokens for each message’s format. The Claude and Gemini counts are for the text sent as one message, as each provider counts it.</p>
        {source.kind === "pdf" && <p className="ts-caption">If you send the PDF itself to Claude through Anthropic’s API, each page is also read as an image, which adds image tokens to the text counted here.</p>}
        {source.kind === "text" && source.encoding === "Windows-1252" && <p className="ts-caption">{source.name} isn’t valid UTF-8, so it was read as Windows-1252 text.</p>}
        <CostEstimate counts={priced} />
        {result.split && ("error" in result.split
            ? <p className="ts-note"><strong>Not split.</strong> {result.split.error}</p>
            : <ChunkList chunks={result.split.chunks} encoding={result.split.encoding} maxTokens={result.split.maxTokens} sourceName={source.kind === "paste" ? undefined : source.name} />)}
        <div className="ts-actions">
            <button type="button" className="ts-primary-button" onClick={onEdit}>{file ? "Change the options" : "Change the text or options"}</button>
            <button type="button" className="ts-text-button" onClick={onStartOver}>Count other text</button>
        </div>
    </StudioResult>;
}

const providerLabel = (id: ProviderId) => PROVIDERS.find(provider => provider.id === id)!.family;

function ProviderRow({ outcome }: { outcome: ProviderOutcome }) {
    const provider = PROVIDERS.find(entry => entry.id === outcome.id)!;
    if (outcome.status === "counted") {
        return <li className="atc-count" data-state={outcome.id === "anthropic" ? "provider" : "exact"}>
            <span className="atc-count-name">{provider.family} <code>{outcome.model}</code></span>
            <strong className="atc-count-value">{plural(outcome.tokens, "token")}</strong>
            <span className="atc-count-how">{outcome.id === "anthropic"
                ? "Anthropic’s count for this model, with your key. Anthropic calls it an estimate: a real request can differ by a small amount."
                : "Exact. Google’s count for this model, with your key."}</span>
        </li>;
    }
    if (outcome.status === "failed") {
        return <li className="atc-count" data-state="failed">
            <span className="atc-count-name">{provider.family} <code>{outcome.model}</code></span>
            <strong className="atc-count-value">Not counted</strong>
            <span className="atc-count-how">{outcome.message}</span>
        </li>;
    }
    return <li className="atc-count" data-state="none">
        <span className="atc-count-name">{provider.family}</span>
        <strong className="atc-count-value">No count</strong>
        <span className="atc-count-how">{outcome.status === "no-key"
            ? `An exact ${provider.family} count needs your ${provider.company} key. This page doesn’t guess one.`
            : `Not asked. Tick “Count with ${provider.family}” to ask ${provider.company}, with your key.`}</span>
    </li>;
}

function CostEstimate({ counts }: { counts: Array<{ id: string; label: string; tokens: number }> }) {
    const id = useId();
    const [which, setWhich] = useState(counts[0]?.id ?? "");
    const [inputPrice, setInputPrice] = useState("");
    const [outputPrice, setOutputPrice] = useState("");
    const [outputTokens, setOutputTokens] = useState("");
    const chosen = counts.find(count => count.id === which) ?? counts[0];
    const inPrice = parseAmount(inputPrice);
    const outPrice = parseAmount(outputPrice);
    const outTokens = parseAmount(outputTokens);
    const inputCost = chosen && inPrice !== null ? costFor(chosen.tokens, inPrice) : null;
    const outputCost = outPrice !== null && outTokens !== null ? costFor(outTokens, outPrice) : null;
    const total = inputCost === null && outputCost === null ? null : (inputCost ?? 0) + (outputCost ?? 0);
    const invalid = (value: string, parsed: number | null) => value.trim() !== "" && parsed === null;
    const field = (key: string, label: string, value: string, set: (value: string) => void, parsed: number | null, mode: "decimal" | "numeric") => <div className="ts-setting">
        <label htmlFor={`${id}-${key}`}>{label}</label>
        <input id={`${id}-${key}`} type="text" inputMode={mode} value={value} autoComplete="off" aria-invalid={invalid(value, parsed)} onChange={event => set(event.target.value)} />
        {invalid(value, parsed) && <p className="ts-caption" data-invalid="true">Enter a number, such as {mode === "decimal" ? "2.50" : "800"}.</p>}
    </div>;
    if (!chosen) return null;
    return <section className="atc-cost" aria-labelledby={`${id}-title`}>
        <h3 id={`${id}-title`}>Estimate the cost</h3>
        <p className="ts-caption">Enter your provider’s current prices, in US dollars per million tokens. This page keeps no price list, because prices change.</p>
        <div className="atc-cost-fields">
            <div className="ts-setting atc-cost-which">
                <label htmlFor={`${id}-which`}>Count to price</label>
                <select id={`${id}-which`} value={chosen.id} onChange={event => setWhich(event.target.value)}>
                    {counts.map(count => <option key={count.id} value={count.id}>{count.label}: {plural(count.tokens, "token")}</option>)}
                </select>
            </div>
            {field("in", "Input price, $ per 1M tokens", inputPrice, setInputPrice, inPrice, "decimal")}
            {field("out", "Output price, $ per 1M tokens", outputPrice, setOutputPrice, outPrice, "decimal")}
            {field("out-tokens", "Output tokens you expect", outputTokens, setOutputTokens, outTokens, "numeric")}
        </div>
        <dl className="ts-stats atc-cost-sums" aria-live="polite">
            <div><dt>Input</dt><dd>{inputCost === null ? "—" : formatCost(inputCost)}</dd></div>
            <div><dt>Output</dt><dd>{outputCost === null ? "—" : formatCost(outputCost)}</dd></div>
            <div><dt>Total</dt><dd>{total === null ? "—" : formatCost(total)}</dd></div>
        </dl>
        <p className="ts-caption">{inputCost === null
            ? `The input is ${plural(chosen.tokens, "token")}. Cost = tokens × price per million ÷ 1,000,000.`
            : `${plural(chosen.tokens, "token")} × $${inputPrice.trim()} per million = ${formatCost(inputCost)}.`} Cached input, batch and long-context prices differ; this uses only the prices you enter.</p>
    </section>;
}

function ChunkList({ chunks, encoding, maxTokens, sourceName }: { chunks: Chunk[]; encoding: GptEncodingId; maxTokens: number; sourceName?: string }) {
    const id = useId();
    const [shown, setShown] = useState(100);
    const [copied, setCopied] = useState<number | null>(null);
    const [copyFailed, setCopyFailed] = useState(false);
    const timer = useRef<ReturnType<typeof setTimeout>>();
    useEffect(() => () => clearTimeout(timer.current), []);
    const copy = async (index: number) => {
        try {
            await navigator.clipboard.writeText(chunks[index].text);
            setCopied(index); setCopyFailed(false);
            clearTimeout(timer.current);
            timer.current = setTimeout(() => setCopied(null), 1800);
        } catch {
            setCopied(null); setCopyFailed(true);
        }
    };
    const download = () => downloadBlob(new Blob([chunksAsText(chunks, { encoding, maxTokens })], { type: "text/plain;charset=utf-8" }),
        buildOutputFilename(sourceName ?? "text.txt", "chunks", "txt"));
    const models = gptEncoding(encoding).models;
    return <section className="atc-chunks" aria-labelledby={`${id}-title`}>
        <h3 id={`${id}-title`}>{chunks.length === 1 ? "1 chunk" : `${n(chunks.length)} chunks`} of at most {plural(maxTokens, "token")}</h3>
        <p className="ts-caption">Counted with {encoding} ({modelList(models)}). Each chunk ends between words, at a line end where one is near; each count is the chunk’s own.</p>
        <div className="ts-actions atc-chunk-actions"><button type="button" className="ts-secondary-button" onClick={download}><Download size={16} aria-hidden="true" /> Download all chunks (.txt)</button></div>
        {copyFailed && <p role="alert" className="ts-caption" data-invalid="true">This browser didn’t allow copying. Download all chunks instead.</p>}
        <ol className="atc-chunk-list">
            {chunks.slice(0, shown).map((chunk, index) => <li key={index}>
                <div className="atc-chunk-head"><strong>Chunk {n(index + 1)}</strong><span>{plural(chunk.tokens, "token")}</span>
                    <button type="button" className="ts-text-button" aria-label={`Copy chunk ${index + 1}`} onClick={() => void copy(index)}>
                        {copied === index ? <><Check size={14} aria-hidden="true" /> Copied</> : <><Copy size={14} aria-hidden="true" /> Copy</>}</button></div>
                <p>{chunkPreview(chunk.text)}</p>
            </li>)}
        </ol>
        {shown < chunks.length && <button type="button" className="ts-text-button" onClick={() => setShown(count => count + 100)}>
            Show {n(Math.min(100, chunks.length - shown))} more of {n(chunks.length - shown)}</button>}
    </section>;
}
