/**
 * The sound of a WebM or Matroska (MKV) file, read block by block.
 *
 * The clusters are walked once, reading only element headers and the first
 * bytes of each block, to find the audio track's blocks and their times.
 * A piece is then a small Matroska stream of its own: the original EBML
 * DocType, timecode scale and audio track entry, and the original audio
 * blocks inside clusters with their original timecodes, all copied byte for
 * byte. So any codec the browser can decode from Matroska (Opus, Vorbis,
 * AAC) decodes from a piece, without this reader knowing the codec.
 */
import { concat, WindowedReader } from "./bytes";
import { NoSoundTrack, PIECE_SECONDS, type AudioIndex, type AudioPiece } from "./types";

const ID = {
    EBML: 0x1a45dfa3, DocType: 0x4282,
    Segment: 0x18538067, SeekHead: 0x114d9b74, Info: 0x1549a966, Tracks: 0x1654ae6b, Cluster: 0x1f43b675,
    Cues: 0x1c53bb6b, Chapters: 0x1043a770, Tags: 0x1254c367, Attachments: 0x1941a469,
    TimecodeScale: 0x2ad7b1, Duration: 0x4489,
    TrackEntry: 0xae, TrackNumber: 0xd7, TrackType: 0x83, FlagEnabled: 0xb9,
    Timecode: 0xe7, SimpleBlock: 0xa3, BlockGroup: 0xa0, Block: 0xa1,
} as const;

/** Elements that end a cluster written without a size, as live recordings write them. */
const TOP_LEVEL = new Set<number>([ID.Cluster, ID.Cues, ID.Chapters, ID.Tags, ID.Attachments, ID.SeekHead, ID.Info, ID.Tracks]);

interface Header { id: number; size: number | null; data: number; end: number | null }

function vintLength(first: number): number {
    for (let i = 0; i < 8; i++) if (first & (0x80 >> i)) return i + 1;
    return 0;
}

/** An element's ID and size from bytes at `at`; size null when unknown (all ones). */
function parseHeader(b: Uint8Array, at: number, position: number): Header | null {
    const idLength = vintLength(b[at]);
    if (!idLength || idLength > 4 || at + idLength >= b.length) return null;
    let id = 0;
    for (let i = 0; i < idLength; i++) id = id * 256 + b[at + i];
    const sizeLength = vintLength(b[at + idLength]);
    if (!sizeLength || at + idLength + sizeLength > b.length) return null;
    let size = b[at + idLength] & (0xff >> sizeLength);
    let unknown = size === 0xff >> sizeLength;
    for (let i = 1; i < sizeLength; i++) {
        const byte = b[at + idLength + i];
        size = size * 256 + byte;
        if (byte !== 0xff) unknown = false;
    }
    const data = position + idLength + sizeLength;
    return { id, size: unknown ? null : size, data, end: unknown ? null : data + size };
}

async function headerAt(reader: WindowedReader, position: number): Promise<Header | null> {
    if (position >= reader.size) return null;
    return parseHeader(await reader.bytes(position, 12), 0, position);
}

/** The unsigned integer stored in an element's data. */
function uint(b: Uint8Array): number {
    let value = 0;
    for (const byte of b) value = value * 256 + byte;
    return value;
}

/** Child elements of a small element already in memory. */
function children(b: Uint8Array): { id: number; bytes: Uint8Array; whole: Uint8Array }[] {
    const out: { id: number; bytes: Uint8Array; whole: Uint8Array }[] = [];
    for (let at = 0; at < b.length;) {
        const header = parseHeader(b, at, at);
        if (!header || header.end === null || header.end > b.length) break;
        out.push({ id: header.id, bytes: b.subarray(header.data, header.end), whole: b.subarray(at, header.end) });
        at = header.end;
    }
    return out;
}

/** An EBML element with an eight-byte size, which every Matroska reader takes. */
function element(id: number, body: readonly Uint8Array[]): Uint8Array[] {
    const idBytes: number[] = [];
    for (let rest = id; rest > 0; rest = Math.floor(rest / 256)) idBytes.unshift(rest & 0xff);
    let size = body.reduce((sum, part) => sum + part.length, 0);
    const sizeBytes = new Uint8Array(8);
    sizeBytes[0] = 0x01;
    for (let i = 7; i >= 1; i--) { sizeBytes[i] = size & 0xff; size = Math.floor(size / 256); }
    return [Uint8Array.from(idBytes), sizeBytes, ...body];
}

function uintBytes(value: number): Uint8Array {
    const out: number[] = [];
    for (let rest = value; rest > 0 || !out.length; rest = Math.floor(rest / 256)) out.unshift(rest & 0xff);
    return Uint8Array.from(out);
}

const stringBytes = (value: string) => Uint8Array.from(value, character => character.charCodeAt(0) & 0xff);

interface AudioBlock { start: number; end: number; clusterTimecode: number; time: number }

/** A block's track number and its timecode relative to the cluster, from the start of its data. */
function blockTrack(b: Uint8Array): { track: number; timecode: number } | null {
    const length = vintLength(b[0]);
    if (!length || length > 8 || length + 2 > b.length) return null;
    let track = b[0] & (0xff >> length);
    for (let i = 1; i < length; i++) track = track * 256 + b[i];
    const timecode = ((b[length] << 8) | b[length + 1]) << 16 >> 16;
    return { track, timecode };
}

/**
 * The sound of a WebM or MKV file as pieces of about a minute, or null when
 * it is not one or has no audio track. `onRead` hears how far through the
 * file the walk is, in bytes.
 */
export async function indexMatroska(blob: Blob, { pieceSeconds = PIECE_SECONDS, onRead }: { pieceSeconds?: number; onRead?: (bytes: number) => void } = {}): Promise<AudioIndex | null> {
    const reader = new WindowedReader(blob);
    const ebml = await headerAt(reader, 0);
    if (!ebml || ebml.id !== ID.EBML || ebml.end === null) return null;
    const docType = children(await reader.bytes(ebml.data, ebml.size!)).find(child => child.id === ID.DocType);
    const segment = await headerAt(reader, ebml.end);
    if (!segment || segment.id !== ID.Segment) return null;
    const segmentEnd = Math.min(segment.end ?? blob.size, blob.size);

    let timecodeScale = 1_000_000;
    let durationTicks: number | null = null;
    let track: { number: number; entry: Uint8Array } | null = null;
    const blocks: AudioBlock[] = [];

    for (let at = segment.data; at < segmentEnd;) {
        const header = await headerAt(reader, at);
        if (!header) break;
        if (header.id === ID.Cluster) {
            const clusterEnd = Math.min(header.end ?? segmentEnd, segmentEnd);
            let clusterTimecode = 0;
            let child = header.data;
            while (child < clusterEnd) {
                const inner = await headerAt(reader, child);
                // A recording cut off mid-block ends at the last whole one.
                if (!inner || inner.end === null || inner.end > blob.size) break;
                // A cluster of unknown size ends where the next top-level element begins.
                if (header.end === null && TOP_LEVEL.has(inner.id)) break;
                if (inner.id === ID.Timecode) clusterTimecode = uint(await reader.bytes(inner.data, inner.size!));
                else if (track && (inner.id === ID.SimpleBlock || inner.id === ID.BlockGroup)) {
                    let blockData = inner.data;
                    if (inner.id === ID.BlockGroup) {
                        const block = await headerAt(reader, inner.data);
                        blockData = block?.id === ID.Block ? block.data : -1;
                    }
                    const found = blockData >= 0 ? blockTrack(await reader.bytes(blockData, 10)) : null;
                    if (found?.track === track.number) {
                        blocks.push({ start: child, end: inner.end, clusterTimecode, time: clusterTimecode + found.timecode });
                    }
                }
                child = inner.end;
            }
            at = child;
            onRead?.(at);
            continue;
        }
        if (header.end === null) break;
        if (header.id === ID.Info) {
            for (const item of children(await reader.bytes(header.data, header.size!))) {
                if (item.id === ID.TimecodeScale) timecodeScale = uint(item.bytes) || timecodeScale;
                if (item.id === ID.Duration) {
                    const view = new DataView(item.bytes.buffer, item.bytes.byteOffset, item.bytes.length);
                    durationTicks = item.bytes.length === 4 ? view.getFloat32(0) : item.bytes.length === 8 ? view.getFloat64(0) : null;
                }
            }
        } else if (header.id === ID.Tracks) {
            const entries = children(await reader.bytes(header.data, header.size!)).filter(child => child.id === ID.TrackEntry);
            const audio = entries.map(entry => {
                const fields = children(entry.bytes);
                const value = (id: number) => fields.find(field => field.id === id);
                return {
                    number: uint(value(ID.TrackNumber)?.bytes ?? new Uint8Array()),
                    audio: uint(value(ID.TrackType)?.bytes ?? new Uint8Array()) === 2,
                    enabled: !value(ID.FlagEnabled) || uint(value(ID.FlagEnabled)!.bytes) === 1,
                    entry: entry.whole.slice(),
                };
            }).filter(entry => entry.audio && entry.number > 0);
            const chosen = audio.find(entry => entry.enabled) ?? audio[0];
            if (!chosen) throw new NoSoundTrack();
            track = { number: chosen.number, entry: chosen.entry };
        }
        at = header.end;
    }
    if (!track) return null;
    // An audio track that holds no blocks has nothing to hear.
    if (!blocks.length) throw new NoSoundTrack();

    const seconds = (ticks: number) => (ticks * timecodeScale) / 1e9;
    const lastStep = blocks.length > 1 ? blocks[blocks.length - 1].time - blocks[blocks.length - 2].time : 0;
    const endTicks = Math.max(durationTicks ?? 0, blocks[blocks.length - 1].time + lastStep);
    const head = [
        ...element(ID.EBML, [
            ...element(0x4286, [uintBytes(1)]), ...element(0x42f7, [uintBytes(1)]), ...element(0x42f2, [uintBytes(4)]),
            ...element(0x42f3, [uintBytes(8)]), ...element(ID.DocType, [docType?.bytes.slice() ?? stringBytes("matroska")]),
            ...element(0x4287, [uintBytes(4)]), ...element(0x4285, [uintBytes(2)]),
        ]),
    ];
    const info = element(ID.Info, element(ID.TimecodeScale, [uintBytes(timecodeScale)]));
    const tracks = element(ID.Tracks, [track.entry]);

    const pieces: AudioPiece[] = [];
    for (let first = 0; first < blocks.length;) {
        let last = first + 1;
        while (last < blocks.length && seconds(blocks[last].time - blocks[first].time) < pieceSeconds) last++;
        const group = blocks.slice(first, last);
        const end = last < blocks.length ? blocks[last].time : endTicks;
        pieces.push({
            start: seconds(group[0].time),
            duration: seconds(end - group[0].time),
            read: async () => {
                // Read spans of at most 16 MB, so a piece's video around it is never held whole.
                const copies: Uint8Array[] = [];
                for (let i = 0; i < group.length;) {
                    let j = i + 1;
                    while (j < group.length && group[j].end - group[i].start <= 16 * 1024 * 1024) j++;
                    const span = new Uint8Array(await blob.slice(group[i].start, group[j - 1].end).arrayBuffer());
                    for (let k = i; k < j; k++) copies.push(span.slice(group[k].start - group[i].start, group[k].end - group[i].start));
                    i = j;
                }
                const clusters: Uint8Array[] = [];
                for (let i = 0; i < group.length;) {
                    let j = i + 1;
                    while (j < group.length && group[j].clusterTimecode === group[i].clusterTimecode) j++;
                    clusters.push(...element(ID.Cluster, [...element(ID.Timecode, [uintBytes(group[i].clusterTimecode)]), ...copies.slice(i, j)]));
                    i = j;
                }
                return concat([...head, ...element(ID.Segment, [...info, ...tracks, ...clusters])]);
            },
        });
        first = last;
    }
    return { container: "Matroska", durationSeconds: seconds(endTicks), pieces };
}
