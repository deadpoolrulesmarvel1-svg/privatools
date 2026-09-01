/**
 * Registry + cache manager for the on-device AI models.
 *
 * transformers.js stores every downloaded model file in the browser Cache
 * API (cache name "transformers-cache", keyed by the Hugging Face CDN URL).
 * That gives us honest introspection for free: a model is "installed" iff
 * its files are in that cache, its size is the sum of those responses, and
 * deleting it is deleting those entries. No bookkeeping to drift.
 *
 * "Download once, then it just works" — including offline — is exactly the
 * Cache API contract, and it needs no account: the cache belongs to the
 * browser profile, not to us.
 */

export interface LocalModelInfo {
    id: string;
    hfId: string;
    label: string;
    /** What it powers, user-facing. */
    powers: string;
    toolHref: string;
    approxLabel: string;
    /** Loader that instantiates (and therefore downloads) the model. */
    predownload: (onProgress: (pct: number) => void) => Promise<void>;
}

const TRANSFORMERS_CACHE = "transformers-cache";

async function pipelinePredownload(task: string, hfId: string, onProgress: (pct: number) => void) {
    const { pipeline, env } = await import("@huggingface/transformers");
    env.allowLocalModels = false;
    env.allowRemoteModels = true;
    await pipeline(task as never, hfId, {
        progress_callback: (info: { status: string; progress?: number }) => {
            if (info.status === "progress" && typeof info.progress === "number") {
                onProgress(Math.min(100, Math.max(0, Math.round(info.progress))));
            } else if (info.status === "ready") {
                onProgress(100);
            }
        },
    } as never);
}

export const LOCAL_MODELS: LocalModelInfo[] = [
    {
        id: "summarize",
        hfId: "Xenova/distilbart-cnn-6-6",
        label: "Summarizer — DistilBART CNN",
        powers: "Summarize PDF · the free on-device engine",
        toolHref: "#/tool/summarize-pdf",
        approxLabel: "~250 MB",
        predownload: (p) => pipelinePredownload("summarization", "Xenova/distilbart-cnn-6-6", p),
    },
    {
        id: "ner",
        hfId: "Xenova/bert-base-NER",
        label: "PII detector — BERT NER",
        powers: "Smart Redact · finds names and organisations locally",
        toolHref: "#/tool/smart-redact",
        approxLabel: "~250 MB",
        predownload: (p) => pipelinePredownload("token-classification", "Xenova/bert-base-NER", p),
    },
    {
        id: "whisper-tiny",
        hfId: "Xenova/whisper-tiny",
        label: "Speech to text — Whisper Tiny",
        powers: "Transcribe Audio · fast on-device transcription",
        toolHref: "#/tools/transcribe-audio",
        approxLabel: "~41 MB",
        predownload: (p) => pipelinePredownload("automatic-speech-recognition", "Xenova/whisper-tiny", p),
    },
    {
        id: "whisper-base",
        hfId: "Xenova/whisper-base",
        label: "Speech to text — Whisper Base",
        powers: "Transcribe Audio · the more accurate local model",
        toolHref: "#/tools/transcribe-audio",
        approxLabel: "~74 MB",
        predownload: (p) => pipelinePredownload("automatic-speech-recognition", "Xenova/whisper-base", p),
    },
    {
        id: "bg-remove",
        hfId: "briaai/RMBG-1.4",
        label: "Background remover — RMBG 1.4",
        powers: "Remove Background · the on-device engine",
        toolHref: "#/tools/remove-background",
        approxLabel: "~44 MB",
        predownload: async (p) => {
            const { loadBgModel } = await import("./localBgRemove");
            await loadBgModel(p);
        },
    },
];

/** Translation models download per language pair; they are discovered from
 *  the cache rather than listed up front. */
export const TRANSLATE_HF_PREFIX = "Xenova/opus-mt-";

export interface CachedModel {
    hfId: string;
    bytes: number;
    fileCount: number;
}

function hfIdFromUrl(url: string): string | null {
    // e.g. https://huggingface.co/Xenova/distilbart-cnn-6-6/resolve/main/…
    const m = url.match(/huggingface\.co\/([^/]+\/[^/]+)\/(?:resolve|raw)\//);
    return m ? m[1] : null;
}

/** Everything transformers.js has cached, grouped by model. */
export async function listCachedModels(): Promise<CachedModel[]> {
    try {
        if (!("caches" in globalThis)) return [];
        const cache = await caches.open(TRANSFORMERS_CACHE);
        const keys = await cache.keys();
        const byModel = new Map<string, CachedModel>();
        for (const req of keys) {
            const hfId = hfIdFromUrl(req.url);
            if (!hfId) continue;
            const entry = byModel.get(hfId) ?? { hfId, bytes: 0, fileCount: 0 };
            entry.fileCount += 1;
            try {
                const res = await cache.match(req);
                const len = res?.headers.get("Content-Length");
                if (len) entry.bytes += parseInt(len, 10) || 0;
                else if (res) entry.bytes += (await res.clone().blob()).size;
            } catch { /* size stays approximate */ }
            byModel.set(hfId, entry);
        }
        return [...byModel.values()].sort((a, b) => a.hfId.localeCompare(b.hfId));
    } catch {
        return [];
    }
}

export async function removeCachedModel(hfId: string): Promise<void> {
    if (!("caches" in globalThis)) return;
    const cache = await caches.open(TRANSFORMERS_CACHE);
    const keys = await cache.keys();
    await Promise.all(keys.filter(k => hfIdFromUrl(k.url) === hfId).map(k => cache.delete(k)));
}

export function formatBytes(n: number): string {
    if (n <= 0) return "size unknown";
    if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
    if (n < 1024 * 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(0)} MB`;
    return `${(n / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}
