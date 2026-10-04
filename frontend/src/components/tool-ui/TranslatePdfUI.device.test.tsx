/**
 * Translate PDF on this device: a page is sent to OPUS-MT in pieces counted in
 * the model's own tokens. 900 characters of Chinese were one piece, more than
 * the 512 tokens the model reads, and it dropped the rest without an error.
 */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const PAGE = "北角的灯塔建于一八七四年，在一九二一年的大风暴之后重建。守塔人把每一次天气变化都写在日记里，博物馆至今仍保存着这本日记。".repeat(16);

vi.mock("pdfjs-dist", () => ({
    GlobalWorkerOptions: {},
    getDocument: () => ({
        promise: Promise.resolve({ numPages: 1, getPage: async () => ({ getTextContent: async () => ({ items: [{ str: PAGE }] }) }) }),
    }),
}));
vi.mock("pdfjs-dist/build/pdf.worker.mjs?url", () => ({ default: "worker.js" }));

const sent = vi.hoisted(() => [] as string[]);
vi.mock("@/lib/translate/opusMt", async original => ({
    ...(await original<object>()),
    // A token a character, near enough for Chinese.
    loadDeviceTranslator: async (modelId: string, progress: (percent: number) => void) => {
        progress(100);
        return { modelId, countTokens: (text: string) => Array.from(text).length + 1, translate: async (text: string) => { sent.push(text); return `[${Array.from(text).length}]`; } };
    },
}));

import { MAX_INPUT_TOKENS } from "@/lib/translate/opusMt";
import { TranslatePdfUI } from "./TranslatePdfUI";

afterEach(() => { cleanup(); sent.length = 0; });

describe("Translate PDF on this device", () => {
    it("sends a long Chinese page in pieces the model reads whole, and drops none of it", async () => {
        const { container } = render(<TranslatePdfUI />);
        const file = new File(["%PDF-1.4"], "notice.pdf", { type: "application/pdf" });
        Object.defineProperty(file, "arrayBuffer", { value: async () => new ArrayBuffer(8) });
        fireEvent.change(container.querySelector("input[type=file]")!, { target: { files: [file] } });
        fireEvent.change(container.querySelector("#tr-source")!, { target: { value: "zh" } });
        fireEvent.click(screen.getByRole("button", { name: "Translate" }));
        await screen.findByRole("button", { name: /Download text/ });
        expect(sent.length).toBeGreaterThan(5);
        for (const piece of sent) expect(Array.from(piece).length + 1).toBeLessThanOrEqual(MAX_INPUT_TOKENS);
        expect(sent.join("")).toBe(PAGE);
    });
});
