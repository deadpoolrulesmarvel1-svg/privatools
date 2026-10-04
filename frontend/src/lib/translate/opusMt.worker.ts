/**
 * OPUS-MT off the page's thread, for Translate PDF and Subtitle Translator.
 * lib/translate/opusMt.ts starts this worker through a blob: URL, so it runs
 * under the page's own policy (the model runtime's wasm-unsafe-eval and
 * jsDelivr), and talks to it by message: "load" a language pair's model,
 * "chunk" or "runs" to cut text into pieces with the model's tokenizer, and
 * "translate" each piece (opusMt-core.ts does each). On the page's thread,
 * loading the model kept the page from drawing or taking a click for 4 to 7
 * seconds, and a long piece's translation for up to 2.5; here neither stops
 * the page, and Cancel ends the worker.
 *
 * Ending a worker waits for its current task, and the browser forces it only
 * after a delay (two seconds in Chromium). A piece's translation is one long
 * run of model steps, so each step here waits for the next task
 * (lib/modelSteps.ts): Cancel then ends the worker between two steps rather
 * than after the whole piece. Building the model is one step of the runtime
 * and can't be cut.
 */
import { yieldBetweenSteps } from "@/lib/modelSteps";
import { createOpusMtCore } from "./opusMt-core";
import type { OpusMtReply, OpusMtRequest } from "./opusMt-protocol";

const scope = self as unknown as { postMessage(message: OpusMtReply): void; onmessage: ((event: MessageEvent<OpusMtRequest>) => void) | null };
const core = createOpusMtCore(reply => scope.postMessage(reply), { prepare: yieldBetweenSteps });

// One message at a time, in order: handle() answers every message, failures included.
let queue = Promise.resolve();
scope.onmessage = event => {
    queue = queue.then(() => core.handle(event.data));
};

export {};
