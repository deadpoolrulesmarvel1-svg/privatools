/**
 * The GPT encoders for counting on the page's own thread, where no worker
 * starts (engine.ts), and for tests. Each rank table is imported only when
 * asked for, as a chunk of its own. The workers never import this module:
 * each builds its one table into its own script.
 */
import type { GptEncoder, GptEncodingId } from "./gpt";

const loaded = new Map<GptEncodingId, Promise<GptEncoder>>();

export function loadGptEncoder(id: GptEncodingId): Promise<GptEncoder> {
    let encoder = loaded.get(id);
    if (!encoder) {
        encoder = (id === "o200k_base" ? import("gpt-tokenizer/encoding/o200k_base") : import("gpt-tokenizer/encoding/cl100k_base"))
            .then(module => module as GptEncoder);
        // A failed download may succeed on the next attempt.
        encoder.catch(() => loaded.delete(id));
        loaded.set(id, encoder);
    }
    return encoder;
}
