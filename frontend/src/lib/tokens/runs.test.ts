/**
 * The guard against runs the GPT tokenizer would take minutes over. It is
 * held against the tokenizer's own split patterns: wherever the guard finds
 * no long run, no piece the tokenizer makes is longer than about twice the
 * limit, so no piece is slow.
 */
import { describe, expect, it } from "vitest";
import { CL100K_TOKEN_SPLIT_REGEX, O200K_TOKEN_SPLIT_REGEX } from "gpt-tokenizer/encodingParams/constants";
import { toolErrorKind } from "@/lib/toolRun";
import { ReadError } from "./errors";
import { MAX_RUN_CHARS, checkRuns, findLongRun } from "./runs";

const L = MAX_RUN_CHARS;

function refusal(text: string): ReadError {
    try { checkRuns(text); } catch (e) { return e as ReadError; }
    throw new Error("expected a refusal");
}

describe("finding runs too long to count", () => {
    it("lets ordinary text through, however long", () => {
        const prose = "The quick brown fox counts tokens for the report, page by page, line by line. ".repeat(30_000);
        expect(findLongRun(prose)).toBeNull();
        expect(findLongRun("数据处理，".repeat(20_000))).toBeNull();
        // Digits never make a long piece: the tokenizer takes them three at a time.
        expect(findLongRun("1234567890".repeat(10_000))).toBeNull();
    });

    it("allows a run of exactly the limit and finds one a character longer, measured to its end", () => {
        expect(findLongRun("a".repeat(L))).toBeNull();
        expect(findLongRun(`start ${"A".repeat(L + 1)} end`)).toEqual({ kind: "letters", start: 6, length: L + 1 });
        expect(findLongRun(`x ${"G".repeat(L + 500)}`)).toEqual({ kind: "letters", start: 2, length: L + 500 });
    });

    it("counts characters, not string units: an emoji is one", () => {
        expect(findLongRun("🙂".repeat(L))).toBeNull();
        expect(findLongRun("🙂".repeat(L + 1))).toEqual({ kind: "symbols", start: 0, length: L + 1 });
        expect(findLongRun("数".repeat(L + 1))).toEqual({ kind: "letters", start: 0, length: L + 1 });
    });

    it("finds each kind of run the tokenizer makes one piece of", () => {
        expect(findLongRun("=".repeat(L + 1))?.kind).toBe("symbols");
        expect(findLongRun(`a${" ".repeat(L + 1)}b`)?.kind).toBe("spaces");
        expect(findLongRun(`a${"\n".repeat(L + 1)}b`)?.kind).toBe("spaces");
        // o200k_base adds line breaks and slashes to a punctuation piece.
        expect(findLongRun("/\n".repeat(L / 2 + 1))?.kind).toBe("breaks");
        // Combining marks belong to words in o200k_base and to punctuation in cl100k_base.
        expect(findLongRun("é".repeat(L / 2 + 1))?.kind).toBe("letters");
        expect(findLongRun("!́".repeat(L / 2 + 1))?.kind).toBe("symbols");
    });

    it("keeps every piece either tokenizer makes within about twice the limit wherever it finds no run", () => {
        const limit = 40;
        const parts = ["a", "Z", "数", "é", "́", "!", "=", "/", "🙂", " ", "\n", "\r\n", "\t", "1", "'s", " ", "\ud800"];
        // mulberry32: a small generator whose low bits are as random as its high ones.
        let seed = 20261003;
        const random = () => {
            seed = (seed + 0x6d2b79f5) | 0;
            let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
            t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
            return (t ^ (t >>> 14)) >>> 0;
        };
        let checked = 0;
        for (let round = 0; round < 4000; round++) {
            // Few kinds of part per text, repeated, so that long runs and long pieces both happen.
            const alphabet = Array.from({ length: 1 + (random() % 3) }, () => parts[random() % parts.length]);
            const text = Array.from({ length: 30 + (random() % 120) }, () => alphabet[random() % alphabet.length]).join("");
            if (findLongRun(text, limit)) continue;
            checked++;
            for (const pattern of [O200K_TOKEN_SPLIT_REGEX, CL100K_TOKEN_SPLIT_REGEX]) {
                for (const [piece] of text.matchAll(pattern)) expect([...piece].length, JSON.stringify(piece)).toBeLessThanOrEqual(2 * limit + 5);
            }
        }
        expect(checked).toBeGreaterThan(500);
    });
});

describe("what the visitor is told", () => {
    it("names the run, how long it is and where it starts, and how to fix it", () => {
        const error = refusal(`Sequence:\n${"ACGT".repeat(6_000)}\nEnd.`);
        expect(error).toBeInstanceOf(ReadError);
        expect(error.code).toBe("long-run");
        expect(toolErrorKind(error)).toBe("bad_input");
        expect(error.message).toBe("This text has 24,000 letters in a row with no space, digit or punctuation between them, starting “ACGTACGTACGTACGT…”. "
            + "The GPT tokenizer slows down sharply on runs that long (doubling a run makes it four times slower), so this page counts runs of up to 20,000 characters. "
            + "Break it up with spaces or line breaks, or count a shorter part.");
    });

    it("words a run of spaces as one", () => {
        expect(refusal(`a${" ".repeat(25_000)}b`).message).toMatch(/^This text has 25,000 spaces, tabs or line breaks in a row\. .* Remove the extra spaces and line breaks, or count a shorter part\.$/);
    });

    it("words a run of symbols as one", () => {
        expect(refusal("=".repeat(21_000)).message).toMatch(/^This text has 21,000 punctuation marks or symbols in a row with no space between them, starting “={16}…”\./);
    });
});
