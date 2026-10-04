import { describe, expect, it, vi } from "vitest";

const calls = vi.hoisted(() => [] as { text: string; options?: Record<string, unknown> }[]);
const loads = vi.hoisted(() => ({ count: 0, fail: false }));
vi.mock("@huggingface/transformers", () => ({
    env: {},
    pipeline: vi.fn(async () => {
        loads.count++;
        if (loads.fail) { loads.fail = false; throw new TypeError("Failed to fetch"); }
        return Object.assign(async (text: string, options?: Record<string, unknown>) => { calls.push({ text, options }); return [{ translation_text: " hola " }]; }, {
            // A token a word, and the end mark.
            tokenizer: { encode: (text: string) => [...text.split(/\s+/).filter(Boolean).map((_, i) => i + 5), 0] },
            model: { sessions: {} },
        });
    }),
}));

import { loadDeviceTranslator, outputBudget } from "./opusMt";

describe("OPUS-MT on this device", () => {
    it("counts the model's own tokens and lets each translation run past transformers.js's 256-token default", async () => {
        const translator = await loadDeviceTranslator("Xenova/opus-mt-en-es", () => {});
        expect(translator.countTokens("one two three")).toBe(4);
        expect(await translator.translate("one two three")).toBe("hola");
        expect(calls[0].options).toEqual({ max_new_tokens: outputBudget(4) });
        await translator.translate(Array.from({ length: 199 }, () => "word").join(" "));
        expect(calls[1].options).toEqual({ max_new_tokens: 512 });
    });

    it("downloads again after a failed download rather than replaying its failure", async () => {
        loads.fail = true;
        const before = loads.count;
        await expect(loadDeviceTranslator("Xenova/opus-mt-en-de", () => {})).rejects.toThrow("Failed to fetch");
        await expect(loadDeviceTranslator("Xenova/opus-mt-en-de", () => {})).resolves.toMatchObject({ modelId: "Xenova/opus-mt-en-de" });
        expect(loads.count - before).toBe(2);
    });
});
