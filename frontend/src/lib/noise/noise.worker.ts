/**
 * Voice Noise Remover's worker: everything that takes processor time runs
 * here, off the page's thread (worker-core.ts says what). Messages are
 * handled one at a time, in order, though starting awaits RNNoise. Cancel
 * ends the worker.
 */
import type { NoiseReply, NoiseRequest } from "./protocol";
import { createNoiseWorkerCore } from "./worker-core";

const scope = self as unknown as { postMessage(message: NoiseReply): void; onmessage: ((event: MessageEvent<NoiseRequest>) => void) | null };
const post = (reply: NoiseReply) => scope.postMessage(reply);
const core = createNoiseWorkerCore(post);

let queue = Promise.resolve();
scope.onmessage = event => {
    queue = queue.then(() => core.handle(event.data)).catch((error: unknown) => {
        const { name, message } = error instanceof Error ? error : { name: "Error", message: String(error) };
        post({ type: "error", name, message });
    });
};
post({ type: "loaded" });

export {};
