/**
 * OPUS-MT on this device, shared by Translate PDF and Subtitle Translator.
 *
 * One model per language pair (lib/translate/languages.ts), loaded by
 * transformers.js from Hugging Face on first use and kept in the browser's
 * Cache API, where the AI hub lists it. A loaded pipeline is kept for the
 * page's life, so switching back to a pair already used doesn't download it
 * again.
 *
 * Two limits of the model are handled here rather than left to each page:
 * it reads at most 512 tokens and silently drops the rest, so text is sent in
 * pieces counted in its own tokens (lib/translate/chunk.ts); and
 * transformers.js lets it write only 256 new tokens unless told otherwise,
 * which can cut a long piece's translation short, so each call says how much
 * it may write. Each model step yields to the page (lib/modelSteps.ts), so
 * progress keeps drawing while a long file translates.
 */
import { modelProgress } from "@/lib/modelProgress";
import { yieldBetweenSteps } from "@/lib/modelSteps";
import { configureTransformers } from "@/lib/transformersEnv";
import { APPROX_MODEL_MB } from "./languages";

/** Tokens per piece of text: well inside the 512 the model reads, where it also translates best. */
export const MAX_INPUT_TOKENS = 200;

/** How many tokens a translation of `inputTokens` may take: room for any faithful one, and a stop for a model repeating itself. */
export function outputBudget(inputTokens: number): number {
    return Math.min(512, Math.ceil(inputTokens * 3) + 16);
}

export interface DeviceTranslator {
    readonly modelId: string;
    /** The tokens the model reads for this text, its end mark included. */
    countTokens(text: string): number;
    /** One piece's translation; `maxNewTokens` defaults to the budget for its length. */
    translate(text: string, maxNewTokens?: number): Promise<string>;
}

type TranslationPipeline = ((text: string, options?: Record<string, unknown>) => Promise<Array<{ translation_text?: string }>>) & {
    tokenizer: { encode(text: string): number[] };
};

const pipelines = new Map<string, Promise<TranslationPipeline>>();

/**
 * The pair's model, downloading it first if this browser does not have it.
 * `onProgress` hears the download in percent, and 100 once it is ready.
 */
export async function loadDeviceTranslator(modelId: string, onProgress: (percent: number) => void): Promise<DeviceTranslator> {
    let loading = pipelines.get(modelId);
    if (!loading) {
        loading = (async () => {
            // Dynamic import keeps the transformers bundle out of the main chunk.
            const { pipeline, env } = await import("@huggingface/transformers");
            configureTransformers(env);
            const translator = await pipeline("translation", modelId, {
                progress_callback: modelProgress(onProgress, APPROX_MODEL_MB * 1024 * 1024),
            } as never);
            yieldBetweenSteps(translator);
            return translator as unknown as TranslationPipeline;
        })();
        pipelines.set(modelId, loading);
    }
    let translator: TranslationPipeline;
    try {
        translator = await loading;
    } catch (error) {
        // A failed download must not poison the cache: the next attempt downloads again.
        pipelines.delete(modelId);
        throw error;
    }
    onProgress(100);
    const countTokens = (text: string) => translator.tokenizer.encode(text).length;
    return {
        modelId,
        countTokens,
        async translate(text: string, maxNewTokens?: number) {
            const result = await translator(text, { max_new_tokens: maxNewTokens ?? outputBudget(countTokens(text)) });
            return (result?.[0]?.translation_text ?? "").trim();
        },
    };
}
