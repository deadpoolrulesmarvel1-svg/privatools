import { describe, expect, it, vi } from "vitest";
import { recognizeSpeech, withoutRepeat, type Recognizer, type WhisperChunk } from "./recognize";
import { SAMPLE_RATE } from "./windows";

/** 75 s: sound with a pause every 5.1 s, then 20 s of digital silence. */
function audio(): Float32Array {
    const samples = new Float32Array(95 * SAMPLE_RATE);
    for (let i = 0; i < 75 * SAMPLE_RATE; i++) {
        const t = i / SAMPLE_RATE;
        if (t % 5.1 < 4.5) samples[i] = 0.3 * Math.sin(2 * Math.PI * 220 * t);
    }
    return samples;
}

/** A segment Whisper leaves open to the end of a window, with as many words as a speaker says in that time. */
const UNFINISHED = " Last part, unfinished: it carries on to the end of the window, the way a speaker keeps talking through a long explanation of how the captions are timed, cut and laid out on the screen for whoever reads along.";

/** A recognizer that says where it was given audio, relative to the window, like Whisper. */
function fakeRecognizer(): Recognizer & { calls: { length: number; options: Record<string, unknown> }[] } {
    const calls: { length: number; options: Record<string, unknown> }[] = [];
    const recognize = (async (window: Float32Array, options: Record<string, unknown>) => {
        calls.push({ length: window.length, options });
        const seconds = window.length / SAMPLE_RATE;
        return { text: "words", chunks: [
            { timestamp: [0.5, 2] as [number, number], text: " First part." },
            { timestamp: [2.5, null] as [number, number | null], text: UNFINISHED },
            { timestamp: [seconds + 3, seconds + 9] as [number, number], text: " Past the end." },
            { timestamp: [1, 1.5] as [number, number], text: "   " },
        ] };
    }) as Recognizer & { calls: typeof calls };
    recognize.calls = calls;
    return recognize;
}

const chunk = (start: number, end: number, text: string): WhisperChunk => ({ timestamp: [start, end], text });

/** Whisper giving each call's chunks in turn, with the seconds of audio each call was given. */
function passes(...outputs: WhisperChunk[][]) {
    const heard: number[] = [];
    const recognize = vi.fn(async (window: Float32Array, _options: Record<string, unknown>) => {
        heard.push(window.length / SAMPLE_RATE);
        return { text: "x", chunks: outputs[heard.length - 1] ?? [] };
    });
    return { recognize, heard };
}

describe("recognising speech window by window", () => {
    it("passes the language, asks for timestamps and offsets every time by the window's start", async () => {
        const recognize = fakeRecognizer();
        const result = await recognizeSpeech(audio(), recognize, { language: "de" });
        expect(recognize.calls.length).toBeGreaterThan(1);
        for (const call of recognize.calls) expect(call.options).toEqual({ return_timestamps: true, language: "de", task: "transcribe" });
        expect(result.stopped).toBe(false);
        expect(result.totalSeconds).toBe(95);
        const firsts = result.segments.filter(segment => segment.text === "First part.");
        expect(firsts.length).toBe(recognize.calls.length);
        expect(firsts[0]).toEqual({ start: 0.5, end: 2, text: "First part." });
        // Each window's times are its own plus where it starts.
        expect(firsts[1].start).toBeGreaterThan(20);
        expect(firsts[1].start).toBeLessThan(31);
        for (let i = 1; i < firsts.length; i++) expect(firsts[i].start).toBeGreaterThan(firsts[i - 1].start);
    });

    it("ends an unfinished segment with the sound in its window, and one timed past its window at the window's end", async () => {
        const result = await recognizeSpeech(audio(), fakeRecognizer(), { language: "en" });
        const pastTheEnd = result.segments.find(segment => segment.text === "Past the end.")!;
        const unfinished = result.segments.find(segment => segment.text === UNFINISHED.trim())!;
        // The first window is cut in a pause; the open segment ends a quarter second after the last sound before it.
        expect(pastTheEnd.start).toBe(pastTheEnd.end);
        expect(unfinished.end).toBeLessThan(pastTheEnd.end);
        expect(pastTheEnd.end - unfinished.end).toBeLessThan(0.6);
        expect(pastTheEnd.end).toBeLessThanOrEqual(30);
        expect(result.segments.some(segment => !segment.text.trim())).toBe(false);
    });

    it("draws a segment Whisper started in the silence in to the speech", async () => {
        // Silence for 1.2 s, then sound to 3.4 s; Whisper says 0 to 4.
        const samples = new Float32Array(6 * SAMPLE_RATE);
        for (let i = Math.round(1.22 * SAMPLE_RATE); i < 3.4 * SAMPLE_RATE; i++) samples[i] = 0.3 * Math.sin(2 * Math.PI * 180 * i / SAMPLE_RATE);
        const result = await recognizeSpeech(samples, async () => ({ chunks: [{ timestamp: [0, 4] as [number, number], text: " Welcome." }] }), { language: "en" });
        expect(result.segments[0].start).toBeCloseTo(1.12, 2);
        expect(result.segments[0].end).toBeCloseTo(3.65, 2);
    });

    it("spends no time on silence", async () => {
        // 40 s of digital silence, then 25 s of sound: the first window is all silence.
        const samples = new Float32Array(65 * SAMPLE_RATE);
        for (let i = 40 * SAMPLE_RATE; i < samples.length; i++) samples[i] = 0.3 * Math.sin(2 * Math.PI * 220 * i / SAMPLE_RATE);
        const recognize = fakeRecognizer();
        const result = await recognizeSpeech(samples, recognize, { language: "en" });
        const heard = recognize.calls.reduce((sum, call) => sum + call.length, 0) / SAMPLE_RATE;
        expect(heard).toBeLessThanOrEqual(35);
        expect(result.segments.length).toBeGreaterThan(0);
        expect(result.segments.every(segment => segment.start >= 30)).toBe(true);
    });

    it("reports progress in seconds of audio, from nothing to all of it", async () => {
        const progress: number[] = [];
        await recognizeSpeech(audio(), fakeRecognizer(), { language: "en", onProgress: done => progress.push(done) });
        expect(progress[0]).toBe(0);
        expect(progress[progress.length - 1]).toBe(95);
        for (let i = 1; i < progress.length; i++) expect(progress[i]).toBeGreaterThan(progress[i - 1]);
    });

    it("moves the progress within a window as Whisper writes its timestamps", async () => {
        const progress: number[] = [];
        const recognize = vi.fn(async (_audio: Float32Array, _options: Record<string, unknown>, onPosition?: (seconds: number) => void) => {
            onPosition?.(5);
            onPosition?.(12);
            onPosition?.(400);
            return { text: "x", chunks: [] };
        });
        await recognizeSpeech(audio(), recognize, { language: "en", onProgress: done => progress.push(done) });
        expect(progress.slice(0, 4)).toEqual([0, 5, 12, progress[3]]);
        // A position past the window counts as the window's end, never past it.
        expect(progress[3]).toBeLessThanOrEqual(30);
        expect(progress[4]).toBe(progress[3]);
        for (let i = 1; i < progress.length; i++) expect(progress[i]).toBeGreaterThanOrEqual(progress[i - 1]);
    });

    it("stops between windows when asked, keeping what it has", async () => {
        const stop = new AbortController();
        const recognize = vi.fn(async (window: Float32Array) => {
            stop.abort();
            return { text: "x", chunks: [{ timestamp: [0, 1] as [number, number], text: " Only this." }] };
        });
        const result = await recognizeSpeech(audio(), recognize, { language: "en", signal: stop.signal });
        expect(recognize).toHaveBeenCalledTimes(1);
        expect(result.stopped).toBe(true);
        expect(result.doneSeconds).toBeGreaterThan(0);
        expect(result.doneSeconds).toBeLessThan(95);
        expect(result.segments).toEqual([{ start: 0, end: 1, text: "Only this." }]);
    });

    it("lets the page draw between windows", async () => {
        const yieldToPage = vi.fn(async () => {});
        const recognize = fakeRecognizer();
        await recognizeSpeech(audio(), recognize, { language: "en", yieldToPage });
        expect(yieldToPage.mock.calls.length).toBeGreaterThanOrEqual(recognize.calls.length);
    });

    it("recognises audio arriving in pieces exactly as the whole of it", async () => {
        const samples = audio();
        const whole = await recognizeSpeech(samples, fakeRecognizer(), { language: "en" });
        async function* pieces() {
            for (let at = 0; at < samples.length; at += 7 * SAMPLE_RATE) yield { start: at / SAMPLE_RATE, samples: samples.slice(at, at + 7 * SAMPLE_RATE) };
        }
        const streamed = await recognizeSpeech(pieces(), fakeRecognizer(), { language: "en", totalSeconds: 95 });
        expect(streamed.segments).toEqual(whole.segments);
        expect(streamed.doneSeconds).toBe(95);
        expect(streamed.stopped).toBe(false);
    });

    it("keeps each piece at its own time: silence fills a gap, and an overlap is heard once", async () => {
        const tone = (seconds: number) => Float32Array.from({ length: seconds * SAMPLE_RATE }, (_, i) => 0.3 * Math.sin(2 * Math.PI * 220 * i / SAMPLE_RATE));
        async function* pieces() {
            yield { start: 0, samples: tone(10) };
            yield { start: 40, samples: tone(10) }; // 30 s of nothing before it
            yield { start: 45, samples: tone(10) }; // overlaps the last 5 s
        }
        const recognize = fakeRecognizer();
        const result = await recognizeSpeech(pieces(), recognize, { language: "en" });
        expect(result.doneSeconds).toBe(55);
        const heard = recognize.calls.reduce((sum, call) => sum + call.length, 0) / SAMPLE_RATE;
        expect(heard).toBeLessThanOrEqual(55);
        expect(result.segments.filter(segment => segment.text === "First part.").map(segment => segment.start)[0]).toBe(0.5);
    });

    it("hears nothing from a stretch the browser could not decode, and says where it was", async () => {
        const tone = Float32Array.from({ length: 20 * SAMPLE_RATE }, (_, i) => 0.3 * Math.sin(2 * Math.PI * 220 * i / SAMPLE_RATE));
        async function* pieces() {
            yield { start: 0, samples: tone };
            yield { start: 20, unreadableSeconds: 60 };
            yield { start: 80, samples: tone };
        }
        const recognize = fakeRecognizer();
        const result = await recognizeSpeech(pieces(), recognize, { language: "en", totalSeconds: 100 });
        expect(result.unreadable).toEqual([{ start: 20, end: 80 }]);
        expect(result.doneSeconds).toBe(100);
        for (const segment of result.segments) expect(segment.start < 20 || segment.start >= 50).toBe(true);
    });

    describe("when Whisper stops writing before the speech ends", () => {
        // The synthetic clip's three sentences, as tone.
        const clip = () => {
            const samples = new Float32Array(12 * SAMPLE_RATE);
            for (const [from, to] of [[1.22, 3.4], [5.32, 7.92], [9.24, 11.5]]) {
                for (let i = Math.round(from * SAMPLE_RATE); i < to * SAMPLE_RATE; i++) samples[i] = 0.3 * Math.sin(2 * Math.PI * 180 * i / SAMPLE_RATE);
            }
            return samples;
        };

        it("asks again from the sentence it stopped in, and keeps every sentence once", async () => {
            // Whisper Tiny on the WebM clip wrote the first sentence, timed to 7 s, and stopped.
            const { recognize, heard } = passes(
                [chunk(0, 7, " Welcome to the subtitle generator test.")],
                [chunk(0, 2.8, " This clip was made with a speech synthesizer."), chunk(3.9, 6.4, " Every word should appear in the captions.")],
            );
            const result = await recognizeSpeech(clip(), recognize, { language: "en" });
            expect(heard.length).toBe(2);
            expect(heard[1]).toBeGreaterThan(6.68);
            expect(heard[1]).toBeLessThan(6.9);
            expect(result.segments.map(segment => segment.text)).toEqual([
                "Welcome to the subtitle generator test.",
                "This clip was made with a speech synthesizer.",
                "Every word should appear in the captions.",
            ]);
            const [first, second, third] = result.segments;
            expect(first.start).toBeCloseTo(1.12, 2);
            expect(first.end).toBeCloseTo(3.65, 2);
            expect(second.start).toBeGreaterThan(5.1);
            expect(second.start).toBeLessThan(5.32);
            expect(third.start).toBeGreaterThan(9);
            expect(third.start).toBeLessThan(9.24);
            for (let i = 1; i < result.segments.length; i++) expect(result.segments[i].start).toBeGreaterThanOrEqual(result.segments[i - 1].end);
        });

        it("writes words heard by both passes once, the ones in the stretch both heard", async () => {
            const { recognize } = passes(
                [chunk(0, 7, " Welcome to the subtitle generator test. This clip was")],
                [chunk(0, 2.8, " This clip was made with a speech synthesizer."), chunk(3.9, 6.4, " Every word should appear.")],
            );
            const result = await recognizeSpeech(clip(), recognize, { language: "en" });
            expect(result.segments.map(segment => segment.text)).toEqual([
                "Welcome to the subtitle generator test.",
                "This clip was made with a speech synthesizer.",
                "Every word should appear.",
            ]);
        });

        it("keeps a sentence that starts with the words the one before it ended on", async () => {
            // "Thank you." at 1.0 to 1.6 s, then a sentence at 3 to 5.5 s that Whisper left out.
            const samples = new Float32Array(7 * SAMPLE_RATE);
            for (const [from, to] of [[1, 1.6], [3, 5.5]]) {
                for (let i = Math.round(from * SAMPLE_RATE); i < to * SAMPLE_RATE; i++) samples[i] = 0.3 * Math.sin(2 * Math.PI * 180 * i / SAMPLE_RATE);
            }
            const { recognize, heard } = passes([chunk(0.9, 1.7, " Thank you.")], [chunk(0.1, 2.6, " Thank you so much for coming.")]);
            const result = await recognizeSpeech(samples, recognize, { language: "en" });
            expect(heard.length).toBe(2);
            expect(result.segments.map(segment => segment.text)).toEqual(["Thank you.", "Thank you so much for coming."]);
        });

        // The re-review's table: whatever follows it, the second pass's real sentence is kept.
        const rows: [string, string, WhisperChunk][] = [
            ["the sentence after it", " Welcome to the subtitle generator test.", chunk(3.9, 6.4, " Every word should appear in the captions.")],
            ["a spoken \"Thank you.\"", " Welcome to the subtitle generator test.", chunk(3.9, 6.4, " Thank you.")],
            ["the first sentence said again", " Welcome to the subtitle generator test.", chunk(3.9, 6.4, " Welcome to the subtitle generator test.")],
            ["a sentence sharing words with the first", " Thank you all for coming to the meeting today.", chunk(3.9, 6.4, " The meeting is today.")],
            ["a short reply Whisper timed long", " Welcome to the subtitle generator test.", chunk(3.9, 6.4, " Yes.")],
        ];
        for (const [what, first, third] of rows) {
            it(`keeps the second pass's real sentence when ${what} follows it`, async () => {
                const { recognize } = passes([chunk(0, 7, first)], [chunk(0, 2.8, " This clip was made with a speech synthesizer."), third]);
                const result = await recognizeSpeech(clip(), recognize, { language: "en" });
                const texts = result.segments.map(segment => segment.text);
                expect(texts[0]).toBe(first.trim());
                expect(texts).toContain("This clip was made with a speech synthesizer.");
            });
        }

        it("keeps a line said again later, and a stock line only from the first pass", async () => {
            const { recognize } = passes([chunk(0, 7, " Welcome to the subtitle generator test.")],
                [chunk(0, 2.8, " This clip was made with a speech synthesizer."), chunk(3.9, 6.4, " Welcome to the subtitle generator test.")]);
            const result = await recognizeSpeech(clip(), recognize, { language: "en" });
            expect(result.segments.map(segment => segment.text)).toEqual([
                "Welcome to the subtitle generator test.", "This clip was made with a speech synthesizer.", "Welcome to the subtitle generator test.",
            ]);
        });

        it("leaves out a second-pass segment that says again what the first pass wrote for the same stretch, and asks no more", async () => {
            const { recognize, heard } = passes([chunk(0, 7, " Welcome to the subtitle generator test.")],
                [chunk(0, 2.8, " Welcome to the subtitle generator test, they said."), chunk(3.9, 6.4, " Every word should appear in the captions.")],
                [chunk(0, 1, " Never asked.")]);
            const result = await recognizeSpeech(clip(), recognize, { language: "en" });
            expect(heard).toHaveLength(2);
            expect(result.segments.map(segment => segment.text)).toEqual(["Welcome to the subtitle generator test.", "Every word should appear in the captions."]);
        });

        it("keeps what it has when asking again finds nothing", async () => {
            const { recognize, heard } = passes([chunk(0, 7, " Welcome to the subtitle generator test.")], []);
            const result = await recognizeSpeech(clip(), recognize, { language: "en" });
            expect(heard.length).toBe(2);
            expect(result.segments.map(segment => segment.text)).toEqual(["Welcome to the subtitle generator test."]);
        });

        it("asks at most twice more for one window", async () => {
            const samples = new Float32Array(15 * SAMPLE_RATE);
            for (const [from, to] of [[0.5, 2], [3, 4.5], [5.5, 7], [8, 9.5], [10.5, 12]]) {
                for (let i = Math.round(from * SAMPLE_RATE); i < to * SAMPLE_RATE; i++) samples[i] = 0.3 * Math.sin(2 * Math.PI * 180 * i / SAMPLE_RATE);
            }
            // Whisper that only ever writes the first sentence it is given.
            const { recognize, heard } = passes([chunk(0, 2.1, " One.")], [chunk(0, 1.7, " Two.")], [chunk(0, 1.7, " Three.")], [chunk(0, 1.7, " Four.")]);
            const result = await recognizeSpeech(samples, recognize, { language: "en" });
            expect(heard.length).toBe(3);
            expect(result.segments.map(segment => segment.text)).toEqual(["One.", "Two.", "Three."]);
        });

        it("doesn't ask again over sound with no pauses to tell speech by", async () => {
            const steady = Float32Array.from({ length: 12 * SAMPLE_RATE }, (_, i) => 0.3 * Math.sin(2 * Math.PI * 220 * i / SAMPLE_RATE));
            const { recognize, heard } = passes([chunk(0, 3, " Music.")]);
            await recognizeSpeech(steady, recognize, { language: "en" });
            expect(heard.length).toBe(1);
        });

        it("never moves the progress back for the second pass", async () => {
            const progress: number[] = [];
            let call = 0;
            const recognize = vi.fn(async (_audio: Float32Array, _options: Record<string, unknown>, onPosition?: (seconds: number) => void) => {
                call++;
                if (call === 1) {
                    onPosition?.(6.9);
                    return { text: "x", chunks: [chunk(0, 7, " Welcome.")] };
                }
                onPosition?.(1);
                onPosition?.(3);
                return { text: "x", chunks: [chunk(0, 2.8, " This clip."), chunk(3.9, 6.4, " Every word.")] };
            });
            await recognizeSpeech(clip(), recognize, { language: "en", onProgress: done => progress.push(done) });
            expect(call).toBe(2);
            for (let i = 1; i < progress.length; i++) expect(progress[i]).toBeGreaterThanOrEqual(progress[i - 1]);
            expect(progress).toContain(6.9);
            expect(progress.some(done => done > 8 && done < 8.3)).toBe(true);
            expect(progress[progress.length - 1]).toBe(12);
        });
    });

    describe("over music", () => {
        // Synthetic music like the review's: notes of 0.25 to 0.75 s with short gaps and a soft drum.
        function melody(samples: Float32Array, from: number, to: number) {
            let seed = 7;
            const random = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
            const notes = [220, 247, 262, 294, 330, 349, 392, 440, 494, 523];
            for (let t = from; t < to - 0.5;) {
                const note = notes[Math.floor(random() * notes.length)];
                const duration = [0.25, 0.4, 0.5, 0.75][Math.floor(random() * 4)];
                const begin = Math.round(t * SAMPLE_RATE);
                for (let i = 0; i < duration * SAMPLE_RATE && begin + i < samples.length; i++) {
                    const x = i / SAMPLE_RATE;
                    const envelope = Math.min(1, x / 0.02) * Math.exp(-x * 3);
                    samples[begin + i] += 0.25 * envelope * (Math.sin(2 * Math.PI * note * x) + 0.4 * Math.sin(4 * Math.PI * note * x) + 0.2 * Math.sin(6 * Math.PI * note * x));
                    if (random() < 0.5 && x < 0.08) samples[begin + i] += 0.2 * (random() - 0.5) * Math.exp(-x / 0.02);
                }
                t += duration + [0, 0.1, 0.25][Math.floor(random() * 3)];
            }
        }
        /** Two sentences, at 1 to 3.2 s and 13 to 15.7 s, with music between and after them. */
        function speechAndMusic() {
            const samples = new Float32Array(25 * SAMPLE_RATE);
            for (const [from, to] of [[1, 3.2], [13, 15.7]]) {
                for (let i = Math.round(from * SAMPLE_RATE); i < to * SAMPLE_RATE; i++) samples[i] = 0.3 * Math.sin(2 * Math.PI * 180 * i / SAMPLE_RATE);
            }
            melody(samples, 4, 12);
            melody(samples, 16.5, 24.5);
            return samples;
        }
        const sentences = [chunk(0.9, 3.3, " Welcome to the subtitle generator review."), chunk(12.9, 15.8, " This recording was made with a speech synthesizer.")];

        it("reads the music as sound after the last sentence, so Whisper is asked again", async () => {
            const { recognize, heard } = passes(sentences, []);
            await recognizeSpeech(speechAndMusic(), recognize, { language: "en" });
            expect(heard.length).toBe(2);
            expect(heard[1]).toBeLessThan(9);
        });

        // What Whisper Tiny and Base wrote when asked again over the review's music.
        const inventions: [string, WhisperChunk[]][] = [
            ["a stock line", [chunk(0.5, 7.5, " Thank you.")]],
            ["an apology", [chunk(0.4, 1.4, " I'm sorry.")]],
            ["a lone interjection", [chunk(0.3, 2.3, " Oh")]],
            ["punctuation", [chunk(0.5, 6, " .")]],
            ["a loop", [chunk(0.2, 5.3, ` ${Array.from({ length: 40 }, () => "Oh,").join(" ")}`)]],
            ["a loop cut into segments", Array.from({ length: 8 }, (_, i) => chunk(i * 0.6, i * 0.6 + 0.5, " Oh, oh, oh."))],
            ["far too little text for its time", [chunk(0.2, 7.9, " Go.")]],
        ];
        for (const [kind, invented] of inventions) {
            it(`adds nothing when the second pass writes ${kind}, and asks no more`, async () => {
                const { recognize, heard } = passes(sentences, invented, invented);
                const result = await recognizeSpeech(speechAndMusic(), recognize, { language: "en" });
                expect(heard.length).toBe(2);
                expect(result.segments.map(segment => segment.text)).toEqual(["Welcome to the subtitle generator review.", "This recording was made with a speech synthesizer."]);
            });
        }
    });

    describe("a real chant or refrain", () => {
        // The re-review's real-lines talk: Whisper Base's first pass over its second window, as tone where each line is.
        const lines = ["Let's go, let's go, let's go, let's go.", "No, no, no, no, no.", "The train to the city leaves from platform 4.", "I'm sorry.",
            "Sorry, could you say that again?", "Bye bye.", "See you next time.", "We will meet again on Friday afternoon.", "Thank you.", "Thanks for watching!"];
        const voiced = () => {
            const samples = new Float32Array(30 * SAMPLE_RATE);
            for (let i = 0; i < samples.length; i++) if ((i / SAMPLE_RATE) % 3 < 2.2) samples[i] = 0.3 * Math.sin(2 * Math.PI * 180 * i / SAMPLE_RATE);
            return samples;
        };

        it("keeps a window of real lines as Whisper wrote them, without hearing it again", async () => {
            const { recognize, heard } = passes(lines.map((line, i) => chunk(i * 3, i * 3 + 2.2, ` ${line}`)));
            const result = await recognizeSpeech(voiced(), recognize, { language: "en" });
            expect(heard).toHaveLength(1);
            expect(result.segments.map(segment => segment.text)).toEqual(lines);
            expect(result.unclear).toEqual([]);
        });

        it("keeps a long chant when hearing it again writes mostly the same words", async () => {
            const chant = ` ${Array.from({ length: 12 }, () => "Let's go,").join(" ")} let's go!`;
            const first = [chunk(0, 8.2, chant), ...lines.slice(2).map((line, i) => chunk(9 + i * 3, 11.2 + i * 3, ` ${line}`))];
            // With repeats banned, the halves write the chant shorter, and the rest the same.
            const again = (cut: number, half: number) => half === 0
                ? [chunk(0, 8.2, " Let's go, let's go. Let's go, let's go!"), ...first.slice(1).filter(c => c.timestamp[1]! <= cut)]
                : first.slice(1).filter(c => c.timestamp[0]! >= cut).map(c => chunk(c.timestamp[0]! - cut, c.timestamp[1]! - cut, c.text));
            const heard: { seconds: number; options: Record<string, unknown> }[] = [];
            const recognize = vi.fn(async (window: Float32Array, options: Record<string, unknown>) => {
                heard.push({ seconds: window.length / SAMPLE_RATE, options });
                return { text: "x", chunks: heard.length === 1 ? first : again(heard[1].seconds, heard.length - 2) };
            });
            const result = await recognizeSpeech(voiced(), recognize, { language: "en" });
            expect(heard).toHaveLength(3);
            expect(result.segments[0].text).toBe(chant.trim());
            expect(result.unclear).toEqual([]);
        });
    });

    describe("when Whisper writes one phrase over and over", () => {
        // 20 s of sound in 3-second sentences with a second's pause after each: the halves are cut in the pause at 11 to 12 s.
        const talk = () => {
            const samples = new Float32Array(20 * SAMPLE_RATE);
            for (let i = 0; i < samples.length; i++) if ((i / SAMPLE_RATE) % 4 < 3) samples[i] = 0.3 * Math.sin(2 * Math.PI * 180 * i / SAMPLE_RATE);
            return samples;
        };
        const loop = ` ${Array.from({ length: 30 }, () => "the option to be").join(" ")}`;
        const base = { return_timestamps: true, language: "en", task: "transcribe" };
        // What Whisper writes for each half, in seconds within the half.
        const firstHalf = [chunk(0, 3.2, " The doctor said to drink more water."), chunk(4, 7.2, " The shop on the corner sells fresh flowers."), chunk(8, 11.2, " We watched the sunset from the hill.")];
        const secondHalf = (cut: number) => [chunk(12 - cut, 15.2 - cut, " The office printer is out of paper again."), chunk(16 - cut, 19.2 - cut, " Remember to turn off the lights when you leave.")];

        it("hears it again in two halves, cut in a pause near the middle, with no three words repeating, and keeps what they write", async () => {
            const heard: { seconds: number; options: Record<string, unknown> }[] = [];
            const recognize = vi.fn(async (window: Float32Array, options: Record<string, unknown>) => {
                heard.push({ seconds: window.length / SAMPLE_RATE, options });
                if (heard.length === 1) return { text: "x", chunks: [chunk(0, 19.5, loop)] };
                return { text: "x", chunks: heard.length === 2 ? firstHalf : secondHalf(heard[1].seconds) };
            });
            const result = await recognizeSpeech(talk(), recognize, { language: "en" });
            expect(heard).toHaveLength(3);
            expect(heard[0].options).toEqual(base);
            expect(heard[1].options).toEqual({ ...base, no_repeat_ngram_size: 3 });
            expect(heard[2].options).toEqual({ ...base, no_repeat_ngram_size: 3 });
            // The cut is in the pause from 11 to 12 s, and the halves cover the window between them.
            expect(heard[1].seconds).toBeGreaterThanOrEqual(11);
            expect(heard[1].seconds).toBeLessThanOrEqual(12);
            expect(heard[1].seconds + heard[2].seconds).toBeCloseTo(20, 5);
            expect(result.segments.map(segment => segment.text)).toEqual([...firstHalf, ...secondHalf(0)].map(segment => segment.text.trim()));
            // The second half's times are its own plus where it starts.
            expect(result.segments[3].start).toBeGreaterThan(11.8);
            expect(result.segments[3].start).toBeLessThan(12.1);
            expect(result.unclear).toEqual([]);
        });

        it("leaves out a half that still loops, says where it was, and keeps the other", async () => {
            const heard: number[] = [];
            const recognize = vi.fn(async (window: Float32Array) => {
                heard.push(window.length / SAMPLE_RATE);
                return { text: "x", chunks: heard.length === 2 ? firstHalf : [chunk(0, 8, loop)] };
            });
            const result = await recognizeSpeech(talk(), recognize, { language: "en" });
            expect(result.segments.map(segment => segment.text)).toEqual(firstHalf.map(segment => segment.text.trim()));
            // The stretch of the looping segment: from the cut, 8 s on.
            expect(result.unclear).toHaveLength(1);
            expect(result.unclear[0].start).toBeCloseTo(heard[1], 2);
            expect(result.unclear[0].end).toBeCloseTo(heard[1] + 8, 2);
        });

        it("leaves out a half that no longer loops but uses far too few different words", async () => {
            const nonsense = " The option to be the option to use the option is to use a button to use it to use your button to make sure that the button is not too long. The option is the option of the button to be used to use this button to have a button that is not very long.";
            const heard: number[] = [];
            const recognize = vi.fn(async (window: Float32Array) => {
                heard.push(window.length / SAMPLE_RATE);
                return { text: "x", chunks: heard.length === 1 ? [chunk(0, 19.5, loop)] : heard.length === 2 ? [chunk(0, 11, nonsense)] : secondHalf(heard[1]) };
            });
            const result = await recognizeSpeech(talk(), recognize, { language: "en" });
            expect(result.segments.map(segment => segment.text)).toEqual(secondHalf(0).map(segment => segment.text.trim()));
            expect(result.unclear).toEqual([{ start: 0, end: expect.closeTo(heard[1], 2) }]);
        });

        it("leaves out only the looping segments of a half that loops in places", async () => {
            const heard: number[] = [];
            const recognize = vi.fn(async (window: Float32Array) => {
                heard.push(window.length / SAMPLE_RATE);
                if (heard.length === 1) return { text: "x", chunks: [chunk(0, 19.5, loop)] };
                return { text: "x", chunks: heard.length === 2 ? [firstHalf[0], firstHalf[1], chunk(8, 11.2, loop)] : secondHalf(heard[1]) };
            });
            const result = await recognizeSpeech(talk(), recognize, { language: "en" });
            expect(result.segments.map(segment => segment.text)).toEqual([firstHalf[0], firstHalf[1], ...secondHalf(0)].map(segment => segment.text.trim()));
            expect(result.unclear).toEqual([{ start: 8, end: 11.2 }]);
        });

        it("takes three or more segments in a row saying the same for a loop", async () => {
            const same = (count: number) => Array.from({ length: count }, (_, i) => chunk(i * 2, i * 2 + 1.5, " Thank you."));
            const { recognize } = passes(same(5), same(5), same(4));
            const result = await recognizeSpeech(talk(), recognize, { language: "en" });
            expect(result.segments).toEqual([]);
            // One stretch in each half.
            expect(result.unclear).toHaveLength(2);
            expect(result.unclear[0]).toEqual({ start: 0, end: 9.5 });
        });
    });

    it("leaves out a stock line Whisper writes over silence, and keeps one over speech", async () => {
        // Sound from 1 to 3 s and from 6 to 8 s; silence between and after.
        const samples = new Float32Array(10 * SAMPLE_RATE);
        for (const [from, to] of [[1, 3], [6, 8]]) {
            for (let i = from * SAMPLE_RATE; i < to * SAMPLE_RATE; i++) samples[i] = 0.3 * Math.sin(2 * Math.PI * 180 * i / SAMPLE_RATE);
        }
        const { recognize } = passes([chunk(0.9, 3.1, " Welcome to the review."), chunk(3.6, 5.4, " Thank you."), chunk(5.9, 8.1, " Thank you.")]);
        const result = await recognizeSpeech(samples, recognize, { language: "en" });
        expect(result.segments.map(segment => [segment.text, Math.round(segment.start)])).toEqual([["Welcome to the review.", 1], ["Thank you.", 6]]);
    });

    it("cuts a segment holding two sentences at the clear pause between them", async () => {
        // Two sentences, 1 to 3.2 s and 4.4 to 7 s, written by Whisper as one segment.
        const samples = new Float32Array(9 * SAMPLE_RATE);
        for (const [from, to] of [[1, 3.2], [4.4, 7]]) {
            for (let i = from * SAMPLE_RATE; i < to * SAMPLE_RATE; i++) samples[i] = 0.3 * Math.sin(2 * Math.PI * 180 * i / SAMPLE_RATE);
        }
        const { recognize } = passes([chunk(0.9, 7.2, " Coffee and tea are served in the hall. The river flows slowly past the old mill.")]);
        const result = await recognizeSpeech(samples, recognize, { language: "en" });
        expect(result.segments.map(segment => segment.text)).toEqual(["Coffee and tea are served in the hall.", "The river flows slowly past the old mill."]);
        expect(result.segments[0].end).toBeLessThan(3.6);
        expect(result.segments[1].start).toBeGreaterThan(4.2);
        expect(result.segments[1].start).toBeLessThan(4.4);
    });

    it("passes on a recognizer's failure", async () => {
        const recognize = vi.fn(async () => { throw new Error("model failed"); });
        await expect(recognizeSpeech(audio(), recognize, { language: "en" })).rejects.toThrow("model failed");
    });
});

describe("dropping words two passes both wrote", () => {
    it("drops the words the later pass starts with, no more than can lie in the stretch both heard", () => {
        expect(withoutRepeat("Welcome to the test. This clip was", "This clip was made with a synthesizer.", 3)).toBe("Welcome to the test.");
        // Allowed two words, the three both passes wrote all stay.
        expect(withoutRepeat("Welcome to the test. This clip was", "This clip was made with a synthesizer.", 2)).toBe("Welcome to the test. This clip was");
        expect(withoutRepeat("Welcome to the test, this clip", "This clip was made.", 2)).toBe("Welcome to the test");
    });

    it("never leaves a segment empty", () => {
        expect(withoutRepeat("This clip was made.", "This clip was made with a synthesizer.", 10)).toBe("This clip was made.");
        expect(withoutRepeat("Thank you.", "Thank you so much for coming.", 2)).toBe("Thank you.");
    });

    it("drops nothing when the passes heard no stretch in common", () => {
        // A new sentence may start with the words the one before ended on.
        expect(withoutRepeat("I really love cats.", "Cats are great.", 0)).toBe("I really love cats.");
        expect(withoutRepeat("And that is the problem.", "The problem is the price.", 0)).toBe("And that is the problem.");
    });

    it("compares words without case or punctuation", () => {
        expect(withoutRepeat("It is a speech synthesizer.", "Speech, synthesizer! Then more.", 2)).toBe("It is a");
    });

    it("compares words in scripts without spaces", () => {
        expect(withoutRepeat("今日は晴れです。明日は", "明日は雨です。", 2)).toBe("今日は晴れです。");
    });
});
