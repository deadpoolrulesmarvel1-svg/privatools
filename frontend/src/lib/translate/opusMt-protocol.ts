/** The messages between the page (lib/translate/opusMt.ts) and the OPUS-MT worker (opusMt.worker.ts, which runs opusMt-core.ts). */
import type { TokenRun } from "./chunk";

export type OpusMtRequest =
    /** Load a language pair's model, from this browser's cache or else from Hugging Face. */
    | { type: "load"; id: number; modelId: string; bytes: number }
    /** Each text in pieces the model reads whole, counted by its own tokenizer (chunk.ts's chunkByTokens). */
    | { type: "chunk"; id: number; modelId: string; texts: string[]; maxTokens: number }
    /** A passage's texts in the runs that are translated together, with each run's pieces (chunk.ts's tokenRuns). */
    | { type: "runs"; id: number; modelId: string; texts: string[]; maxTokens: number }
    /** One piece's translation; `maxNewTokens` defaults to the budget for its length (limits.ts). */
    | { type: "translate"; id: number; modelId: string; text: string; maxNewTokens?: number };

export type OpusMtReply =
    /** How much of the model's files has arrived, in percent. */
    | { type: "progress"; id: number; percent: number }
    /** A file of the model is coming from Hugging Face: this browser's cache didn't have it. */
    | { type: "downloading"; id: number }
    /** Every file has arrived, and the runtime is building the model from them, which gives no measure of its own. */
    | { type: "preparing"; id: number }
    | { type: "ready"; id: number }
    | { type: "result"; id: number; output: string[][] | TokenRun[] | string }
    | { type: "error"; id: number; name: string; message: string; network: boolean };

/** What failed, as plain data: a failed download is the network's, anything else the browser's. */
export function errorReply(id: number, error: unknown): Extract<OpusMtReply, { type: "error" }> {
    const name = error instanceof Error ? error.name : "Error";
    const message = error instanceof Error ? error.message : String(error);
    const network = (name === "TypeError" && /fetch|network|load failed/i.test(message)) || /failed to fetch|networkerror|load failed/i.test(message);
    return { type: "error", id, name, message, network };
}
