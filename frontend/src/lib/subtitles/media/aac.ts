/**
 * AAC frames as ADTS, the self-describing AAC stream every browser's
 * decodeAudioData reads. An MP4 or Matroska file stores bare AAC frames and
 * one AudioSpecificConfig for the track; a seven-byte ADTS header in front of
 * each frame carries what the decoder needs from that config, so any run of
 * frames can be decoded on its own.
 */

export interface AacConfig {
    /** The core object type ADTS can name: 1 Main, 2 LC, 3 SSR, 4 LTP. HE-AAC's SBR is found by the decoder. */
    objectType: number;
    /** Index into the standard rate table, 0–12. */
    frequencyIndex: number;
    sampleRate: number;
    /** 1–7; 0 would need a program config element, which ADTS cannot carry here. */
    channels: number;
}

const RATES = [96000, 88200, 64000, 48000, 44100, 32000, 24000, 22050, 16000, 12000, 11025, 8000, 7350];

/** Reads an AudioSpecificConfig; null for configs ADTS cannot express. */
export function parseAudioSpecificConfig(bytes: Uint8Array): AacConfig | null {
    let bit = 0;
    const read = (count: number) => {
        let value = 0;
        for (let i = 0; i < count; i++, bit++) {
            if (bit >> 3 >= bytes.length) throw new RangeError("AudioSpecificConfig is cut short");
            value = (value << 1) | ((bytes[bit >> 3] >> (7 - (bit & 7))) & 1);
        }
        return value;
    };
    const objectType = () => { const type = read(5); return type === 31 ? 32 + read(6) : type; };
    try {
        let type = objectType();
        const frequencyIndex = read(4);
        if (frequencyIndex === 15) return null;
        const channels = read(4);
        // HE-AAC (SBR, 5) and HE-AACv2 (PS, 29) name the extension rate, then the core type.
        if (type === 5 || type === 29) {
            if (read(4) === 15) read(24);
            type = objectType();
        }
        if (type < 1 || type > 4 || frequencyIndex > 12 || channels < 1 || channels > 7) return null;
        return { objectType: type, frequencyIndex, sampleRate: RATES[frequencyIndex], channels };
    } catch {
        return null;
    }
}

/** A seven-byte ADTS header (no CRC) for a frame of `payloadLength` bytes. */
export function adtsHeader(config: AacConfig, payloadLength: number): Uint8Array {
    const length = payloadLength + 7;
    return Uint8Array.of(
        0xff,
        0xf1,
        ((config.objectType - 1) << 6) | (config.frequencyIndex << 2) | (config.channels >> 2),
        ((config.channels & 3) << 6) | (length >> 11),
        (length >> 3) & 0xff,
        ((length & 7) << 5) | 0x1f,
        0xfc,
    );
}

/** Samples in one AAC frame at the core rate. */
export const AAC_FRAME_SAMPLES = 1024;
