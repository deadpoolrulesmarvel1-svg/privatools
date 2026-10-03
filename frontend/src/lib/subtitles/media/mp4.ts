/**
 * The sound of an MP4, MOV or M4A file, read from its sample tables.
 *
 * The `moov` box lists where every audio sample sits in the file, so the
 * sound can be read without touching the video around it. AAC samples are
 * wrapped as ADTS (aac.ts) and MP3 samples are already a playable stream, so
 * each piece decodes on its own. Fragmented MP4, encrypted tracks and other
 * codecs are left to the whole-file path (extract.ts).
 */
import { AAC_FRAME_SAMPLES, adtsHeader, parseAudioSpecificConfig, type AacConfig } from "./aac";
import { ascii, concat, readRange, u16, u32, u64 } from "./bytes";
import { NoSoundTrack, PIECE_SECONDS, type AudioIndex, type AudioPiece } from "./types";

interface Box { type: string; start: number; payload: number; end: number }

/** The most read in one go when gathering a piece's samples. */
const SPAN_BYTES = 16 * 1024 * 1024;

/** The boxes in b[from, to). */
function boxes(b: Uint8Array, from: number, to: number): Box[] {
    const out: Box[] = [];
    for (let at = from; at + 8 <= to;) {
        let size = u32(b, at);
        let header = 8;
        if (size === 1) {
            if (at + 16 > to) break;
            size = u64(b, at + 8);
            header = 16;
        } else if (size === 0) {
            size = to - at;
        }
        if (size < header || at + size > to) break;
        out.push({ type: ascii(b, at + 4, 4), start: at, payload: at + header, end: at + size });
        at += size;
    }
    return out;
}

const childOf = (b: Uint8Array, parent: Box | undefined, type: string, skip = 0) =>
    parent ? boxes(b, parent.payload + skip, parent.end).find(box => box.type === type) : undefined;
const childrenOf = (b: Uint8Array, parent: Box, type: string) => boxes(b, parent.payload, parent.end).filter(box => box.type === type);

/** The first box of `type` anywhere below `parent`, e.g. `esds` inside a QuickTime `wave`. */
function find(b: Uint8Array, from: number, to: number, type: string, depth = 0): Box | undefined {
    for (const box of boxes(b, from, to)) {
        if (box.type === type) return box;
        if (depth < 4 && box.end - box.payload >= 8) {
            const found = find(b, box.payload, box.end, type, depth + 1);
            if (found) return found;
        }
    }
    return undefined;
}

/** MPEG-4 descriptor length: up to four bytes of seven bits each. */
function descriptor(b: Uint8Array, at: number, end: number): { tag: number; body: number; end: number } | null {
    if (at + 2 > end) return null;
    const tag = b[at];
    let length = 0;
    let i = at + 1;
    for (let n = 0; n < 4 && i < end; n++, i++) {
        length = (length << 7) | (b[i] & 0x7f);
        if (!(b[i] & 0x80)) { i++; break; }
    }
    return i + length <= end ? { tag, body: i, end: i + length } : null;
}

/** The decoder config in an `esds` box: the object type and the AudioSpecificConfig. */
function readEsds(b: Uint8Array, esds: Box): { objectType: number; config?: Uint8Array } | null {
    const es = descriptor(b, esds.payload + 4, esds.end);
    if (!es || es.tag !== 0x03) return null;
    let at = es.body + 2;
    const flags = b[at++];
    if (flags & 0x80) at += 2;
    if (flags & 0x40) at += 1 + b[at];
    if (flags & 0x20) at += 2;
    const decoderConfig = descriptor(b, at, es.end);
    if (!decoderConfig || decoderConfig.tag !== 0x04) return null;
    const objectType = b[decoderConfig.body];
    const specific = descriptor(b, decoderConfig.body + 13, decoderConfig.end);
    return { objectType, config: specific?.tag === 0x05 ? b.slice(specific.body, specific.end) : undefined };
}

type Codec = { kind: "aac"; config: AacConfig } | { kind: "mp3" };

/** What the track's first sample description holds, if this reader can pass it on. */
function readCodec(b: Uint8Array, stsd: Box): Codec | null {
    const entry = boxes(b, stsd.payload + 8, stsd.end)[0];
    if (!entry || entry.type !== "mp4a") return null;
    // AudioSampleEntry: QuickTime versions 1 and 2 add 16 and 36 bytes before the child boxes.
    const version = u16(b, entry.payload + 8);
    const childrenAt = entry.payload + 28 + (version === 1 ? 16 : version === 2 ? 36 : 0);
    const esds = find(b, childrenAt, entry.end, "esds");
    const decoder = esds ? readEsds(b, esds) : null;
    if (!decoder) return null;
    if (decoder.objectType === 0x69 || decoder.objectType === 0x6b) return { kind: "mp3" };
    if (decoder.objectType === 0x40 && decoder.config) {
        const config = parseAudioSpecificConfig(decoder.config);
        return config ? { kind: "aac", config } : null;
    }
    return null;
}

interface Track { timescale: number; codec: Codec; stbl: Box; edts?: Box }

/** The audio track to read, null when its codec is not one this reader passes on; throws NoSoundTrack when there is none. */
function audioTrack(b: Uint8Array, moov: Box): Track | null {
    const candidates: (Track & { enabled: boolean })[] = [];
    let sound = false;
    for (const trak of childrenOf(b, moov, "trak")) {
        const mdia = childOf(b, trak, "mdia");
        const hdlr = childOf(b, mdia, "hdlr");
        if (!hdlr || ascii(b, hdlr.payload + 8, 4) !== "soun") continue;
        sound = true;
        const mdhd = childOf(b, mdia, "mdhd");
        const stbl = childOf(b, childOf(b, mdia, "minf"), "stbl");
        const stsd = childOf(b, stbl, "stsd");
        if (!mdhd || !stbl || !stsd) continue;
        const timescale = b[mdhd.payload] === 1 ? u32(b, mdhd.payload + 20) : u32(b, mdhd.payload + 12);
        const codec = readCodec(b, stsd);
        if (!codec || !timescale) continue;
        const tkhd = childOf(b, trak, "tkhd");
        candidates.push({ timescale, codec, stbl, edts: childOf(b, trak, "edts"), enabled: !tkhd || (b[tkhd.payload + 3] & 1) === 1 });
    }
    if (!sound) throw new NoSoundTrack();
    return candidates.find(track => track.enabled) ?? candidates[0] ?? null;
}

interface Samples { offsets: Float64Array; sizes: Uint32Array; times: Float64Array; end: number }

/** Every sample's place in the file, size and decode time, from stsz/stz2, stco/co64, stsc and stts. */
function readSamples(b: Uint8Array, stbl: Box): Samples | null {
    const stsz = childOf(b, stbl, "stsz");
    const stz2 = childOf(b, stbl, "stz2");
    const stco = childOf(b, stbl, "stco") ?? childOf(b, stbl, "co64");
    const stsc = childOf(b, stbl, "stsc");
    const stts = childOf(b, stbl, "stts");
    if ((!stsz && !stz2) || !stco || !stsc || !stts) return null;

    const count = stsz ? u32(b, stsz.payload + 8) : u32(b, stz2!.payload + 8);
    if (!count) return null;
    const sizes = new Uint32Array(count);
    if (stsz) {
        const fixed = u32(b, stsz.payload + 4);
        if (!fixed && stsz.payload + 12 + 4 * count > stsz.end) return null;
        for (let i = 0; i < count; i++) sizes[i] = fixed || u32(b, stsz.payload + 12 + 4 * i);
    } else {
        // Compact sizes: 4, 8 or 16 bits each, two 4-bit sizes to a byte, high nibble first.
        const field = b[stz2!.payload + 7];
        const at = stz2!.payload + 12;
        for (let i = 0; i < count; i++) {
            sizes[i] = field === 16 ? u16(b, at + 2 * i) : field === 8 ? b[at + i] : (b[at + (i >> 1)] >> (i & 1 ? 0 : 4)) & 0xf;
        }
    }

    const wide = stco.type === "co64";
    const chunks = u32(b, stco.payload + 4);
    const chunkOffset = (index: number) => wide ? u64(b, stco.payload + 8 + 8 * index) : u32(b, stco.payload + 8 + 4 * index);
    const runs = u32(b, stsc.payload + 4);
    const offsets = new Float64Array(count);
    let sample = 0;
    for (let run = 0; run < runs && sample < count; run++) {
        const at = stsc.payload + 8 + 12 * run;
        const first = u32(b, at) - 1;
        const perChunk = u32(b, at + 4);
        const last = run + 1 < runs ? u32(b, at + 12) - 1 : chunks;
        for (let chunk = first; chunk < last && chunk < chunks && sample < count; chunk++) {
            let offset = chunkOffset(chunk);
            for (let i = 0; i < perChunk && sample < count; i++, sample++) {
                offsets[sample] = offset;
                offset += sizes[sample];
            }
        }
    }
    if (sample < count) return null;

    const times = new Float64Array(count);
    let time = 0;
    sample = 0;
    for (let entry = 0, entries = u32(b, stts.payload + 4); entry < entries && sample < count; entry++) {
        const n = u32(b, stts.payload + 8 + 8 * entry);
        const delta = u32(b, stts.payload + 12 + 8 * entry);
        for (let i = 0; i < n && sample < count; i++, sample++) { times[sample] = time; time += delta; }
    }
    for (; sample < count; sample++) { times[sample] = time; time += AAC_FRAME_SAMPLES; }
    return { offsets, sizes, times, end: time };
}

/** Seconds to add to a media time for its place in the presentation: an empty edit's delay, less the samples an edit skips (AAC priming). */
function editShift(b: Uint8Array, edts: Box | undefined, movieTimescale: number, mediaTimescale: number): number {
    const elst = childOf(b, edts, "elst");
    if (!elst) return 0;
    const wide = b[elst.payload] === 1;
    const step = wide ? 20 : 12;
    let delay = 0;
    for (let entry = 0, entries = u32(b, elst.payload + 4); entry < entries; entry++) {
        const at = elst.payload + 8 + step * entry;
        const duration = wide ? u64(b, at) : u32(b, at);
        const mediaTime = wide ? u64(b, at + 8) : u32(b, at + 4);
        const empty = wide ? mediaTime >= 2 ** 63 : mediaTime === 0xffffffff;
        if (empty) { delay += duration / (movieTimescale || 1); continue; }
        return delay - mediaTime / mediaTimescale;
    }
    return delay;
}

/** Reads the `moov` box, wherever it is: phones often write it after the media data. */
async function readMoov(blob: Blob): Promise<Uint8Array | null> {
    let first = true;
    for (let at = 0; at + 8 <= blob.size;) {
        const head = await readRange(blob, at, at + 16);
        let size = u32(head, 0);
        const type = ascii(head, 4, 4);
        if (first && !["ftyp", "moov", "mdat", "free", "skip", "wide", "pnot"].includes(type)) return null;
        first = false;
        if (size === 1) size = u64(head, 8);
        else if (size === 0) size = blob.size - at;
        if (size < 8) return null;
        if (type === "moov") return size > 256 * 1024 * 1024 ? null : readRange(blob, at, at + size);
        at += size;
    }
    return null;
}

/** The sound of an MP4, MOV or M4A file as pieces of about a minute, or null when this reader cannot pass it on. */
export async function indexMp4(blob: Blob, pieceSeconds = PIECE_SECONDS): Promise<AudioIndex | null> {
    const b = await readMoov(blob);
    if (!b) return null;
    const moov = boxes(b, 0, b.length)[0];
    if (!moov || moov.type !== "moov" || childOf(b, moov, "mvex")) return null;
    const mvhd = childOf(b, moov, "mvhd");
    const movieTimescale = mvhd ? (b[mvhd.payload] === 1 ? u32(b, mvhd.payload + 20) : u32(b, mvhd.payload + 12)) : 0;
    const track = audioTrack(b, moov);
    if (!track) return null;
    const samples = readSamples(b, track.stbl);
    if (!samples) return null;
    const shift = editShift(b, track.edts, movieTimescale, track.timescale);
    const seconds = (mediaTime: number) => mediaTime / track.timescale + shift;
    const { codec } = track;

    const pieces: AudioPiece[] = [];
    const count = samples.sizes.length;
    for (let first = 0; first < count;) {
        let last = first + 1;
        while (last < count && samples.times[last] - samples.times[first] < pieceSeconds * track.timescale) last++;
        const from = first;
        const to = last;
        const end = to < count ? samples.times[to] : samples.end;
        pieces.push({
            start: seconds(samples.times[from]),
            duration: (end - samples.times[from]) / track.timescale,
            read: async () => {
                const parts: Uint8Array[] = [];
                // In a video the audio sits between stretches of picture: read spans of up to 16 MB,
                // each holding many audio chunks, rather than one read per chunk.
                for (let i = from; i < to;) {
                    const spanStart = samples.offsets[i];
                    let spanEnd = spanStart + samples.sizes[i];
                    let j = i + 1;
                    for (; j < to; j++) {
                        const end = samples.offsets[j] + samples.sizes[j];
                        if (samples.offsets[j] < spanStart || end - spanStart > SPAN_BYTES) break;
                        spanEnd = Math.max(spanEnd, end);
                    }
                    const span = await readRange(blob, spanStart, spanEnd);
                    for (let k = i; k < j; k++) {
                        const frame = span.subarray(samples.offsets[k] - spanStart, samples.offsets[k] - spanStart + samples.sizes[k]);
                        if (codec.kind === "aac") parts.push(adtsHeader(codec.config, frame.length));
                        parts.push(frame);
                    }
                    i = j;
                }
                return concat(parts);
            },
        });
        first = last;
    }
    return { container: "MP4", durationSeconds: Math.max(0, seconds(samples.end)), pieces };
}
