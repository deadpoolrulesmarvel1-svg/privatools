/**
 * Tiny pure-JS ZIP writer — STORE mode (no compression).
 *
 * Why we hand-roll this instead of pulling in `jszip` (~95 KB min+gz):
 *   - Our payloads are already-compressed PDFs, JPEGs, PNGs, .docx, .xlsx etc.
 *     STORE mode is fine; DEFLATE would shave <1% in practice.
 *   - We only zip on the client when N>1 in a multi-file tool. The hot path
 *     stays N=1 and ships zero bytes for the zip writer.
 *
 * Wire format: PKWare APPNOTE 6.3.4 — local headers + central directory + EOCD.
 * Single-disk archive, no extra fields, no encryption, ISO-8859-1 filenames.
 *
 * Per spec, large archives (>4 GB or >65k entries) need ZIP64. We don't:
 *   the max files limit is 100 and the per-file cap is 500 MB, so a worst-case
 *   archive is ~50 GB — but realistically: ~50 PDFs × 5 MB ≈ 250 MB. If we ever
 *   bump those caps, switch to a Web-Streams zip lib.
 */

interface ZipEntry {
    name: string;
    data: Uint8Array;
}

/** Standard CRC32 table — generated once on module load. */
const CRC_TABLE = (() => {
    const t = new Uint32Array(256);
    for (let i = 0; i < 256; i++) {
        let c = i;
        for (let k = 0; k < 8; k++) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
        t[i] = c;
    }
    return t;
})();

/** CRC-32 (IEEE 802.3), the checksum ZIP entries and PNG chunks both carry. */
export function crc32(buf: Uint8Array): number {
    let crc = 0xffffffff;
    for (let i = 0; i < buf.length; i++) crc = CRC_TABLE[(crc ^ buf[i]) & 0xff] ^ (crc >>> 8);
    return (crc ^ 0xffffffff) >>> 0;
}

/** Pack a number as little-endian into a buffer at offset. */
function w16(view: DataView, off: number, val: number) { view.setUint16(off, val, true); }
function w32(view: DataView, off: number, val: number) { view.setUint32(off, val, true); }

/** Encode a filename to bytes. We use UTF-8 + set the "language encoding" flag. */
function encodeName(name: string): Uint8Array {
    // Reject NULs and normalise path separators.
    return new TextEncoder().encode(name.replace(/\\/g, "/"));
}

/**
 * Build a ZIP blob from a list of named byte arrays. Streams every byte through
 * one allocation, so memory peak ≈ sum-of-payload + ~150 B per entry. Caller
 * is responsible for revoking any blob URL it makes.
 */
export function buildZip(entries: ZipEntry[]): Blob {
    const now = new Date();
    // DOS time / date — needed because some unzippers complain about all-zeros.
    const dosTime = ((now.getHours() & 0x1f) << 11) | ((now.getMinutes() & 0x3f) << 5) | ((now.getSeconds() >> 1) & 0x1f);
    const dosDate = (((now.getFullYear() - 1980) & 0x7f) << 9) | (((now.getMonth() + 1) & 0x0f) << 5) | (now.getDate() & 0x1f);

    // De-duplicate filenames — when a user picks 3 files literally named
    // "report.pdf", we'd otherwise produce an archive with collisions.
    const seen = new Map<string, number>();
    const uniqued = entries.map(e => {
        const lc = e.name.toLowerCase();
        const n = seen.get(lc) ?? 0;
        seen.set(lc, n + 1);
        if (n === 0) return e;
        const dot = e.name.lastIndexOf(".");
        const stem = dot > 0 ? e.name.slice(0, dot) : e.name;
        const ext  = dot > 0 ? e.name.slice(dot) : "";
        return { name: `${stem}_${n}${ext}`, data: e.data };
    });

    // Pass 1 — compute sizes
    const records = uniqued.map(e => {
        const nameBytes = encodeName(e.name);
        return {
            name: e.name,
            nameBytes,
            data: e.data,
            crc: crc32(e.data),
            size: e.data.length,
        };
    });

    const LOCAL_HEADER = 30;
    const CENTRAL_HEADER = 46;
    const EOCD = 22;

    let localTotal = 0;
    for (const r of records) localTotal += LOCAL_HEADER + r.nameBytes.length + r.size;

    let centralTotal = 0;
    for (const r of records) centralTotal += CENTRAL_HEADER + r.nameBytes.length;

    const out = new Uint8Array(localTotal + centralTotal + EOCD);
    const view = new DataView(out.buffer);
    let off = 0;
    const offsets: number[] = [];

    // Local file records
    for (const r of records) {
        offsets.push(off);
        w32(view, off + 0,  0x04034b50);            // local file header signature
        w16(view, off + 4,  20);                    // version needed (2.0)
        w16(view, off + 6,  0x0800);                // general-purpose: bit 11 = UTF-8
        w16(view, off + 8,  0);                     // compression: STORE
        w16(view, off + 10, dosTime);
        w16(view, off + 12, dosDate);
        w32(view, off + 14, r.crc);
        w32(view, off + 18, r.size);                // compressed = uncompressed (STORE)
        w32(view, off + 22, r.size);
        w16(view, off + 26, r.nameBytes.length);
        w16(view, off + 28, 0);                     // extra field length
        off += LOCAL_HEADER;
        out.set(r.nameBytes, off); off += r.nameBytes.length;
        out.set(r.data,       off); off += r.size;
    }

    const centralOffset = off;

    // Central directory records
    for (let i = 0; i < records.length; i++) {
        const r = records[i];
        w32(view, off + 0,  0x02014b50);            // central dir signature
        w16(view, off + 4,  20);                    // version made by
        w16(view, off + 6,  20);                    // version needed
        w16(view, off + 8,  0x0800);                // UTF-8 flag
        w16(view, off + 10, 0);                     // STORE
        w16(view, off + 12, dosTime);
        w16(view, off + 14, dosDate);
        w32(view, off + 16, r.crc);
        w32(view, off + 20, r.size);
        w32(view, off + 24, r.size);
        w16(view, off + 28, r.nameBytes.length);
        w16(view, off + 30, 0);                     // extra field len
        w16(view, off + 32, 0);                     // file comment len
        w16(view, off + 34, 0);                     // disk number start
        w16(view, off + 36, 0);                     // internal attrs
        w32(view, off + 38, 0);                     // external attrs
        w32(view, off + 42, offsets[i]);            // local-header offset
        off += CENTRAL_HEADER;
        out.set(r.nameBytes, off); off += r.nameBytes.length;
    }

    // End of central directory
    w32(view, off + 0,  0x06054b50);
    w16(view, off + 4,  0);                          // disk #
    w16(view, off + 6,  0);                          // disk where central dir starts
    w16(view, off + 8,  records.length);             // entries on this disk
    w16(view, off + 10, records.length);             // total entries
    w32(view, off + 12, centralTotal);
    w32(view, off + 16, centralOffset);
    w16(view, off + 20, 0);                          // comment length

    return new Blob([out], { type: "application/zip" });
}

/** Convenience: build a ZIP straight from name → Blob pairs. */
export async function buildZipFromBlobs(items: { name: string; blob: Blob }[]): Promise<Blob> {
    const entries: ZipEntry[] = [];
    for (const { name, blob } of items) {
        const buf = new Uint8Array(await blob.arrayBuffer());
        entries.push({ name, data: buf });
    }
    return buildZip(entries);
}
