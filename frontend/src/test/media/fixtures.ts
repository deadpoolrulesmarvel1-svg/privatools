/**
 * The synthetic media next to this file (regenerate with make.sh): two
 * seconds of a 440 Hz tone, in each container layout the Subtitle
 * Generator's readers handle.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Blob as NodeBlob, File as NodeFile } from "node:buffer";

export function mediaFixture(name: string): Blob {
    const bytes = readFileSync(join(process.cwd(), "src/test/media", name));
    return new NodeBlob([bytes]) as unknown as Blob;
}

/** A fixture as the File a visitor would choose, with the type their browser would give it. Node's File, which reads in pieces as browsers do. */
export function mediaFile(name: string, type: string, bytes?: Uint8Array): File {
    const parts = [bytes ?? readFileSync(join(process.cwd(), "src/test/media", name))] as unknown as ConstructorParameters<typeof NodeFile>[0];
    return new NodeFile(parts, name, { type }) as unknown as File;
}

/** A WAV file built in memory: `seconds` of a tone, at any rate, channel count and sample format. */
export function wavFile({ rate = 16000, channels = 1, bits = 16, float = false, seconds = 1, dataSize }: { rate?: number; channels?: number; bits?: number; float?: boolean; seconds?: number; dataSize?: number } = {}): Blob {
    const frames = Math.round(rate * seconds);
    const block = channels * (bits / 8);
    const data = new Uint8Array(frames * block);
    const view = new DataView(data.buffer);
    for (let i = 0; i < frames; i++) {
        const value = 0.5 * Math.sin((2 * Math.PI * 440 * i) / rate);
        for (let c = 0; c < channels; c++) {
            const at = i * block + c * (bits / 8);
            if (float) view.setFloat32(at, value, true);
            else if (bits === 16) view.setInt16(at, Math.round(value * 32767), true);
            else if (bits === 24) { const v = Math.round(value * 8388607); data[at] = v & 0xff; data[at + 1] = (v >> 8) & 0xff; data[at + 2] = (v >> 16) & 0xff; }
            else if (bits === 8) data[at] = Math.round(value * 127) + 128;
        }
    }
    const header = new Uint8Array(44);
    const h = new DataView(header.buffer);
    const text = (at: number, value: string) => { for (let i = 0; i < 4; i++) header[at + i] = value.charCodeAt(i); };
    text(0, "RIFF"); h.setUint32(4, 36 + data.length, true); text(8, "WAVE");
    text(12, "fmt "); h.setUint32(16, 16, true); h.setUint16(20, float ? 3 : 1, true); h.setUint16(22, channels, true);
    h.setUint32(24, rate, true); h.setUint32(28, rate * block, true); h.setUint16(32, block, true); h.setUint16(34, bits, true);
    text(36, "data"); h.setUint32(40, dataSize ?? data.length, true);
    return new NodeBlob([header, data]) as unknown as Blob;
}
