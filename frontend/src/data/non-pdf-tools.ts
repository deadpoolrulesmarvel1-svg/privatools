import {
  ImageIcon, RefreshCw, UserX, Crop, Film,
  Music, Scissors, Video,
  Braces, GitCompare, KeyRound, Hash,
  Archive, Lock,
  ArrowLeftRight, Code2, ScanText,
  Stamp, Globe, LayoutGrid, ScanLine, Link,
  QrCode, Merge, Maximize2, Type,
} from "lucide-react";
import { LucideIcon } from "lucide-react";

export type NonPdfCategory =
  | "image"
  | "video-audio"
  | "developer"
  | "archive"
  | "document-office";

export interface NonPdfTool {
  slug: string;
  icon: LucideIcon;
  name: string;
  description: string;
  longDescription: string;
  category: NonPdfCategory;
  /** Lower = shown earlier in the UI. Reflects relative search demand. */
  popularity?: number;
  clientOnly?: boolean;
  /** Marked true when the backend handler isn't built yet — UI grays out. */
  comingSoon?: boolean;
  /**
   * Alternative phrasings for Cmd-K fuzzy search. Space-joined string of
   * 3-10 alt phrases so palette can lowercase once and substring-match.
   */
  synonyms?: string;
  accepts: string;
  outputLabel: string;
}

const _nonPdfToolsRaw: NonPdfTool[] = [
  // ── Image & Media ───────────────────────────────────────────────────────────
  {
    slug: "image-compressor", icon: ImageIcon, name: "Image Compressor",
    description: "Reduce JPEG/PNG/WebP size without losing quality",
    longDescription: "Compress images online for free — reduce JPEG, PNG, and WebP file sizes by up to 80% without visible quality loss. Drag multiple files, see live savings, and download instantly. No upload to external servers.",
    synonyms: "shrink optimize jpg png webp size reduce make smaller",
    popularity: 2,
    category: "image", accepts: ".jpg,.jpeg,.png,.webp", outputLabel: "compressed images",
  },
  {
    slug: "image-converter", icon: RefreshCw, name: "Image Format Converter",
    description: "Convert between WebP, PNG, JPG, TIFF, and HEIC",
    longDescription: "Convert images online for free — change between WebP, PNG, JPG, TIFF, BMP and HEIC formats instantly. Perfect for converting iPhone HEIC photos to JPG. No upload required, processed locally.",
    synonyms: "format convert jpg png webp avif tiff bmp gif image format",
    popularity: 5,
    category: "image", accepts: ".jpg,.jpeg,.png,.webp,.tiff,.heic,.bmp", outputLabel: "converted image",
  },
  {
    slug: "remove-exif", icon: UserX, name: "Remove EXIF Data",
    description: "Strip GPS, camera, and timestamp metadata from photos",
    longDescription: "Remove EXIF data from photos online for free — strip GPS location, camera model, timestamps, and all metadata before sharing images online. Protect your privacy with one click. No sign-up needed.",
    synonyms: "exif metadata gps strip clean privacy",
    popularity: 31,
    category: "image", accepts: ".jpg,.jpeg,.png,.tiff,.webp", outputLabel: "clean image",
  },
  {
    slug: "resize-crop-image", icon: Crop, name: "Resize & Crop Image",
    description: "Bulk resize or crop images to any dimension",
    longDescription: "Resize and crop images online for free — set exact dimensions, aspect ratios, or pixel sizes. Bulk resize multiple images for social media, thumbnails, profile pictures, and website optimization.",
    synonyms: "resize scale crop dimensions size resize image",
    popularity: 4,
    category: "image", accepts: ".jpg,.jpeg,.png,.webp,.bmp", outputLabel: "resized images",
  },
  {
    slug: "video-to-gif", icon: Film, name: "Video / Audio to GIF",
    description: "Convert short video clips into animated GIFs",
    longDescription: "Convert video to GIF online for free — upload MP4, MOV, or WebM files, select the clip range, and export a looping animated GIF. Adjust FPS and resolution for the perfect file size. No watermarks.",
    synonyms: "animate looping share preview mp4 to gif mov to gif",
    popularity: 6,
    category: "image", accepts: ".mp4,.mov,.webm,.avi", outputLabel: "animation.gif",
  },
  {
    slug: "image-ocr", icon: ScanText, name: "Image OCR",
    description: "Extract text from images using optical character recognition",
    longDescription: "Extract text from images online for free using OCR. Upload photos of documents, screenshots, receipts, or handwritten notes and get all readable text. Supports 40+ languages via Tesseract. Private and instant.",
    synonyms: "text extract from picture recognize",
    popularity: 35,
    category: "image", accepts: ".jpg,.jpeg,.png,.webp,.bmp,.tiff,.tif", outputLabel: "extracted text",
  },

  // ── Audio & Video ───────────────────────────────────────────────────────────
  {
    slug: "extract-audio", icon: Music, name: "Extract Audio from Video",
    description: "Strip the MP3/WAV audio track from a video file",
    longDescription: "Extract audio from video online for free — pull the audio track from any MP4, MOV, WebM, or AVI file and save as MP3, WAV, or OGG. No quality loss, processed directly in your browser.",
    synonyms: "rip audio mp3 from video soundtrack",
    popularity: 56,
    category: "video-audio", accepts: ".mp4,.mov,.webm,.avi,.mkv", outputLabel: "audio.mp3",
  },
  {
    slug: "trim-media", icon: Scissors, name: "Cut / Trim Video & Audio",
    description: "Trim the start and end of video or audio files",
    longDescription: "Cut and trim video or audio online for free — use a visual timeline to set in/out points and export the trimmed clip at full quality without re-encoding. Supports MP4, MP3, WAV, and more.",
    synonyms: "cut clip slice shorten",
    popularity: 54,
    category: "video-audio", accepts: ".mp4,.mov,.webm,.mp3,.wav,.ogg,.m4a", outputLabel: "trimmed file",
  },
  {
    slug: "compress-video", icon: Video, name: "Compress Video",
    description: "Reduce video file size for email or messaging",
    longDescription: "Compress video online for free — reduce video file size for email, messaging, and uploads. Choose quality presets from 'High Quality' to 'WhatsApp-ready'. Supports MP4, MOV, WebM, and AVI.",
    synonyms: "smaller mp4 webm size",
    popularity: 51,
    category: "video-audio", accepts: ".mp4,.mov,.webm,.avi", outputLabel: "compressed.mp4",
  },
  {
    slug: "video-to-pdf", icon: Film, name: "Video to PDF",
    description: "Extract frames from a video into a PDF document",
    longDescription: "Convert video to PDF online for free — extract evenly-spaced frames from MP4, MOV, WebM, or AVI files and lay them out one per page. Perfect for storyboards, video previews, lecture summaries, or sharing a clip with someone who only opens PDFs.",
    synonyms: "frames pages slideshow",
    popularity: 62,
    category: "video-audio", accepts: ".mp4,.mov,.webm,.avi,.mkv", outputLabel: "frames.pdf",
  },
  {
    slug: "video-converter", icon: RefreshCw, name: "Video Converter",
    description: "Convert between MP4, MOV, WebM, MKV, and AVI",
    longDescription: "Convert video between formats online for free — change MP4 → WebM, MOV → MP4, AVI → MP4, and more. Re-encodes with sensible per-format codecs (H.264 for MP4/MOV/MKV, VP9 for WebM, MPEG-4 for AVI).",
    synonyms: "convert format mp4 mov webm avi mkv",
    popularity: 52,
    category: "video-audio", accepts: ".mp4,.mov,.webm,.avi,.mkv,.m4v", outputLabel: "converted.mp4",
  },
  {
    slug: "video-resizer", icon: Maximize2, name: "Video Resizer",
    description: "Downscale a video to 240p, 360p, 480p, 720p, 1080p, or 1440p",
    longDescription: "Resize video resolution online for free — downscale to 240p, 360p, 480p, 720p, 1080p, or 1440p while preserving aspect ratio. Re-encodes with H.264 + AAC and the +faststart flag for streaming-friendly output.",
    synonyms: "resize scale dimensions width height",
    popularity: 63,
    category: "video-audio", accepts: ".mp4,.mov,.webm,.avi,.mkv", outputLabel: "video.mp4",
  },
  {
    slug: "video-thumbnail", icon: ImageIcon, name: "Video Thumbnail",
    description: "Extract a single frame from a video as a JPG image",
    longDescription: "Extract video thumbnail online for free — pick a timestamp and grab a high-quality JPG of that frame. Perfect for YouTube thumbnails, podcast art, social previews, or quick screenshots.",
    synonyms: "preview screenshot still image cover",
    popularity: 64,
    category: "video-audio", accepts: ".mp4,.mov,.webm,.avi,.mkv", outputLabel: "thumbnail.jpg",
  },
  {
    slug: "gif-to-mp4", icon: Film, name: "GIF to MP4",
    description: "Convert animated GIF to MP4 for smaller file size",
    longDescription: "Convert GIF to MP4 online for free — turn animated GIFs into H.264 MP4 video. MP4 is typically 5-10× smaller than the equivalent GIF and plays smoothly on every platform. Ideal for sharing memes on Twitter/X, Discord, and forums that prefer video.",
    synonyms: "convert gif to video mp4",
    popularity: 61,
    category: "video-audio", accepts: ".gif", outputLabel: "animation.mp4",
  },
  {
    slug: "add-subtitles", icon: Type, name: "Add Subtitles to Video",
    description: "Burn .srt or .vtt subtitles permanently into a video",
    longDescription: "Add subtitles to video online for free — burn .srt or .vtt subtitle files permanently into a video so they show up everywhere, no matter the player. Perfect for social media uploads where soft subtitles aren't supported.",
    synonyms: "subtitle srt caption burn in",
    popularity: 65,
    category: "video-audio", accepts: ".mp4,.mov,.webm,.avi,.mkv", outputLabel: "subtitled.mp4",
  },
  {
    slug: "video-merge", icon: Merge, name: "Merge Videos",
    description: "Concatenate multiple videos into one",
    longDescription: "Merge videos online for free — concatenate multiple MP4, MOV, WebM, or MKV clips into a single video file with seamless transitions. Re-encodes once for perfect playback compatibility.",
    synonyms: "join combine concat videos",
    popularity: 66,
    category: "video-audio", accepts: ".mp4,.mov,.webm,.avi,.mkv", outputLabel: "merged.mp4",
  },
  {
    slug: "audio-merge", icon: Merge, name: "Merge Audio",
    description: "Concatenate multiple audio tracks into one file",
    longDescription: "Merge audio online for free — combine multiple MP3, WAV, AAC, FLAC, or OGG files into a single track. Perfect for combining podcast segments, music samples, or recorded clips.",
    synonyms: "join combine concat audio tracks",
    popularity: 67,
    category: "video-audio", accepts: ".mp3,.wav,.aac,.flac,.ogg,.m4a", outputLabel: "merged.mp3",
  },
  {
    slug: "subtitle-converter", icon: ArrowLeftRight, name: "Subtitle Converter",
    description: "Convert between SRT, VTT, and ASS subtitle formats",
    longDescription: "Convert subtitles online for free — swap between SRT (SubRip), VTT (WebVTT), and ASS (SubStation Alpha) formats. Useful when your player supports one format but your subtitles are in another.",
    synonyms: "srt vtt ass convert subtitles format",
    popularity: 68,
    category: "video-audio", clientOnly: true, accepts: ".srt,.vtt,.ass", outputLabel: "subtitles.vtt",
  },

  // ── Developer & Text ────────────────────────────────────────────────────────
  {
    slug: "json-xml-formatter", icon: Braces, name: "JSON / XML Formatter",
    description: "Prettify and validate JSON or XML offline",
    longDescription: "Format JSON and XML online for free — paste, prettify, validate, and highlight syntax errors instantly. 100% offline processing — sensitive API payloads and config files never leave your browser. No data sent to servers.",
    synonyms: "pretty print beautify lint validate",
    popularity: 81,
    category: "developer", clientOnly: true, accepts: ".json,.xml", outputLabel: "formatted",
  },
  {
    slug: "text-diff", icon: GitCompare, name: "Text Diff / Comparator",
    description: "Highlight exact differences between two text blocks",
    longDescription: "Compare text online for free — paste two versions of text or code side-by-side and get a line-by-line diff with additions in green and deletions in red. Perfect for code review, proofreading, and version comparison.",
    synonyms: "compare text difference changes",
    popularity: 83,
    category: "developer", clientOnly: true, accepts: "", outputLabel: "diff report",
  },
  {
    slug: "base64", icon: KeyRound, name: "Base64 Encoder / Decoder",
    description: "Encode or decode text and files as Base64",
    longDescription: "Base64 encode and decode online for free — convert text strings or binary files to Base64, or decode Base64 back to the original content. Supports text, images, PDFs, and any file type. Runs entirely in your browser.",
    synonyms: "encode decode binary text",
    popularity: 80,
    category: "developer", clientOnly: true, accepts: "*", outputLabel: "encoded/decoded",
  },
  {
    slug: "hash-generator", icon: Hash, name: "Hash Generator",
    description: "Generate MD5, SHA-1, SHA-256 hashes of text or files",
    longDescription: "Generate MD5, SHA-1, SHA-256 hashes online for free — verify file integrity and create cryptographic checksums. Paste text or upload files to get instant hash digests. All processing happens in your browser.",
    synonyms: "md5 sha checksum digest fingerprint",
    popularity: 82,
    category: "developer", clientOnly: true, accepts: "*", outputLabel: "hash digest",
  },

  // ── Archive & File Management ───────────────────────────────────────────────
  {
    slug: "extract-archive", icon: Archive, name: "Extract ZIP / TAR",
    description: "Extract ZIP and TAR archives privately",
    longDescription: "Extract ZIP and TAR files online for free — upload .zip, .tar, .tar.gz, .tgz archives and extract contents in an isolated container. Download extracted files individually or as a new ZIP. Up to 500 MB per file, no sign-up.",
    synonyms: "unzip extract zip tar gz files",
    popularity: 110,
    category: "archive", accepts: ".zip,.tar,.tar.gz,.tgz,.tar.bz2,.tbz2,.tar.xz,.txz", outputLabel: "extracted files",
  },
  {
    slug: "create-zip", icon: Lock, name: "Create ZIP Archive",
    description: "Bundle multiple files into a ZIP archive",
    longDescription: "Create ZIP archives online for free — select multiple files and package them into a standard ZIP file. Fast local compression with no file upload to external servers. No sign-up, instant download.",
    synonyms: "zip archive compress files into one",
    popularity: 111,
    category: "archive", accepts: "*", outputLabel: "archive.zip",
  },

  // ── Document & Office ───────────────────────────────────────────────────────
  {
    slug: "csv-json", icon: ArrowLeftRight, name: "CSV ↔ JSON Converter",
    description: "Swap between CSV and JSON data formats instantly",
    longDescription: "Convert CSV to JSON and JSON to CSV online for free — paste or upload data and instantly swap between formats. Perfect for data transformation, API testing, and spreadsheet-to-JSON conversion. Browser-only, no upload.",
    synonyms: "csv to json convert format",
    popularity: 84,
    category: "document-office", clientOnly: true, accepts: ".csv,.json", outputLabel: "converted file",
  },
  {
    slug: "markdown-html", icon: Code2, name: "Markdown to HTML",
    description: "Convert Markdown writing into web-ready HTML",
    longDescription: "Convert Markdown to HTML online for free — paste or upload .md files and get clean, semantic HTML output with live preview and syntax highlighting. Perfect for blog posts, documentation, and README files.",
    synonyms: "md html convert preview rendering",
    popularity: 87,
    category: "document-office", clientOnly: true, accepts: ".md,.markdown", outputLabel: "output.html",
  },
  {
    slug: "heic-to-jpg", icon: RefreshCw, name: "HEIC to JPG",
    description: "Convert iPhone HEIC/HEIF photos to JPEG",
    longDescription: "Convert HEIC to JPG online for free — upload iPhone HEIC/HEIF photos and convert them to universally compatible JPEG format instantly. Perfect for sharing Apple photos on Windows, Android, and social media.",
    synonyms: "iphone apple convert universal jpeg heif ios",
    popularity: 1,
    category: "image", accepts: ".heic,.heif", outputLabel: "converted.jpg",
  },
  {
    slug: "remove-background", icon: UserX, name: "Background Remover",
    description: "Remove backgrounds from images using local AI",
    longDescription: "Remove image background online for free using AI — upload any photo and instantly remove the background. Perfect for product photos, profile pictures, passport photos, and design work. Processed on your server, not third-party.",
    synonyms: "transparent cutout subject extract bg remove bg",
    popularity: 3,
    category: "image", accepts: ".jpg,.jpeg,.png,.webp,.bmp", outputLabel: "no_background.png",
  },
  {
    slug: "svg-to-png", icon: ImageIcon, name: "SVG to PNG",
    description: "Convert vector SVG files to crisp PNG images",
    longDescription: "Convert SVG to PNG online for free — upload vector SVG files and render them as crisp, high-resolution PNG images with 2x Retina scaling. Perfect for design assets, app icons, and social media graphics.",
    synonyms: "vector raster render bitmap convert",
    popularity: 21,
    category: "image", accepts: ".svg", outputLabel: "converted.png",
  },
  {
    slug: "image-watermark", icon: Stamp, name: "Image Watermark",
    description: "Add text watermarks to photos and images",
    longDescription: "Add watermark to images online for free — protect your photos with customizable text watermarks. Choose position (center, corners, or tiled), opacity, font size, and color. Processed locally, no upload.",
    synonyms: "watermark stamp brand image logo",
    popularity: 15,
    category: "image", accepts: ".jpg,.jpeg,.png,.webp,.bmp", outputLabel: "watermarked.png",
  },
  {
    slug: "generate-favicon", icon: Globe, name: "Favicon Generator",
    description: "Create .ico favicons from any image",
    longDescription: "Generate favicon from image online for free — upload any image and create a multi-size ICO file (16x16, 32x32, 48x48) ready for your website. Instant favicon creator, no design skills needed.",
    synonyms: "favicon icon ico website",
    popularity: 36,
    category: "image", accepts: ".jpg,.jpeg,.png,.webp,.bmp", outputLabel: "favicon.ico",
  },
  {
    slug: "make-collage", icon: LayoutGrid, name: "Photo Collage",
    description: "Combine multiple images into a beautiful grid",
    longDescription: "Create photo collages online for free — upload multiple images and arrange them into a clean grid layout. Customize columns, spacing, and background color. Free collage maker with instant download.",
    synonyms: "collage grid mosaic photo album",
    popularity: 33,
    category: "image", accepts: ".jpg,.jpeg,.png,.webp,.bmp", outputLabel: "collage.jpg",
  },
  {
    slug: "generate-barcode", icon: ScanLine, name: "Barcode Generator",
    description: "Generate Code128, EAN-13, QR codes from any text",
    longDescription: "Generate barcodes online for free — create Code128, Code39, EAN-13, EAN-8, UPC-A, ISBN-13, and QR codes from any text or number. Download as high-resolution PNG images. No sign-up required.",
    synonyms: "barcode ean upc code128 qr",
    popularity: 98,
    category: "developer", accepts: "", outputLabel: "barcode.png",
  },
  {
    slug: "url-to-pdf", icon: Link, name: "URL to PDF",
    description: "Save any webpage as a PDF document",
    longDescription: "Save webpage as PDF online for free — enter any URL and convert the web page to a high-quality PDF document. Rendered on your server using WeasyPrint. Note: results may vary for JavaScript-heavy sites.",
    synonyms: "save webpage to pdf url print",
    popularity: 99,
    category: "developer", accepts: "", outputLabel: "webpage.pdf",
  },
  // ── Client-only utility tools (Round O) ────────────────────────────────────
  {
    slug: "password-generator", icon: KeyRound, name: "Password Generator",
    description: "Cryptographically-strong passwords, 100% in your browser",
    longDescription: "Generate strong passwords online for free — uses crypto.getRandomValues so the password never leaves your browser. Choose length, character sets, and exclude ambiguous characters (l/1/I/0/O). With live strength meter.",
    synonyms: "password random secure strong",
    popularity: 93,
    category: "developer", clientOnly: true, accepts: "", outputLabel: "password",
  },
  {
    slug: "uuid-generator", icon: Hash, name: "UUID Generator",
    description: "Bulk-generate UUID v4 or v7 in your browser",
    longDescription: "Generate UUIDs online for free — bulk-generate up to 500 UUIDs (v4 random or v7-style timestamp-prefixed) using crypto.randomUUID(). Output is one per line, ready to copy. Runs entirely in your browser.",
    synonyms: "guid v4 v7 random id unique",
    popularity: 94,
    category: "developer", clientOnly: true, accepts: "", outputLabel: "uuids",
  },
  {
    slug: "lorem-ipsum", icon: Type, name: "Lorem Ipsum Generator",
    description: "Placeholder text — words, sentences, or paragraphs",
    longDescription: "Generate Lorem Ipsum placeholder text online for free. Pick paragraphs, sentences, or words; control count; toggle whether to start with the classic 'Lorem ipsum…' opener. Pure browser, no API.",
    synonyms: "placeholder dummy text greek latin",
    popularity: 97,
    category: "developer", clientOnly: true, accepts: "", outputLabel: "lorem text",
  },
  {
    slug: "word-counter", icon: Type, name: "Word & Character Counter",
    description: "Live counts of words, characters, sentences, lines",
    longDescription: "Count words, characters, sentences, paragraphs, and lines online for free. Includes reading-time estimate at 220 wpm. Runs entirely in your browser — paste sensitive text without worry.",
    synonyms: "words characters sentences paragraphs",
    popularity: 96,
    category: "developer", clientOnly: true, accepts: "", outputLabel: "stats",
  },
  {
    slug: "color-converter", icon: ImageIcon, name: "Color Converter",
    description: "Convert between HEX, RGB, HSL, RGBA",
    longDescription: "Convert colors between HEX, RGB, HSL, and RGBA online for free. Includes a color picker, live preview swatch, and copy-ready Tailwind / CSS-variable snippets. All math runs in your browser.",
    synonyms: "hex rgb hsl picker palette",
    popularity: 95,
    category: "developer", clientOnly: true, accepts: "", outputLabel: "color value",
  },
  {
    slug: "url-encoder", icon: Code2, name: "URL Encoder / Decoder",
    description: "Percent-encode or decode URLs in your browser",
    longDescription: "Encode or decode URLs online for free — percent-encode strings for use in query parameters, or decode %20/%26/etc back to readable text. Runs entirely in your browser; nothing is sent to any server. For JWT decoding specifically, use the dedicated JWT Decoder tool.",
    synonyms: "percent escape decode jwt",
    popularity: 88,
    category: "developer", clientOnly: true, accepts: "", outputLabel: "encoded/decoded",
  },
  {
    slug: "qr-reader", icon: QrCode, name: "QR Code Reader",
    description: "Decode QR codes and barcodes from images",
    longDescription: "Read QR codes online for free — upload any image containing a QR code or barcode and instantly decode its contents. Supports QR, Code128, EAN, UPC, and other popular barcode formats. No app needed.",
    synonyms: "decode scan camera",
    popularity: 37,
    category: "image", accepts: ".jpg,.jpeg,.png,.webp,.bmp", outputLabel: "decoded text",
  },
  {
    slug: "merge-images", icon: Merge, name: "Merge Images",
    description: "Combine images side-by-side or top-to-bottom",
    longDescription: "Merge images online for free — combine multiple photos side-by-side (horizontal) or top-to-bottom (vertical) into a single image. Images are automatically scaled to match. Free, instant, no sign-up.",
    synonyms: "join combine concat horizontal vertical",
    popularity: 34,
    category: "image", accepts: ".jpg,.jpeg,.png,.webp,.bmp", outputLabel: "merged.png",
  },
  {
    slug: "image-upscaler", icon: Maximize2, name: "Image Upscaler",
    description: "Upscale images 2x or 4x with Lanczos resampling",
    longDescription: "Upscale images online for free — enlarge photos by 2x or 4x using high-quality Lanczos resampling. Supports JPG, PNG, and WebP. Perfect for improving resolution of small images, thumbnails, or screenshots. No sign-up, no watermarks.",
    synonyms: "enhance enlarge bigger 2x 4x lanczos",
    popularity: 14,
    category: "image", accepts: ".jpg,.jpeg,.png,.webp", outputLabel: "upscaled image",
  },
  {
    slug: "audio-converter", icon: Music, name: "Audio Converter",
    description: "Convert between MP3, WAV, OGG, FLAC, AAC",
    longDescription: "Convert audio files online for free — change between MP3, WAV, OGG, FLAC, and AAC formats. Choose your preferred bitrate (64k to 320k). Powered by FFmpeg for professional-quality conversion. Files up to 200 MB supported.",
    synonyms: "convert format mp3 wav ogg flac aac transcode audio format",
    popularity: 7,
    category: "video-audio", accepts: ".mp3,.wav,.ogg,.flac,.aac,.m4a,.wma", outputLabel: "converted audio",
  },

  // ── v1.2.0 additions ──────────────────────────────────────────────────────
  {
    slug: "view-exif", icon: ScanLine, name: "View EXIF Data",
    description: "Inspect GPS, camera, and metadata stored in an image",
    longDescription: "View EXIF data online for free — see every piece of metadata embedded in a JPEG, PNG, TIFF, or HEIC: GPS coordinates, camera make and model, lens info, ISO, exposure, timestamps, software, and more. Counterpart to Remove EXIF — see what you'd be stripping out.",
    synonyms: "metadata gps camera info",
    popularity: 32,
    category: "image", accepts: ".jpg,.jpeg,.png,.tiff,.tif,.webp,.heic,.heif,.bmp,.gif", outputLabel: "metadata JSON",
  },
  {
    slug: "webp-to-jpg", icon: RefreshCw, name: "WebP to JPG",
    description: "Convert WebP images to JPEG",
    longDescription: "Convert WebP to JPG online for free — change Google's WebP image format to the universally-compatible JPEG. Drag-and-drop multiple files, no sign-up, no watermarks. Files are processed and discarded immediately.",
    synonyms: "google webp convert universal",
    popularity: 17,
    category: "image", accepts: ".webp", outputLabel: "image.jpg",
  },
  {
    slug: "webp-to-png", icon: RefreshCw, name: "WebP to PNG",
    description: "Convert WebP images to PNG (lossless)",
    longDescription: "Convert WebP to PNG online for free — change Google's WebP format to lossless PNG, preserving transparency. Free, private, no watermarks.",
    synonyms: "google webp convert lossless",
    popularity: 20,
    category: "image", accepts: ".webp", outputLabel: "image.png",
  },
  {
    slug: "heic-to-png", icon: RefreshCw, name: "HEIC to PNG",
    description: "Convert iPhone HEIC photos to PNG",
    longDescription: "Convert HEIC to PNG online for free — change Apple's High Efficiency Image format (the default for iPhone photos) to PNG, which every browser and editor can open. Free, private, no sign-up.",
    synonyms: "iphone apple convert universal",
    popularity: 26,
    category: "image", accepts: ".heic,.heif", outputLabel: "image.png",
  },
  {
    slug: "jwt-decoder", icon: KeyRound, name: "JWT Decoder",
    description: "Decode and inspect a JWT (JSON Web Token)",
    longDescription: "Decode a JWT online for free — paste any JSON Web Token and instantly see its header, payload, and signature decoded as readable JSON. Highlights expiry, algorithm, and standard claims. All decoding happens in your browser; tokens never leave.",
    synonyms: "json web token decode parse jwt parser auth",
    popularity: 8,
    category: "developer", clientOnly: true, accepts: "", outputLabel: "decoded JWT",
  },
  {
    slug: "regex-tester", icon: Code2, name: "Regex Tester",
    description: "Test regular expressions with live highlighting",
    longDescription: "Test regular expressions online for free — paste a regex and a test string to see every match highlighted in real time, along with captured groups. Supports flags (g, i, m, s, u, y). Works entirely in your browser, no calls to a server.",
    synonyms: "regular expression pattern match test",
    popularity: 91,
    category: "developer", clientOnly: true, accepts: "", outputLabel: "matches",
  },
  {
    slug: "timestamp-converter", icon: Hash, name: "Timestamp Converter",
    description: "Convert Unix epoch ↔ ISO 8601 ↔ human-readable",
    longDescription: "Convert between Unix timestamps and human-readable dates online for free — paste an epoch (seconds or milliseconds) or an ISO 8601 string and see all formats side-by-side, in your local time and UTC. Pure-browser, never logs your data.",
    synonyms: "unix epoch iso 8601 date time",
    popularity: 92,
    category: "developer", clientOnly: true, accepts: "", outputLabel: "converted timestamp",
  },

  // ── v1.4.0 image format converter aliases ────────────────────────────────
  {
    slug: "jpg-to-png", icon: RefreshCw, name: "JPG to PNG",
    description: "Convert JPG to PNG online — lossless conversion",
    longDescription: "Convert JPG to PNG online for free — lossless conversion preserving every pixel. PNG supports transparency and lossless compression, ideal for graphics, logos, and screenshots. No upload to third parties; processed and discarded immediately.",
    synonyms: "convert format lossless transparency",
    popularity: 19,
    category: "image", accepts: ".jpg,.jpeg", outputLabel: "image.png",
  },
  {
    slug: "png-to-jpg", icon: RefreshCw, name: "PNG to JPG",
    description: "Convert PNG to JPG for smaller file size",
    longDescription: "Convert PNG to JPG online for free — change PNG images to JPEG, typically 3–5x smaller in file size. JPEG uses lossy compression which is invisible at normal viewing sizes. Perfect for email attachments and web upload limits. Transparent pixels become white.",
    synonyms: "convert format smaller photo",
    popularity: 18,
    category: "image", accepts: ".png", outputLabel: "image.jpg",
  },
  {
    slug: "jpg-to-webp", icon: RefreshCw, name: "JPG to WebP",
    description: "Convert JPG to WebP for smaller, web-optimized files",
    longDescription: "Convert JPG to WebP online for free — WebP is Google's modern image format, typically 25–35% smaller than JPEG at equivalent quality. Supported by all modern browsers. Ideal for faster website page loads.",
    synonyms: "convert smaller google modern format",
    popularity: 27,
    category: "image", accepts: ".jpg,.jpeg", outputLabel: "image.webp",
  },
  {
    slug: "png-to-webp", icon: RefreshCw, name: "PNG to WebP",
    description: "Convert PNG to WebP — smaller files, transparency preserved",
    longDescription: "Convert PNG to WebP online for free — WebP supports transparency like PNG but with 25–50% smaller file sizes. Perfect for web graphics and PWAs. Lossless mode available for pixel-perfect output.",
    synonyms: "convert smaller google modern",
    popularity: 28,
    category: "image", accepts: ".png", outputLabel: "image.webp",
  },
  {
    slug: "tiff-to-jpg", icon: RefreshCw, name: "TIFF to JPG",
    description: "Convert TIFF to JPG for sharing and email",
    longDescription: "Convert TIFF to JPG online for free — TIFF is a large, lossless format used in archival and pro photography; JPEG is universally compatible. Typical 5–10x size reduction. Multi-page TIFF supported — each page becomes a separate JPG.",
    synonyms: "scan convert smaller",
    popularity: 22,
    category: "image", accepts: ".tif,.tiff", outputLabel: "image.jpg",
  },
  {
    slug: "tiff-to-png", icon: RefreshCw, name: "TIFF to PNG",
    description: "Convert TIFF to PNG — lossless, transparency preserved",
    longDescription: "Convert TIFF to PNG online for free — both are lossless formats, but PNG is universally supported in browsers and modern software. Transparency channel preserved when present.",
    synonyms: "scan convert lossless",
    popularity: 23,
    category: "image", accepts: ".tif,.tiff", outputLabel: "image.png",
  },
  {
    slug: "bmp-to-jpg", icon: RefreshCw, name: "BMP to JPG",
    description: "Convert BMP bitmap to JPG — massive size reduction",
    longDescription: "Convert BMP to JPG online for free — BMP is the uncompressed Windows bitmap format and is HUGE. JPEG conversion typically gives 50–100x smaller files with no visible quality loss at standard viewing sizes.",
    synonyms: "windows bitmap convert smaller",
    popularity: 24,
    category: "image", accepts: ".bmp", outputLabel: "image.jpg",
  },
  {
    slug: "bmp-to-png", icon: RefreshCw, name: "BMP to PNG",
    description: "Convert BMP bitmap to PNG — lossless, much smaller",
    longDescription: "Convert BMP to PNG online for free — PNG is also lossless but uses efficient compression. Output files are typically 5–10x smaller than the BMP source with zero pixel data loss.",
    synonyms: "windows bitmap convert lossless",
    popularity: 25,
    category: "image", accepts: ".bmp", outputLabel: "image.png",
  },
  {
    slug: "gif-to-jpg", icon: RefreshCw, name: "GIF to JPG",
    description: "Convert GIF to JPG (uses the first frame)",
    longDescription: "Convert GIF to JPG online for free — extracts the first frame of an animated GIF (or the single frame of a static GIF) as a JPEG. Useful for thumbnails, social media uploads, or anywhere GIF isn't supported.",
    synonyms: "first frame convert image",
    popularity: 29,
    category: "image", accepts: ".gif", outputLabel: "image.jpg",
  },
  {
    slug: "gif-to-png", icon: RefreshCw, name: "GIF to PNG",
    description: "Convert GIF to PNG (preserves transparency)",
    longDescription: "Convert GIF to PNG online for free — extracts the first frame as a PNG, preserving transparency. PNG offers much higher color fidelity than GIF's 256-color limit.",
    synonyms: "first frame convert lossless",
    popularity: 30,
    category: "image", accepts: ".gif", outputLabel: "image.png",
  },

  // ── v1.4.0 audio/video converter aliases ────────────────────────────────
  {
    slug: "m4a-to-mp3", icon: Music, name: "M4A to MP3",
    description: "Convert iPhone M4A voice memos and audio to MP3",
    longDescription: "Convert M4A to MP3 online for free — M4A is Apple's audio format (used by iPhone Voice Memos and iTunes); MP3 plays everywhere. Powered by FFmpeg with configurable bitrate. Files up to 200 MB supported.",
    synonyms: "iphone voice memo convert universal",
    popularity: 57,
    category: "video-audio", accepts: ".m4a", outputLabel: "audio.mp3",
  },
  {
    slug: "mp4-to-mp3", icon: Music, name: "MP4 to MP3",
    description: "Extract audio from MP4 video and save as MP3",
    longDescription: "Convert MP4 to MP3 online for free — extract the audio track from any MP4 video and save it as an MP3 file. Useful for ripping music from YouTube downloads, podcast clips, or lecture recordings. Configurable bitrate.",
    synonyms: "extract audio from video",
    popularity: 50,
    category: "video-audio", accepts: ".mp4", outputLabel: "audio.mp3",
  },
  {
    slug: "mov-to-mp4", icon: Film, name: "MOV to MP4",
    description: "Convert Apple MOV video to universally-supported MP4",
    longDescription: "Convert MOV to MP4 online for free — MOV is Apple's QuickTime container; MP4 plays on every device including Windows, Android, web browsers, and social media. H.264 video + AAC audio for best compatibility.",
    synonyms: "apple quicktime convert universal",
    popularity: 53,
    category: "video-audio", accepts: ".mov", outputLabel: "video.mp4",
  },
  {
    slug: "avi-to-mp4", icon: Film, name: "AVI to MP4",
    description: "Convert legacy AVI video to modern MP4",
    longDescription: "Convert AVI to MP4 online for free — AVI is the old Microsoft container that's poorly supported by modern devices. MP4 plays everywhere and is typically 30–50% smaller. Powered by FFmpeg with H.264 encoding.",
    synonyms: "legacy windows convert modern",
    popularity: 58,
    category: "video-audio", accepts: ".avi", outputLabel: "video.mp4",
  },
  {
    slug: "webm-to-mp4", icon: Film, name: "WebM to MP4",
    description: "Convert WebM (Google) video to MP4",
    longDescription: "Convert WebM to MP4 online for free — WebM is YouTube's web-streaming format; MP4 is needed for editing software, iMessage, social media uploads, and older devices. Quality preserved through H.264 encoding.",
    synonyms: "google convert universal apple compatible",
    popularity: 59,
    category: "video-audio", accepts: ".webm", outputLabel: "video.mp4",
  },
  {
    slug: "mp4-to-webm", icon: Film, name: "MP4 to WebM",
    description: "Convert MP4 to WebM for web embedding",
    longDescription: "Convert MP4 to WebM online for free — WebM (VP9 video + Opus audio) produces 30–50% smaller files than MP4 at equivalent quality. Native HTML5 video support in all modern browsers without a transcoding step on your server.",
    synonyms: "convert smaller open web vp9",
    popularity: 60,
    category: "video-audio", accepts: ".mp4", outputLabel: "video.webm",
  },

  // ── v1.4.0 browser-only developer converters ────────────────────────────
  {
    slug: "yaml-to-json", icon: Braces, name: "YAML to JSON",
    description: "Convert YAML to JSON entirely in your browser",
    longDescription: "Convert YAML to JSON online for free — paste any YAML (Kubernetes manifest, GitHub Actions workflow, Docker Compose) and instantly get the equivalent JSON. Validates YAML syntax. Runs entirely in your browser — your config never touches a server.",
    synonyms: "kubernetes yaml convert config",
    popularity: 85,
    category: "developer", clientOnly: true, accepts: "", outputLabel: "JSON output",
  },
  {
    slug: "json-to-yaml", icon: Braces, name: "JSON to YAML",
    description: "Convert JSON to YAML in your browser",
    longDescription: "Convert JSON to YAML online for free — paste JSON and get the equivalent YAML in a clean, human-readable format. Perfect for migrating configs to Kubernetes or Ansible. Pure-browser conversion.",
    synonyms: "kubernetes config convert",
    popularity: 86,
    category: "developer", clientOnly: true, accepts: "", outputLabel: "YAML output",
  },
  {
    slug: "case-converter", icon: Type, name: "Case Converter",
    description: "Convert text between UPPER, lower, Title, camelCase, snake_case, kebab-case",
    longDescription: "Convert text case online for free — translate between UPPERCASE, lowercase, Title Case, Sentence case, camelCase, PascalCase, snake_case, kebab-case, CONSTANT_CASE, and more. Live preview as you type. Runs entirely in your browser.",
    synonyms: "camelcase snake kebab title upper lower",
    popularity: 89,
    category: "developer", clientOnly: true, accepts: "", outputLabel: "converted text",
  },
  // ── Phase 7 — competitor-gap tools (v1.5.0) ────────────────────────────
  {
    slug: "mute-video", icon: Video, name: "Mute Video",
    description: "Strip the audio track from any video",
    longDescription: "Remove audio from MP4, MOV, WebM, MKV, AVI videos online for free — stream-copies the video so the operation is instant and lossless. No re-encoding, no quality loss.",
    synonyms: "remove audio silent strip soundtrack",
    popularity: 53,
    category: "video-audio", accepts: ".mp4,.mov,.webm,.mkv,.avi,.m4v", outputLabel: "muted.mp4",
  },
  {
    slug: "reverse-video", icon: Video, name: "Reverse Video",
    description: "Play your video backwards (audio reversed too)",
    longDescription: "Reverse an MP4/MOV/WebM video so it plays backwards — useful for fun edits, training-clip annotations, and reverse-motion effects. Audio track is reversed in sync.",
    synonyms: "backwards play in reverse rewind",
    popularity: 65,
    category: "video-audio", accepts: ".mp4,.mov,.webm,.mkv,.avi", outputLabel: "reversed.mp4",
  },
  {
    slug: "video-speed", icon: Video, name: "Video Speed Changer",
    description: "Speed up or slow down a video, 0.25× to 4×",
    longDescription: "Change the playback speed of any video from 0.25× (slow-mo) to 4× (hyperlapse). Audio is pitch-corrected via FFmpeg's atempo filter so it doesn't sound chipmunk-y. Output is universal MP4.",
    synonyms: "speed up slow down fast forward 2x slow motion",
    popularity: 55,
    category: "video-audio", accepts: ".mp4,.mov,.webm,.mkv,.avi", outputLabel: "video.mp4",
  },
  {
    slug: "audio-trim", icon: Scissors, name: "Audio Trimmer",
    description: "Cut a clip out of any audio file",
    longDescription: "Trim or cut MP3, WAV, AAC, FLAC, OGG, or M4A files — specify start and end timestamps (HH:MM:SS) and download just the chosen segment. Stream-copy keeps the original quality.",
    synonyms: "cut clip slice shorten audio",
    popularity: 56,
    category: "video-audio", accepts: ".mp3,.wav,.aac,.flac,.ogg,.m4a", outputLabel: "trimmed.mp3",
  },
  {
    slug: "image-palette", icon: ImageIcon, name: "Image Color Palette",
    description: "Extract dominant colors from any image",
    longDescription: "Upload an image and instantly get its dominant color palette as HEX codes with rgb() values and percentage coverage. Perfect for designers extracting brand colors from a logo, photographers analyzing a mood, or building UI themes from reference images.",
    synonyms: "color palette dominant colors extract designer",
    popularity: 39,
    category: "image", accepts: ".jpg,.jpeg,.png,.webp,.bmp,.gif,.tif,.tiff", outputLabel: "color palette",
  },
  {
    slug: "pixelate-image", icon: ImageIcon, name: "Pixelate / Blur Image",
    description: "Censor part of an image with mosaic or Gaussian blur",
    longDescription: "Pixelate or blur an image to obscure sensitive content before sharing — block faces, license plates, addresses, screenshots. Choose mosaic-style pixelation or smooth Gaussian blur, adjust strength 1-100. Runs server-side, image is deleted immediately after processing.",
    synonyms: "censor blur mosaic obscure privacy face",
    popularity: 40,
    category: "image", accepts: ".jpg,.jpeg,.png,.webp,.bmp", outputLabel: "image.png",
  },
  {
    slug: "rotate-image", icon: ImageIcon, name: "Rotate Image",
    description: "Rotate JPG, PNG, or WEBP by 90°, 180°, 270°, or any angle",
    longDescription: "Rotate any image left, right, or upside down — JPG, PNG, WEBP, HEIC, BMP, GIF, TIFF. Choose 90°, 180°, 270°, or enter a custom angle for free rotation (the canvas auto-expands so nothing gets cropped). Output is downscaled losslessly when possible; transparency is preserved for PNG and WEBP.",
    synonyms: "turn spin angle 90 180 270 sideways tilt upright",
    popularity: 41,
    category: "image", accepts: ".jpg,.jpeg,.png,.webp,.bmp,.gif,.tif,.tiff", outputLabel: "rotated.png",
  },
  {
    slug: "flip-image", icon: ImageIcon, name: "Flip Image",
    description: "Mirror an image horizontally or vertically",
    longDescription: "Flip any image left-to-right (horizontal mirror) or top-to-bottom (vertical mirror). Works on JPG, PNG, WEBP, HEIC, BMP, GIF, and TIFF. Useful for selfies that come out mirrored, recreating reflections, or preparing assets for design layouts. Transparency is preserved for PNG and WEBP.",
    synonyms: "mirror reverse horizontal vertical selfie unmirror reflect",
    popularity: 42,
    category: "image", accepts: ".jpg,.jpeg,.png,.webp,.bmp,.gif,.tif,.tiff", outputLabel: "flipped.png",
  },
];

// Sort by popularity rank (lower = more searched / used). Stable sort
// preserves the in-file order for ties, so category groupings remain readable.
export const nonPdfTools: NonPdfTool[] = _nonPdfToolsRaw
  .slice()
  .sort((a, b) => (a.popularity ?? 999) - (b.popularity ?? 999));

export const nonPdfToolBySlug = Object.fromEntries(nonPdfTools.map(t => [t.slug, t]));

export const nonPdfCategoryMeta: Record<NonPdfCategory, { label: string; accent: string; iconBg: string; iconColor: string }> = {
  "image": { label: "Image & Media", accent: "text-pink-400", iconBg: "bg-pink-500/10", iconColor: "text-pink-400" },
  "video-audio": { label: "Video & Audio", accent: "text-orange-400", iconBg: "bg-orange-500/10", iconColor: "text-orange-400" },
  "developer": { label: "Developer & Text", accent: "text-cyan-400", iconBg: "bg-cyan-500/10", iconColor: "text-cyan-400" },
  "archive": { label: "Archive & Files", accent: "text-yellow-400", iconBg: "bg-yellow-500/10", iconColor: "text-yellow-400" },
  "document-office": { label: "Documents & Office", accent: "text-lime-400", iconBg: "bg-lime-500/10", iconColor: "text-lime-400" },
};
