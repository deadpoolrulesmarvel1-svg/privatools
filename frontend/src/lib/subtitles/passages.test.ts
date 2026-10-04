import { describe, expect, it } from "vitest";
import { distribute, endsSentence, groupPassages, type PassagePart } from "./passages";

/** Parts one per cue, a second apart, unless said otherwise. */
function parts(texts: (string | Partial<PassagePart> & { text: string })[]): PassagePart[] {
    return texts.map((entry, index) => {
        const part = typeof entry === "string" ? { text: entry } : entry;
        return { turn: false, style: "", cue: index, start: index, end: index + 0.9, ...part };
    });
}

describe("grouping cues into passages", () => {
    it("puts a sentence across three cues into one passage", () => {
        expect(groupPassages(parts(["When I was young,", "my father took me", "to see the sea.", "It was cold."]))).toEqual([[0, 1, 2], [3]]);
    });

    it("leaves a sentence that fits in one cue on its own", () => {
        expect(groupPassages(parts(["Hello.", "How are you?", "Fine, thanks!"]))).toEqual([[0], [1], [2]]);
    });

    it("starts a passage at every dialogue dash, and keeps two speakers of one cue apart", () => {
        const dialogue = parts([
            { text: "Where are you going?", turn: true, cue: 0 },
            { text: "To the store, because", turn: true, cue: 0 },
            { text: "we need milk.", cue: 1 },
            { text: "Okay", turn: true, cue: 2 },
            { text: "see you later.", turn: true, cue: 3 },
        ]);
        expect(groupPassages(dialogue)).toEqual([[0], [1, 2], [3], [4]]);
    });

    it("carries a sentence on past an ellipsis or a full stop followed by a small letter", () => {
        expect(groupPassages(parts(["I was thinking...", "...that we could go.", "Then."]))).toEqual([[0, 1], [2]]);
        expect(endsSentence("We met Mr.", "smith at noon.")).toBe(false);
        expect(endsSentence("Done.", "Next one.")).toBe(true);
        expect(endsSentence("我们走吧。", "好的")).toBe(true);
    });

    it("ends a passage where the styling changes or after a long pause", () => {
        expect(groupPassages(parts([{ text: "On the radio", style: "i" }, "the news went on", "and on"]))).toEqual([[0], [1, 2]]);
        expect(groupPassages(parts([{ text: "and so", start: 0, end: 1 }, { text: "we waited", start: 6, end: 7 }]))).toEqual([[0], [1]]);
    });

    it("keeps unpunctuated captions to five cues a passage", () => {
        const words = parts(Array.from({ length: 12 }, (_, i) => `so this is caption ${i}`));
        expect(groupPassages(words).map(passage => passage.length)).toEqual([5, 5, 2]);
    });
});

describe("sharing a translation out across the cues", () => {
    it("keeps a one-cue sentence whole", () => {
        expect(distribute(" Hola,  ¿qué tal? ", ["Hi, how are you?"])).toEqual({ pieces: ["Hola, ¿qué tal?"], repeated: [false] });
    });

    it("splits by the share of the source text each cue had, at a word break", () => {
        const { pieces } = distribute("Fui a la tienda y compré leche.", ["I went to the store", "and bought some milk."]);
        expect(pieces).toEqual(["Fui a la tienda", "y compré leche."]);
    });

    it("prefers the comma where the source cue ended with one", () => {
        const { pieces } = distribute("Cuando era joven, mi padre me llevó a ver el mar.", ["When I was young,", "my father took me", "to see the sea."]);
        expect(pieces[0]).toBe("Cuando era joven,");
        expect(pieces.join(" ")).toBe("Cuando era joven, mi padre me llevó a ver el mar.");
        expect(pieces.every(piece => piece.length > 0)).toBe(true);
    });

    it("splits Chinese between words, without spaces", () => {
        const { pieces } = distribute("我们今天要谈谈隐私以及它为什么重要", ["We are going to talk about privacy today", "and about why it matters."]);
        expect(pieces).toHaveLength(2);
        expect(pieces.join("")).toBe("我们今天要谈谈隐私以及它为什么重要");
        expect(pieces[0].length).toBeGreaterThan(pieces[1].length);
    });

    it("never leaves a cue empty: a translation shorter than its cues holds its last word", () => {
        expect(distribute("¿Qué?", ["Wait,", "what?"])).toEqual({ pieces: ["¿Qué?", "¿Qué?"], repeated: [false, true] });
        expect(distribute("Sí, claro.", ["Yes,", "of", "course."])).toEqual({ pieces: ["Sí,", "claro.", "claro."], repeated: [false, false, true] });
    });

    it("keeps every word, in order, whatever the shares", () => {
        const translation = "uno dos tres cuatro cinco seis siete ocho nueve diez once doce";
        for (const sources of [["a", "b"], ["a long first cue here", "b"], ["a", "b", "c", "d", "e"]]) {
            const { pieces } = distribute(translation, sources);
            expect(pieces.join(" ")).toBe(translation);
            expect(pieces.every(Boolean)).toBe(true);
        }
    });
});
