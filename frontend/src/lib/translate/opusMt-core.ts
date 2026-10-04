/**
 * What the OPUS-MT worker does with each message. opusMt.worker.ts only
 * connects it to the worker's messages; where no worker can start, the page
 * runs it in place (opusMt.ts). It loads a language pair's model with
 * transformers.js, cuts text into pieces with the model's own tokenizer
 * (chunk.ts) and translates each piece the way the two pages always have:
 * transformers.js's own decoding, greedy, with the output budget from
 * limits.ts.
 *
 * Messages are handled one at a time, in order (the caller queues them), so
 * one load runs at a time and the model never runs two steps at once.
 */
import { env, pipeline } from "@huggingface/transformers";
import { modelProgress } from "@/lib/modelProgress";
import { configureTransformers } from "@/lib/transformersEnv";
import { chunkByTokens, tokenRuns } from "./chunk";
import { outputBudget } from "./limits";
import { errorReply, type OpusMtReply, type OpusMtRequest } from "./opusMt-protocol";

type TranslationPipeline = ((text: string, options?: Record<string, unknown>) => Promise<Array<{ translation_text?: string }>>) & {
    tokenizer: { encode(text: string): number[] };
};

type LoadEvent = { status: string; file?: string; loaded?: number; total?: number };

configureTransformers(env);

/**
 * transformers.js fetches one of a model's files only when this browser's
 * cache doesn't have it, so a fetch is a download. The load in progress
 * hears of it.
 */
let onFetch: ((url: string) => void) | null = null;
const fetchFile = env.fetch;
env.fetch = (input, init) => {
    onFetch?.(String(input));
    return fetchFile(input, init);
};

export interface OpusMtCore {
    /** Answer one message through `post`. It never throws: a failure is answered as an "error". */
    handle(request: OpusMtRequest): Promise<void>;
}

/** `prepare` sees each model once it has loaded: the page uses it to give itself a turn between the model's steps. */
export function createOpusMtCore(post: (reply: OpusMtReply) => void, { prepare }: { prepare?: (translator: unknown) => void } = {}): OpusMtCore {
    // A loaded model is kept for the worker's life, so switching back to a pair doesn't load it again.
    const pipelines = new Map<string, Promise<TranslationPipeline>>();

    async function load(id: number, modelId: string, bytes: number): Promise<void> {
        let loading = pipelines.get(modelId);
        if (!loading) {
            const report = modelProgress(percent => post({ type: "progress", id, percent }), bytes);
            const asked = new Set<string>();
            const arrived = new Set<string>();
            let preparing = false;
            onFetch = url => {
                if (!url.includes(`/${modelId}/`)) return;
                onFetch = null;
                post({ type: "downloading", id });
            };
            loading = (pipeline("translation", modelId, {
                progress_callback: (event: LoadEvent) => {
                    report(event);
                    if (!event.file) return;
                    if (event.status === "initiate") asked.add(event.file);
                    else if (event.status === "done") arrived.add(event.file);
                    else return;
                    // Every file it asked for, the weights among them, is here: what remains is building the model.
                    if (!preparing && arrived.size === asked.size && [...arrived].some(file => file.endsWith(".onnx"))) {
                        preparing = true;
                        post({ type: "preparing", id });
                    }
                },
            } as never) as unknown as Promise<TranslationPipeline>).then(translator => {
                prepare?.(translator);
                return translator;
            });
            pipelines.set(modelId, loading);
        }
        try {
            await loading;
        } catch (error) {
            // A failed download must not poison the map: the next attempt downloads again.
            pipelines.delete(modelId);
            throw error;
        } finally {
            onFetch = null;
        }
    }

    async function loaded(modelId: string): Promise<TranslationPipeline> {
        const translator = await pipelines.get(modelId);
        if (!translator) throw new Error("The translation model isn’t loaded.");
        return translator;
    }

    return {
        async handle(request) {
            try {
                if (request.type === "load") {
                    await load(request.id, request.modelId, request.bytes);
                    post({ type: "ready", id: request.id });
                    return;
                }
                const translator = await loaded(request.modelId);
                const countTokens = (text: string) => translator.tokenizer.encode(text).length;
                if (request.type === "chunk") {
                    post({ type: "result", id: request.id, output: request.texts.map(text => chunkByTokens(text, countTokens, request.maxTokens)) });
                } else if (request.type === "runs") {
                    post({ type: "result", id: request.id, output: tokenRuns(request.texts, countTokens, request.maxTokens) });
                } else {
                    const result = await translator(request.text, { max_new_tokens: request.maxNewTokens ?? outputBudget(countTokens(request.text)) });
                    post({ type: "result", id: request.id, output: (result?.[0]?.translation_text ?? "").trim() });
                }
            } catch (error) {
                post(errorReply(request.id, error));
            }
        },
    };
}
