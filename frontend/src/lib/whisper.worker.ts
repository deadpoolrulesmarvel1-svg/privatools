/**
 * Whisper off the page's thread. lib/whisper.ts starts this worker through a
 * blob: URL, so it runs under the page's own policy (the model runtime's
 * wasm-unsafe-eval and jsDelivr), and talks to it by message: "load" a model,
 * then "run" it on 16 kHz mono audio. A window of speech can keep the
 * processor busy for many seconds; here that never stops the page drawing
 * its progress or answering a click.
 */
import { env, pipeline } from "@huggingface/transformers";
import { configureTransformers } from "./transformersEnv";
import { modelProgress } from "./modelProgress";
import type { WhisperReply, WhisperRequest } from "./whisper-protocol";

configureTransformers(env);

type Pipeline = (audio: Float32Array, options: Record<string, unknown>) => Promise<unknown>;
const pipelines = new Map<string, Promise<Pipeline>>();
const post = (reply: WhisperReply) => (self as unknown as Worker).postMessage(reply);

/** What failed, as plain data: a failed download is the network's, anything else the browser's. */
function failure(id: number, error: unknown): WhisperReply {
    const name = error instanceof Error ? error.name : "Error";
    const message = error instanceof Error ? error.message : String(error);
    const network = (name === "TypeError" && /fetch|network|load failed/i.test(message)) || /failed to fetch|networkerror|load failed/i.test(message);
    return { type: "error", id, name, message, network };
}

self.onmessage = async (event: MessageEvent<WhisperRequest>) => {
    const request = event.data;
    if (request.type === "load") {
        let loading = pipelines.get(request.hfId);
        if (!loading) {
            loading = pipeline("automatic-speech-recognition", request.hfId, {
                progress_callback: modelProgress(percent => post({ type: "progress", id: request.id, percent }), request.bytes),
            } as never) as unknown as Promise<Pipeline>;
            pipelines.set(request.hfId, loading);
        }
        try {
            await loading;
            post({ type: "ready", id: request.id });
        } catch (error) {
            pipelines.delete(request.hfId);
            post(failure(request.id, error));
        }
        return;
    }
    try {
        const asr = await pipelines.get(request.hfId);
        if (!asr) throw new Error("The model is not loaded.");
        const options = request.positions ? { ...request.options, streamer: positionStreamer(asr, request.id) } : request.options;
        const output = await asr(request.audio, options);
        post({ type: "result", id: request.id, output });
    } catch (error) {
        post(failure(request.id, error));
    }
};

/**
 * Whisper writes a timestamp before and after each stretch of speech, as it
 * goes; each new furthest one is how far through the audio it has got, which
 * the page shows as progress. Within a 30-second window that is the only
 * honest measure there is.
 */
function positionStreamer(asr: Pipeline, id: number) {
    const config = (asr as unknown as { tokenizer?: { timestamp_begin?: number }; model?: { generation_config?: { no_timestamps_token_id?: number } } });
    const begin = config.tokenizer?.timestamp_begin ?? (config.model?.generation_config?.no_timestamps_token_id ?? Number.NaN) + 1;
    let furthest = 0;
    return {
        put(value: bigint[][]) {
            // The first call carries the prompt; after it, one new token a step.
            for (const token of value[0] ?? []) {
                const seconds = (Number(token) - begin) * 0.02;
                if (seconds > furthest + 0.4 && seconds <= 30) {
                    furthest = seconds;
                    post({ type: "position", id, seconds });
                }
            }
        },
        end() {},
    };
}

export {};
