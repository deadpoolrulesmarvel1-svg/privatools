import { describe, expect, it, vi } from "vitest";
import { recognizeSpeech, type Recognizer } from "./recognize";
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

/** A recognizer that says where it was given audio, relative to the window, like Whisper. */
function fakeRecognizer(): Recognizer & { calls: { length: number; options: Record<string, unknown> }[] } {
    const calls: { length: number; options: Record<string, unknown> }[] = [];
    const recognize = (async (window: Float32Array, options: Record<string, unknown>) => {
        calls.push({ length: window.length, options });
        const seconds = window.length / SAMPLE_RATE;
        return { text: "words", chunks: [
            { timestamp: [0.5, 2] as [number, number], text: " First part." },
            { timestamp: [2.5, null] as [number, number | null], text: " Last part, unfinished." },
            { timestamp: [seconds + 3, seconds + 9] as [number, number], text: " Past the end." },
            { timestamp: [1, 1.5] as [number, number], text: "   " },
        ] };
    }) as Recognizer & { calls: typeof calls };
    recognize.calls = calls;
    return recognize;
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
        const unfinished = result.segments.find(segment => segment.text === "Last part, unfinished.")!;
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

    it("passes on a recognizer's failure", async () => {
        const recognize = vi.fn(async () => { throw new Error("model failed"); });
        await expect(recognizeSpeech(audio(), recognize, { language: "en" })).rejects.toThrow("model failed");
    });
});
