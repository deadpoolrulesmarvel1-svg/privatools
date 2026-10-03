import { describe, expect, it, vi } from "vitest";
import { NumberedReplyError, readNumberedReply } from "@/lib/byok/tasks";
import { ByokError } from "@/lib/byok/errors";
import { cuesOf, parseSubtitles } from "./subtitleFile";
import {
    BATCH_LIMITS, NOT_REACHED, assembleCues, batchItems, exportSubtitles, lineFor, looksInvented, planTranslation,
    translateOnDevice, translateWithModel, translatedFileName, type DeviceEngine,
} from "./translateSubtitles";

const TWO = { maxLineChars: 42, maxLines: 2 };

const FILM = `1
00:00:01,000 --> 00:00:02,500
When I was young,

2
00:00:02,600 --> 00:00:04,000
my father took me

3
00:00:04,100 --> 00:00:06,000
to see the sea.

4
00:00:07,000 --> 00:00:08,000
- Are you coming?
- Yes.

5
00:00:09,000 --> 00:00:10,000
♪♪

6
00:00:11,000 --> 00:00:12,000
<i>It was cold.</i>
`;

const SPANISH: Record<string, string> = {
    "When I was young, my father took me to see the sea.": "Cuando era joven, mi padre me llevó a ver el mar.",
    "Are you coming?": "¿Vienes?",
    "Yes.": "Sí.",
    "It was cold.": "Hacía frío.",
};

/** OPUS-MT, stubbed: a word a token, and Spanish for the passages above. */
function device(overrides: Partial<DeviceEngine> = {}) {
    const calls: string[] = [];
    const engine: DeviceEngine = {
        countTokens: text => text.split(/\s+/).filter(Boolean).length + 1,
        translate: vi.fn(async (text: string) => { calls.push(text); return SPANISH[text] ?? text.toUpperCase(); }),
        ...overrides,
    };
    return { engine, calls };
}

describe("translating on this device", () => {
    it("translates a sentence across three cues as one passage and shares it out across the same cues", async () => {
        const doc = parseSubtitles(FILM);
        const plan = planTranslation(doc);
        const { engine, calls } = device();
        const { outcomes, stoppedBy } = await translateOnDevice(plan, engine, { maxTokens: 200 });
        expect(stoppedBy).toBeUndefined();
        expect(calls).toEqual(["When I was young, my father took me to see the sea.", "Are you coming?", "Yes.", "It was cold."]);
        const cues = assembleCues(doc, plan, outcomes, TWO);
        expect(cues.map(cue => cue.text)).toEqual([
            "Cuando era joven,", "mi padre me llevó", "a ver el mar.",
            "- ¿Vienes?\n- Sí.",
            "♪♪",
            "<i>Hacía frío.</i>",
        ]);
        expect(cues.map(cue => cue.status)).toEqual(["translated", "translated", "translated", "translated", "kept", "translated"]);
    });

    it("keeps every cue's number and timing in the file it writes", async () => {
        const doc = parseSubtitles(FILM);
        const plan = planTranslation(doc);
        const { outcomes } = await translateOnDevice(plan, device().engine, { maxTokens: 200 });
        const cues = assembleCues(doc, plan, outcomes, TWO);
        const written = parseSubtitles(exportSubtitles(doc, cues, "srt").text);
        expect(cuesOf(written).map(cue => [cue.id, cue.timing])).toEqual(cuesOf(doc).map(cue => [cue.id, cue.timing]));
        expect(cuesOf(written)[4].lines).toEqual(["♪♪"]);
    });

    it("sends a long Chinese cue in pieces the model reads whole, and keeps the cue", async () => {
        const sentence = "我们今天要讨论隐私为什么重要以及如何保护它";
        const long = Array.from({ length: 30 }, () => sentence).join("，") + "。";
        const doc = parseSubtitles(`1\n00:00:01,000 --> 00:00:09,000\n${long}\n\n2\n00:00:10,000 --> 00:00:11,000\n好的。\n`);
        const sent: string[] = [];
        // One token a character, as near enough for Chinese.
        const engine: DeviceEngine = { countTokens: text => Array.from(text).length + 1, translate: async text => { sent.push(text); return `[${Array.from(text).length}]`; } };
        const plan = planTranslation(doc);
        const { outcomes } = await translateOnDevice(plan, engine, { maxTokens: 200 });
        expect(sent.length).toBeGreaterThan(3);
        for (const piece of sent) expect(Array.from(piece).length + 1).toBeLessThanOrEqual(200);
        // Nothing dropped: the pieces hold every character of the cue.
        expect(sent.slice(0, -1).join("").replace(/\s/g, "")).toBe(long.replace(/\s/g, ""));
        expect(outcomes.every(outcome => outcome?.status === "done")).toBe(true);
    });

    it("cuts a long Thai line between words, with the model's own token count", async () => {
        const phrase = "สวัสดีครับวันนี้อากาศดีมาก";
        const long = Array.from({ length: 40 }, () => phrase).join(" ");
        const doc = parseSubtitles(`1\n00:00:01,000 --> 00:00:09,000\n${long}\n`);
        const sent: string[] = [];
        const engine: DeviceEngine = { countTokens: text => Math.ceil(Array.from(text).length / 2) + 1, translate: async text => { sent.push(text); return "Hello"; } };
        await translateOnDevice(planTranslation(doc), engine, { maxTokens: 120 });
        expect(sent.length).toBeGreaterThan(1);
        for (const piece of sent) expect(Math.ceil(Array.from(piece).length / 2) + 1).toBeLessThanOrEqual(120);
        // Nothing lost, and every cut falls between two words.
        expect(sent.join("").replace(/\s/g, "")).toBe(long.replace(/\s/g, ""));
        const boundaries = new Set<number>();
        // Intl.Segmenter is newer than the ES2020 library the app is typed against.
        const Segmenter = (Intl as unknown as { Segmenter: new (locale: string, options: { granularity: string }) => { segment(text: string): Iterable<{ index: number }> } }).Segmenter;
        for (const { index } of new Segmenter("th", { granularity: "word" }).segment(long)) boundaries.add(index);
        let at = 0;
        for (const piece of sent) {
            at = long.indexOf(piece, at);
            expect(boundaries.has(at)).toBe(true);
            at += piece.length;
        }
    });

    it("marks a translation far longer than its source for checking", async () => {
        const doc = parseSubtitles("1\n00:00:01,000 --> 00:00:02,000\niv\n");
        const engine: DeviceEngine = { countTokens: () => 3, translate: async () => "Il était une fois une très longue phrase qui n'existait pas." };
        const plan = planTranslation(doc);
        const cues = assembleCues(doc, plan, (await translateOnDevice(plan, engine, { maxTokens: 200 })).outcomes, TWO);
        expect(cues[0].check).toBe(true);
        expect(looksInvented("Okay.", "D'accord.")).toBe(false);
    });

    it("stops at a model failure and keeps what was done", async () => {
        const doc = parseSubtitles(FILM);
        const plan = planTranslation(doc);
        let count = 0;
        const { engine } = device({ translate: async (text: string) => { if (++count === 3) throw new Error("out of memory"); return SPANISH[text] ?? text; } });
        const result = await translateOnDevice(plan, engine, { maxTokens: 200 });
        expect((result.stoppedBy as Error).message).toBe("out of memory");
        const cues = assembleCues(doc, plan, result.outcomes, TWO);
        expect(cues.map(cue => cue.status)).toEqual(["translated", "translated", "translated", "failed", "kept", "failed"]);
        expect(cues[5]).toMatchObject({ text: "<i>It was cold.</i>", reason: NOT_REACHED });
    });

    it("stops when cancelled, without a result", async () => {
        const controller = new AbortController();
        const { engine } = device({ translate: async () => { controller.abort(); return "x"; } });
        await expect(translateOnDevice(planTranslation(parseSubtitles(FILM)), engine, { maxTokens: 200, signal: controller.signal })).rejects.toMatchObject({ name: "AbortError" });
    });
});

/** A model, stubbed: answers numbered lines as `answer` says, recording what it was sent. */
function model(answer: (lines: string[], call: number) => string[] | Error) {
    const sent: string[][] = [];
    const engine = vi.fn(async (lines: string[]) => {
        sent.push(lines);
        const reply = answer(lines, sent.length);
        if (reply instanceof Error) throw reply;
        return reply;
    });
    return { engine, sent };
}
/** A model that keeps a speaker's dash in front, as models do. */
const echo = (lines: string[]) => lines.map(line => line.replace(/^(- )?/, "$1ES "));

describe("translating with your own AI key", () => {
    it("sends numbered lines with the dash a new speaker starts with, and puts each reply on its own line", async () => {
        const doc = parseSubtitles(FILM);
        const plan = planTranslation(doc);
        const { engine, sent } = model(echo);
        const { outcomes } = await translateWithModel(plan, engine);
        expect(sent).toEqual([["When I was young,", "my father took me", "to see the sea.", "- Are you coming?", "- Yes.", "It was cold."]]);
        expect(assembleCues(doc, plan, outcomes, TWO).map(cue => cue.text)).toEqual([
            "ES When I was young,", "ES my father took me", "ES to see the sea.", "- ES Are you coming?\n- ES Yes.", "♪♪", "<i>ES It was cold.</i>",
        ]);
    });

    it("tries a batch whose reply had the wrong count again in two halves, and moves no text", async () => {
        const doc = parseSubtitles(FILM);
        const plan = planTranslation(doc);
        const { engine, sent } = model((lines, call) => call === 1 ? new NumberedReplyError("[4] is missing") : echo(lines));
        const { outcomes } = await translateWithModel(plan, engine);
        expect(sent.map(lines => lines.length)).toEqual([6, 3, 3]);
        expect(outcomes.map(outcome => outcome?.status === "done" && outcome.text)).toEqual([
            "ES When I was young,", "ES my father took me", "ES to see the sea.", "ES Are you coming?", "ES Yes.", "ES It was cold.",
        ]);
    });

    it("marks the lines of a half that fails again as not translated, and keeps their own text", async () => {
        const doc = parseSubtitles(FILM);
        const plan = planTranslation(doc);
        const { engine } = model(lines => lines[0].startsWith("When") ? new NumberedReplyError("[2] holds two numbers") : echo(lines));
        const cues = assembleCues(doc, plan, (await translateWithModel(plan, engine)).outcomes, TWO);
        expect(cues.map(cue => cue.status)).toEqual(["failed", "failed", "failed", "translated", "kept", "translated"]);
        expect(cues[0].text).toBe("When I was young,");
        expect(cues[0].reason).toMatch(/didn’t keep these lines’ numbers/);
    });

    it("stops at a refused key, keeping nothing it didn't get", async () => {
        const plan = planTranslation(parseSubtitles(FILM));
        const refused = new ByokError("BadKey", "auth rejected (401)", "That key was rejected.");
        const { engine, sent } = model(() => refused);
        const result = await translateWithModel(plan, engine);
        expect(result.stoppedBy).toBe(refused);
        expect(sent).toHaveLength(1);
        expect(result.outcomes.every(outcome => outcome === undefined)).toBe(true);
    });

    it("tries an answer cut off at its length limit again, smaller", async () => {
        const plan = planTranslation(parseSubtitles(FILM));
        const { engine, sent } = model((lines, call) => call === 1 ? new ByokError("TooLong", "cut", "stopped") : echo(lines));
        const result = await translateWithModel(plan, engine);
        expect(sent.map(lines => lines.length)).toEqual([6, 3, 3]);
        expect(result.outcomes.every(outcome => outcome?.status === "done")).toBe(true);
    });

    it("counts a reply line that is only a speaker's dash as not translated", async () => {
        const doc = parseSubtitles("1\n00:00:01,000 --> 00:00:02,000\n- Are you coming?\n- Yes.\n");
        const plan = planTranslation(doc);
        const { engine } = model(() => ["- ¿Vienes?", "-"]);
        const cues = assembleCues(doc, plan, (await translateWithModel(plan, engine)).outcomes, TWO);
        expect(cues[0]).toMatchObject({ status: "failed", text: "- ¿Vienes?\n- Yes.", reason: "The model returned this line empty." });
    });

    it("keeps formatting inside the words only when the reply carries exactly the same spans", async () => {
        const doc = parseSubtitles("1\n00:00:01,000 --> 00:00:02,000\nI said <i>no</i>.\n\n2\n00:00:03,000 --> 00:00:04,000\nShe said <b>yes</b>.\n");
        const plan = planTranslation(doc);
        const { engine } = model(() => ["Dije <i>no</i>.", "Ella dijo sí."]);
        const cues = assembleCues(doc, plan, (await translateWithModel(plan, engine)).outcomes, TWO);
        expect(cues.map(cue => [cue.text, cue.dropped])).toEqual([["Dije <i>no</i>.", 0], ["Ella dijo sí.", 1]]);
    });

    it("batches whole passages within the size limits", () => {
        const lines = Array.from({ length: 120 }, (_, i) => `${i + 1}\n00:00:${String(i % 60).padStart(2, "0")},000 --> 00:00:${String(i % 60).padStart(2, "0")},500\nThis is line number ${i + 1} of a long talk${i % 3 === 2 ? "." : ","}\n`).join("\n");
        const plan = planTranslation(parseSubtitles(lines));
        const batches = batchItems(plan);
        expect(batches.flat()).toEqual(plan.items.map((_, i) => i));
        for (const batch of batches) {
            expect(batch.length).toBeLessThanOrEqual(BATCH_LIMITS.maxLines);
            expect(batch.reduce((sum, index) => sum + lineFor(plan.items[index]).length + 6, 0)).toBeLessThanOrEqual(BATCH_LIMITS.maxChars);
            // A passage is never split between batches.
            for (const passage of plan.passages) {
                const inside = passage.filter(index => batch.includes(index)).length;
                expect(inside === 0 || inside === passage.length).toBe(true);
            }
        }
    });
});

describe("reading a model's numbered reply", () => {
    it("takes one line per number, ignoring a preamble and the fence", () => {
        expect(readNumberedReply("Here you go:\n<<<DOCUMENT abc>>>\n[1] Uno\n\n[2]  Dos \n<<<END DOCUMENT abc>>>", 2)).toEqual(["Uno", "Dos"]);
    });

    it.each([
        ["a wrong count", "[1] Uno\n[2] Dos", 3, "[3] to [3] are missing"],
        ["merged numbers", "[1] Uno\n[2][3] Dos tres", 3, "[2] holds two numbers"],
        ["two lines merged into one", "[1] Uno [2] Dos\n[3] Tres", 3, "[2] is missing"],
        ["a missing line", "[1] Uno\n[3] Tres", 3, "[2] is missing"],
        ["a doubled number", "[1] Uno\n[1] Uno\n[2] Dos", 2, "[1] comes twice or out of order"],
        ["a line split in two", "[1] Uno\ny más\n[2] Dos", 2, "a line without a number follows [1]"],
        ["an empty line", "[1] Uno\n[2]", 2, "[2] is empty"],
        ["an extra line", "[1] Uno\n[2] Dos\n[3] Tres", 2, "[3] is more than the 2 lines sent"],
        ["no numbers at all", "Lo siento, no puedo.", 2, "no numbered lines"],
    ])("refuses %s", (_label, reply, count, problem) => {
        expect(() => readNumberedReply(reply, count)).toThrow(NumberedReplyError);
        try { readNumberedReply(reply, count); } catch (error) { expect((error as NumberedReplyError).problem).toBe(problem); }
    });
});

describe("naming the translated file", () => {
    it("adds the language before the format, replacing one the name already ends in", () => {
        expect(translatedFileName("talk.srt", "es", "srt")).toBe("talk.es.srt");
        expect(translatedFileName("talk.en.srt", "es", "vtt")).toBe("talk.es.vtt");
        expect(translatedFileName("Movie.2024.en-US.vtt", "zh-CN", "srt")).toBe("Movie.2024.zh-CN.srt");
        expect(translatedFileName("my.notes.srt", "fr", "srt")).toBe("my.notes.fr.srt");
        expect(translatedFileName(".srt", "fr", "srt")).toBe("subtitles.fr.srt");
    });
});
