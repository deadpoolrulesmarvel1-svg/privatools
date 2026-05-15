/**
 * Per-tool illustrations — small SVGs that show what each top tool actually
 * does, replacing the generic icon-tile on the tool-page hero.
 *
 * Anything without a custom illustration falls back to the tool's Lucide
 * icon inside the standard category-tinted tile.
 *
 * All illustrations:
 *   - Render in 96×96 (sm) / 112×112 (lg) box.
 *   - Use currentColor for accents so they re-tint with the surrounding
 *     `cat-*` class on the parent.
 */
import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

interface ToolIllustrationProps {
    slug: string;
    fallback: LucideIcon;
    /** category css class (e.g. "cat-organize") — drives the accent color */
    catClass?: string;
    size?: "sm" | "lg";
}

const SIZE_PX: Record<NonNullable<ToolIllustrationProps["size"]>, number> = { sm: 56, lg: 96 };

export function ToolIllustration({ slug, fallback: Fallback, catClass, size = "lg" }: ToolIllustrationProps) {
    const px = SIZE_PX[size];
    const Renderer = REGISTRY[slug];
    return (
        <div
            className={cn(
                "inline-flex items-center justify-center rounded-2xl animate-scale-in",
                "bg-[hsl(var(--tile,var(--accent))/0.10)] border border-[hsl(var(--tile,var(--accent))/0.20)]",
                "transition-shadow hover:shadow-[0_8px_24px_-8px_hsl(var(--tile,var(--accent))/0.55)]",
                size === "lg" ? "h-[112px] w-[112px]" : "h-[64px] w-[64px]",
                catClass
            )}
            style={{ color: "hsl(var(--tile, var(--accent)))" }}
            aria-hidden="true"
        >
            {Renderer ? <Renderer size={px} /> : <Fallback size={size === "lg" ? 36 : 24} strokeWidth={1.6} />}
        </div>
    );
}

// ── Shared SVG primitives ───────────────────────────────────────────────

function DocPath({ x = 16, y = 8, w = 64, h = 80, fold = 16 }) {
    // Returns a "page with a folded corner" path.
    return (
        <path
            d={`M${x} ${y} h${w - fold} l${fold} ${fold} v${h - fold} h${-w} z`}
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinejoin="round"
        />
    );
}

function DocLines({ x = 24, y = 28, count = 4, gap = 9, lengths = [40, 32, 44, 28], opacity = 0.5 }) {
    return (
        <g stroke="currentColor" strokeWidth="2" strokeLinecap="round" opacity={opacity}>
            {Array.from({ length: count }).map((_, i) => (
                <line key={i} x1={x} y1={y + i * gap} x2={x + (lengths[i] ?? lengths[0])} y2={y + i * gap} />
            ))}
        </g>
    );
}

// ── Per-tool illustrations ──────────────────────────────────────────────

const Merge = ({ size }: { size: number }) => (
    <svg viewBox="0 0 96 96" width={size} height={size}>
        {/* two stacked source docs with offset */}
        <g transform="translate(0,-4)">
            <DocPath x={6} y={10} w={52} h={66} fold={12} />
            <DocLines x={14} y={28} count={3} gap={9} lengths={[32, 24, 36]} />
        </g>
        <g transform="translate(8,12)">
            <rect x={28} y={8} width={52} height={66} rx={3} fill="hsl(var(--card))" stroke="currentColor" strokeWidth="2" />
            <DocLines x={36} y={26} count={3} gap={9} lengths={[36, 28, 40]} />
        </g>
        {/* arrow in the middle */}
        <g transform="translate(48,72)">
            <circle r="9" fill="currentColor" opacity="0.10" />
            <path d="M-5 0 L0 5 L5 0 M0 -5 L0 5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        </g>
    </svg>
);

const Compress = ({ size }: { size: number }) => (
    <svg viewBox="0 0 96 96" width={size} height={size}>
        <DocPath x={20} y={14} w={56} h={68} />
        <DocLines x={28} y={30} count={3} gap={8} lengths={[40, 30, 36]} />
        {/* shrinking arrows on the corners pointing inward */}
        <g stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" fill="none">
            <path d="M10 10 L24 24 M10 14 L10 10 L14 10" />
            <path d="M86 10 L72 24 M82 10 L86 10 L86 14" />
            <path d="M10 86 L24 72 M14 86 L10 86 L10 82" />
            <path d="M86 86 L72 72 M82 86 L86 86 L86 82" />
        </g>
    </svg>
);

const Rotate = ({ size }: { size: number }) => (
    <svg viewBox="0 0 96 96" width={size} height={size}>
        {/* rotated doc */}
        <g transform="rotate(-25 48 48)">
            <DocPath x={20} y={14} w={56} h={68} />
            <DocLines x={28} y={30} count={3} gap={8} lengths={[40, 30, 36]} />
        </g>
        {/* rotation arc */}
        <g fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
            <path d="M14 60 a 34 34 0 1 0 12 -22" />
            <path d="M28 30 L26 38 L34 38" strokeLinejoin="round" />
        </g>
    </svg>
);

const Split = ({ size }: { size: number }) => (
    <svg viewBox="0 0 96 96" width={size} height={size}>
        {/* left half */}
        <DocPath x={6} y={10} w={36} h={72} fold={10} />
        <DocLines x={12} y={28} count={4} gap={9} lengths={[24, 18, 22, 16]} />
        {/* right half */}
        <DocPath x={54} y={10} w={36} h={72} fold={10} />
        <DocLines x={60} y={28} count={4} gap={9} lengths={[24, 18, 22, 16]} />
        {/* dashed cut line */}
        <line x1="48" y1="6" x2="48" y2="90"
            stroke="currentColor" strokeWidth="2" strokeDasharray="3 4" opacity="0.6" />
        {/* tiny scissors */}
        <g transform="translate(48 4)" fill="currentColor">
            <circle r="3" />
        </g>
    </svg>
);

const Sign = ({ size }: { size: number }) => (
    <svg viewBox="0 0 96 96" width={size} height={size}>
        <DocPath x={14} y={12} w={68} h={72} />
        <DocLines x={22} y={26} count={3} gap={8} lengths={[48, 36, 44]} />
        {/* signature line */}
        <line x1="22" y1="62" x2="74" y2="62" stroke="currentColor" strokeWidth="1.5" opacity="0.4" />
        {/* signature script */}
        <path d="M26 70 q 6 -10 12 0 t 12 0 q 4 -6 10 0 q 4 4 8 -2"
            fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
    </svg>
);

const Watermark = ({ size }: { size: number }) => (
    <svg viewBox="0 0 96 96" width={size} height={size}>
        <DocPath x={14} y={12} w={68} h={72} />
        <DocLines x={22} y={26} count={4} gap={8} lengths={[48, 36, 44, 30]} opacity={0.35} />
        {/* diagonal "DRAFT" stamp */}
        <g transform="rotate(-22 48 56)">
            <rect x={20} y={48} width={56} height={18} rx={2} fill="none" stroke="currentColor" strokeWidth="2" opacity="0.7" />
            <text x={48} y={62} textAnchor="middle" fontFamily="monospace" fontSize="11" fontWeight="700"
                fill="currentColor" opacity="0.8">DRAFT</text>
        </g>
    </svg>
);

const Convert = ({ size }: { size: number }) => (
    <svg viewBox="0 0 96 96" width={size} height={size}>
        {/* source doc */}
        <DocPath x={4} y={14} w={36} h={68} fold={8} />
        <text x={22} y={56} textAnchor="middle" fontFamily="monospace" fontSize="9" fontWeight="700" fill="currentColor" opacity="0.7">PDF</text>
        {/* arrow */}
        <g transform="translate(48 48)">
            <line x1="-6" y1="0" x2="6" y2="0" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
            <path d="M3 -4 L7 0 L3 4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        </g>
        {/* target doc */}
        <DocPath x={56} y={14} w={36} h={68} fold={8} />
        <text x={74} y={56} textAnchor="middle" fontFamily="monospace" fontSize="9" fontWeight="700" fill="currentColor" opacity="0.7">DOC</text>
    </svg>
);

const Ocr = ({ size }: { size: number }) => (
    <svg viewBox="0 0 96 96" width={size} height={size}>
        <DocPath x={10} y={10} w={62} h={70} />
        <DocLines x={18} y={24} count={4} gap={8} lengths={[40, 30, 38, 28]} opacity={0.4} />
        {/* magnifying glass with text inside */}
        <g transform="translate(58 56)">
            <circle r="18" fill="hsl(var(--card))" stroke="currentColor" strokeWidth="2.5" />
            <text x={0} y={4} textAnchor="middle" fontFamily="monospace" fontSize="11" fontWeight="700" fill="currentColor">A</text>
            <line x1="14" y1="14" x2="26" y2="26" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
        </g>
    </svg>
);

const Highlight = ({ size }: { size: number }) => (
    <svg viewBox="0 0 96 96" width={size} height={size}>
        <DocPath x={14} y={12} w={68} h={72} />
        <DocLines x={22} y={26} count={4} gap={9} lengths={[44, 32, 40, 28]} opacity={0.35} />
        {/* highlight band */}
        <rect x={20} y={42} width={48} height={9} fill="currentColor" opacity="0.40" rx="1" />
        <rect x={20} y={42} width={48} height={9} fill="none" stroke="currentColor" strokeWidth="1" opacity="0.6" rx="1" />
    </svg>
);

const Lock = ({ size }: { size: number }) => (
    <svg viewBox="0 0 96 96" width={size} height={size}>
        <DocPath x={14} y={12} w={68} h={72} />
        <DocLines x={22} y={26} count={3} gap={9} lengths={[40, 28, 36]} opacity={0.35} />
        {/* lock */}
        <g transform="translate(48 60)">
            <rect x={-12} y={-2} width={24} height={20} rx={2} fill="hsl(var(--card))" stroke="currentColor" strokeWidth="2.5" />
            <path d="M-7 -2 v -6 a 7 7 0 0 1 14 0 v 6" fill="none" stroke="currentColor" strokeWidth="2.5" />
            <circle cx={0} cy={9} r={2} fill="currentColor" />
        </g>
    </svg>
);

const Unlock = ({ size }: { size: number }) => (
    <svg viewBox="0 0 96 96" width={size} height={size}>
        <DocPath x={14} y={12} w={68} h={72} />
        <DocLines x={22} y={26} count={3} gap={9} lengths={[40, 28, 36]} opacity={0.35} />
        {/* open lock */}
        <g transform="translate(48 60)">
            <rect x={-12} y={-2} width={24} height={20} rx={2} fill="hsl(var(--card))" stroke="currentColor" strokeWidth="2.5" />
            <path d="M-7 -2 v -6 a 7 7 0 0 1 14 0" fill="none" stroke="currentColor" strokeWidth="2.5" />
            <circle cx={0} cy={9} r={2} fill="currentColor" />
        </g>
    </svg>
);

const Summarize = ({ size }: { size: number }) => (
    <svg viewBox="0 0 96 96" width={size} height={size}>
        {/* source doc with many lines */}
        <DocPath x={6} y={10} w={36} h={72} fold={8} />
        <DocLines x={12} y={22} count={6} gap={7} lengths={[26, 20, 24, 22, 26, 18]} opacity={0.5} />
        {/* arrow */}
        <g transform="translate(48 46)">
            <line x1="-4" y1="0" x2="4" y2="0" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
            <path d="M1 -4 L5 0 L1 4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        </g>
        {/* destination doc with few lines */}
        <DocPath x={56} y={20} w={34} h={48} fold={8} />
        <DocLines x={62} y={32} count={3} gap={9} lengths={[22, 18, 22]} opacity={0.7} />
        {/* sparkle */}
        <g transform="translate(76 14)" fill="currentColor">
            <path d="M0 -5 L1 -1 L5 0 L1 1 L0 5 L-1 1 L-5 0 L-1 -1 z" />
        </g>
    </svg>
);

// ── Non-PDF illustrations ────────────────────────────────────────────────

const ImageCompress = ({ size }: { size: number }) => (
    <svg viewBox="0 0 96 96" width={size} height={size}>
        {/* image frame */}
        <rect x={14} y={14} width={68} height={68} rx={6} fill="none" stroke="currentColor" strokeWidth="2" />
        {/* mountain & sun */}
        <circle cx={66} cy={32} r={5} fill="currentColor" opacity={0.55} />
        <path d="M18 70 L36 46 L52 62 L66 50 L78 70 Z" fill="currentColor" opacity={0.25} />
        {/* corner-inward arrows */}
        <g stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" fill="none">
            <path d="M8 8 L20 20 M14 8 H8 V14" />
            <path d="M88 8 L76 20 M82 8 H88 V14" />
            <path d="M8 88 L20 76 M14 88 H8 V82" />
            <path d="M88 88 L76 76 M82 88 H88 V82" />
        </g>
    </svg>
);

const RemoveBg = ({ size }: { size: number }) => (
    <svg viewBox="0 0 96 96" width={size} height={size}>
        {/* checker bg = transparency */}
        <g opacity={0.25}>
            {Array.from({ length: 6 }).map((_, r) =>
                Array.from({ length: 6 }).map((_, c) => (
                    (r + c) % 2 === 0 ? <rect key={`${r}-${c}`} x={12 + c * 12} y={12 + r * 12} width={12} height={12} fill="currentColor" /> : null
                ))
            )}
        </g>
        <rect x={12} y={12} width={72} height={72} fill="none" stroke="currentColor" strokeWidth="2" />
        {/* silhouette head + shoulders */}
        <g fill="currentColor">
            <circle cx={48} cy={40} r={11} />
            <path d="M28 80 c0 -14 12 -22 20 -22 s20 8 20 22 z" />
        </g>
    </svg>
);

const VideoToGif = ({ size }: { size: number }) => (
    <svg viewBox="0 0 96 96" width={size} height={size}>
        {/* film strip */}
        <rect x={10} y={20} width={48} height={56} rx={4} fill="none" stroke="currentColor" strokeWidth="2" />
        {[26, 38, 50, 62].map(y => (
            <g key={y}>
                <rect x={6} y={y - 1} width={4} height={4} fill="currentColor" opacity={0.45} />
                <rect x={58} y={y - 1} width={4} height={4} fill="currentColor" opacity={0.45} />
            </g>
        ))}
        {/* play triangle */}
        <path d="M28 38 L42 48 L28 58 Z" fill="currentColor" />
        {/* "GIF" label */}
        <g transform="translate(64 48)">
            <rect x={-4} y={-12} width={26} height={24} rx={4} fill="currentColor" opacity={0.18} />
            <text x={9} y={5} textAnchor="middle" fontSize="11" fontWeight="700" fill="currentColor" fontFamily="ui-sans-serif,system-ui">GIF</text>
        </g>
    </svg>
);

const QrCode = ({ size }: { size: number }) => (
    <svg viewBox="0 0 96 96" width={size} height={size}>
        {/* 3 finder squares */}
        {([[14, 14], [60, 14], [14, 60]] as const).map(([x, y]) => (
            <g key={`${x}-${y}`} stroke="currentColor" strokeWidth="2" fill="none">
                <rect x={x} y={y} width={22} height={22} rx={2} />
                <rect x={x + 7} y={y + 7} width={8} height={8} rx={1} fill="currentColor" />
            </g>
        ))}
        {/* data dots */}
        <g fill="currentColor">
            {[42, 50, 58, 66, 74].map(x => (
                <rect key={`top-${x}`} x={x} y={42} width={5} height={5} opacity={(x % 8 === 2) ? 0.4 : 0.85} />
            ))}
            {[42, 50, 58, 66, 74].map(y => (
                <rect key={`side-${y}`} x={62} y={y} width={5} height={5} opacity={(y % 8 === 2) ? 0.85 : 0.45} />
            ))}
            <rect x={70} y={70} width={5} height={5} />
            <rect x={70} y={62} width={5} height={5} opacity={0.5} />
            <rect x={62} y={62} width={5} height={5} opacity={0.85} />
        </g>
    </svg>
);

const Hash = ({ size }: { size: number }) => (
    <svg viewBox="0 0 96 96" width={size} height={size}>
        {/* angle brackets */}
        <g stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" fill="none">
            <path d="M22 32 L10 48 L22 64" />
            <path d="M74 32 L86 48 L74 64" />
        </g>
        {/* hash */}
        <g stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
            <line x1={38} y1={32} x2={34} y2={64} />
            <line x1={56} y1={32} x2={52} y2={64} />
            <line x1={32} y1={42} x2={60} y2={42} />
            <line x1={30} y1={54} x2={58} y2={54} />
        </g>
    </svg>
);

const Base64 = ({ size }: { size: number }) => (
    <svg viewBox="0 0 96 96" width={size} height={size}>
        <DocPath x={10} y={14} w={32} h={68} fold={6} />
        <DocLines x={16} y={28} count={5} gap={9} lengths={[20, 16, 22, 14, 18]} opacity={0.55} />
        {/* arrow */}
        <g transform="translate(46 48)" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" fill="none">
            <line x1="-4" y1="0" x2="6" y2="0" />
            <path d="M3 -4 L7 0 L3 4" />
        </g>
        {/* output doc with mono ticks */}
        <DocPath x={56} y={14} w={32} h={68} fold={6} />
        <g fontFamily="ui-monospace,monospace" fontSize="7" fill="currentColor">
            <text x={62} y={32}>SGVsbG8</text>
            <text x={62} y={42}>V29ybGQ</text>
            <text x={62} y={52}>UHJpdmE</text>
            <text x={62} y={62}>VG9vbHM</text>
        </g>
    </svg>
);

const PageCounter = ({ size }: { size: number }) => (
    <svg viewBox="0 0 96 96" width={size} height={size}>
        {/* document */}
        <DocPath x={14} y={10} w={56} h={76} />
        <DocLines x={22} y={26} count={4} gap={9} lengths={[34, 26, 36, 22]} opacity={0.4} />
        {/* big page-count badge */}
        <g transform="translate(70 64)">
            <circle cx={0} cy={0} r={18} fill="hsl(var(--card))" stroke="currentColor" strokeWidth="2" />
            <text x={0} y={5} textAnchor="middle" fontSize="16" fontWeight="700" fill="currentColor" fontFamily="ui-sans-serif,system-ui">12</text>
        </g>
    </svg>
);

const MergeMedia = ({ size }: { size: number }) => (
    <svg viewBox="0 0 96 96" width={size} height={size}>
        {/* film/audio strip 1 */}
        <rect x={10} y={20} width={32} height={20} rx={3} fill="none" stroke="currentColor" strokeWidth="2" />
        <g stroke="currentColor" strokeWidth="2" strokeLinecap="round" opacity={0.5}>
            <line x1={16} y1={30} x2={20} y2={30} />
            <line x1={24} y1={26} x2={28} y2={34} />
            <line x1={32} y1={28} x2={36} y2={32} />
        </g>
        {/* film/audio strip 2 */}
        <rect x={10} y={56} width={32} height={20} rx={3} fill="none" stroke="currentColor" strokeWidth="2" />
        <g stroke="currentColor" strokeWidth="2" strokeLinecap="round" opacity={0.5}>
            <line x1={16} y1={66} x2={20} y2={66} />
            <line x1={24} y1={62} x2={28} y2={70} />
            <line x1={32} y1={64} x2={36} y2={68} />
        </g>
        {/* arrow */}
        <g transform="translate(50 48)" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" fill="none">
            <line x1="-4" y1="0" x2="6" y2="0" />
            <path d="M3 -4 L7 0 L3 4" />
        </g>
        {/* merged result */}
        <rect x={60} y={36} width={28} height={24} rx={3} fill="currentColor" opacity={0.85} />
        <g stroke="hsl(var(--card))" strokeWidth="2" strokeLinecap="round">
            <line x1={66} y1={48} x2={70} y2={48} />
            <line x1={74} y1={44} x2={78} y2={52} />
            <line x1={82} y1={46} x2={86} y2={50} />
        </g>
    </svg>
);

// ── Registry ─────────────────────────────────────────────────────────────

type Renderer = (props: { size: number }) => JSX.Element;

const REGISTRY: Record<string, Renderer> = {
    "merge-pdf":      Merge,
    "compress-pdf":   Compress,
    "batch-compress-pdf": Compress,
    "rotate-pdf":     Rotate,
    "split-pdf":      Split,
    "split-by-bookmarks": Split,
    "split-by-size":  Split,
    "split-in-half":  Split,
    "sign-pdf":       Sign,
    "esign-pdf":      Sign,
    "watermark":      Watermark,
    "stamp-pdf":      Watermark,
    "image-watermark": Watermark,
    "image-to-pdf":   Convert,
    "jpg-to-pdf":     Convert,
    "png-to-pdf":     Convert,
    "heic-to-pdf":    Convert,
    "webp-to-pdf":    Convert,
    "tiff-to-pdf":    Convert,
    "bmp-to-pdf":     Convert,
    "gif-to-pdf":     Convert,
    "svg-to-pdf":     Convert,
    "html-to-pdf":    Convert,
    "word-to-pdf":    Convert,
    "excel-to-pdf":   Convert,
    "office-to-pdf":  Convert,
    "txt-to-pdf":     Convert,
    "csv-to-pdf":     Convert,
    "json-to-pdf":    Convert,
    "xml-to-pdf":     Convert,
    "rtf-to-pdf":     Convert,
    "markdown-to-pdf": Convert,
    "epub-to-pdf":    Convert,
    "odt-to-pdf":     Convert,
    "pdf-to-word":    Convert,
    "pdf-to-excel":   Convert,
    "pdf-to-pptx":    Convert,
    "pdf-to-text":    Convert,
    "pdf-to-image":   Convert,
    "pdf-to-jpg":     Convert,
    "pdf-to-png":     Convert,
    "pdf-to-svg":     Convert,
    "pdf-to-tiff":    Convert,
    "pdf-to-bmp":     Convert,
    "pdf-to-gif":     Convert,
    "pdf-to-epub":    Convert,
    "pdf-to-markdown": Convert,
    "pdf-to-pdfa":    Convert,
    "video-to-pdf":   Convert,
    "video-converter": Convert,
    "gif-to-mp4":     Convert,
    "audio-converter": Convert,
    "ocr-pdf":        Ocr,
    "image-ocr":      Ocr,
    "highlight-pdf":  Highlight,
    "annotate-pdf":   Highlight,
    "protect-pdf":    Lock,
    "set-permissions": Lock,
    "sanitize-pdf":   Lock,
    "unlock-pdf":     Unlock,
    "summarize-pdf":  Summarize,
    "smart-redact":   Lock,
    // Non-PDF
    "image-compressor": ImageCompress,
    "image-converter":  ImageCompress,
    "resize-crop-image": ImageCompress,
    "image-upscaler":   ImageCompress,
    "remove-exif":      ImageCompress,
    "remove-background": RemoveBg,
    "transparent-background": RemoveBg,
    "video-to-gif":     VideoToGif,
    "compress-video":   ImageCompress,
    "trim-media":       VideoToGif,
    "extract-audio":    VideoToGif,
    "qr-code":          QrCode,
    "qr-reader":        QrCode,
    "generate-barcode": QrCode,
    "hash-generator":   Hash,
    "json-xml-formatter": Hash,
    "csv-json":         Hash,
    "markdown-html":    Hash,
    "base64":           Base64,
    "url-encoder":      Base64,
    "text-diff":        Base64,
    "subtitle-converter": Base64,
    "pdf-page-counter":   PageCounter,
    "audio-merge":        MergeMedia,
    "video-merge":        MergeMedia,
};
