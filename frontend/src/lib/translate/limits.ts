/**
 * OPUS-MT's two limits, shared by the page (opusMt.ts) and the worker that
 * runs the model (opusMt-core.ts).
 *
 * The model reads at most 512 tokens and silently drops the rest, so text is
 * sent in pieces counted in its own tokens (chunk.ts). transformers.js lets
 * it write only 256 new tokens unless told otherwise, which can cut a long
 * piece's translation short, so each call says how much it may write.
 */

/** Tokens per piece of text: well inside the 512 the model reads, where it also translates best. */
export const MAX_INPUT_TOKENS = 200;

/** How many tokens a translation of `inputTokens` may take: room for any faithful one, and a stop for a model repeating itself. */
export function outputBudget(inputTokens: number): number {
    return Math.min(512, Math.ceil(inputTokens * 3) + 16);
}
