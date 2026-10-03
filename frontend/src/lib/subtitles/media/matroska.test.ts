import { describe, expect, it } from "vitest";
import { Blob as NodeBlob } from "node:buffer";
import { mediaFixture } from "@/test/media/fixtures";
import { indexMatroska } from "./matroska";
import { NoSoundTrack } from "./types";

const asBlob = (buffer: ArrayBuffer) => new NodeBlob([buffer]) as unknown as Blob;

describe("reading the sound of WebM and MKV files", () => {
    it.each(["tone.webm", "tone-vorbis.webm", "tone.mkv"])("finds the audio blocks of %s", async name => {
        const index = await indexMatroska(mediaFixture(name));
        expect(index).not.toBeNull();
        expect(index!.container).toBe("Matroska");
        expect(index!.durationSeconds).toBeGreaterThan(1.9);
        expect(index!.durationSeconds).toBeLessThan(2.2);
        expect(index!.pieces).toHaveLength(1);
        expect(index!.pieces[0].start).toBeGreaterThanOrEqual(0);
        expect(index!.pieces[0].start).toBeLessThan(0.1);
    });

    it.each(["tone.webm", "tone-vorbis.webm", "tone.mkv"])("writes each piece of %s as a Matroska stream that holds the same audio", async name => {
        const original = mediaFixture(name);
        const index = (await indexMatroska(original, { pieceSeconds: 0.5 }))!;
        expect(index.pieces.length).toBeGreaterThanOrEqual(3);
        for (const piece of index.pieces) {
            const bytes = new Uint8Array(await piece.read());
            expect([...bytes.subarray(0, 4)]).toEqual([0x1a, 0x45, 0xdf, 0xa3]);
            // Read back, the piece is one audio track whose blocks start where the piece does.
            const again = (await indexMatroska(asBlob(bytes.buffer)))!;
            expect(again).not.toBeNull();
            expect(again.pieces[0].start).toBeCloseTo(piece.start, 6);
            expect(bytes.length).toBeLessThan(original.size);
        }
    });

    it("keeps the original document type, so a WebM stays a WebM", async () => {
        const piece = (await indexMatroska(mediaFixture("tone.webm")))!.pieces[0];
        const text = new TextDecoder("latin1").decode(new Uint8Array(await piece.read()).subarray(0, 80));
        expect(text).toContain("webm");
    });

    it("ends a recording that was cut off at its last whole block", async () => {
        const whole = mediaFixture("tone.webm");
        const cut = whole.slice(0, Math.round(whole.size * 0.6));
        const index = await indexMatroska(cut);
        expect(index).not.toBeNull();
        expect(index!.durationSeconds).toBeLessThan(2.2);
        await expect(index!.pieces[0].read()).resolves.toBeInstanceOf(ArrayBuffer);
    });

    it("says when a video has no sound track at all", async () => {
        await expect(indexMatroska(mediaFixture("no-sound.webm"))).rejects.toBeInstanceOf(NoSoundTrack);
    });

    it("says no to files that are not Matroska", async () => {
        expect(await indexMatroska(mediaFixture("tone.mp4"))).toBeNull();
        expect(await indexMatroska(mediaFixture("tone.mp3"))).toBeNull();
        expect(await indexMatroska(asBlob(new Uint8Array([0x1a, 0x45, 0xdf, 0xa3]).buffer))).toBeNull();
    });

    it("reports how far through the file it has read", async () => {
        const seen: number[] = [];
        const file = mediaFixture("tone.webm");
        await indexMatroska(file, { onRead: bytes => seen.push(bytes) });
        expect(seen.length).toBeGreaterThan(0);
        expect(Math.max(...seen)).toBeLessThanOrEqual(file.size);
    });
});
