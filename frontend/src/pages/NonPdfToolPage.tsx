import { useParams, Link } from "react-router-dom";
import { useEffect, useRef, Suspense, lazy, type ComponentType } from "react";
import { nonPdfToolBySlug, nonPdfTools, nonPdfCategoryMeta, type NonPdfCategory } from "@/data/non-pdf-tools";
import { postsForTool } from "@/data/blog";
import { cn } from "@/lib/utils";
import { Shield, ChevronRight, ArrowLeft, Github, ArrowUpRight, ArrowRight, Lock } from "lucide-react";
import { useHistory } from "@/hooks/useHistory";
import { GenericUI } from "@/components/tool-ui/GenericUI";
import { EditorialMasthead } from "@/components/EditorialMasthead";
import { EditorialFooter } from "@/components/EditorialFooter";
import { ToolIllustration } from "@/components/ToolIllustration";

type AnyModule = Record<string, unknown>;

function lazyNamed<T extends AnyModule>(loader: () => Promise<T>, exportName: keyof T) {
  return lazy(async () => ({
    default: (await loader())[exportName] as ComponentType,
  }));
}

const LazyImageCompressorUI = lazyNamed(() => import("@/components/tool-ui/ImageCompressorUI"), "ImageCompressorUI");
const LazyImageConverterUI = lazyNamed(() => import("@/components/tool-ui/ImageConverterUI"), "ImageConverterUI");
const LazyRemoveExifUI = lazyNamed(() => import("@/components/tool-ui/RemoveExifUI"), "RemoveExifUI");
const LazyResizeCropImageUI = lazyNamed(() => import("@/components/tool-ui/ResizeCropImageUI"), "ResizeCropImageUI");
const LazyVideoToGifUI = lazyNamed(() => import("@/components/tool-ui/VideoToGifUI"), "VideoToGifUI");
const LazyExtractAudioUI = lazyNamed(() => import("@/components/tool-ui/ExtractAudioUI"), "ExtractAudioUI");
const LazyTrimMediaUI = lazyNamed(() => import("@/components/tool-ui/TrimMediaUI"), "TrimMediaUI");
const LazyCompressVideoUI = lazyNamed(() => import("@/components/tool-ui/CompressVideoUI"), "CompressVideoUI");
const LazyJsonXmlFormatterUI = lazyNamed(() => import("@/components/tool-ui/JsonXmlFormatterUI"), "JsonXmlFormatterUI");
const LazyTextDiffUI = lazyNamed(() => import("@/components/tool-ui/TextDiffUI"), "TextDiffUI");
const LazyBase64UI = lazyNamed(() => import("@/components/tool-ui/Base64UI"), "Base64UI");
const LazyHashGeneratorUI = lazyNamed(() => import("@/components/tool-ui/HashGeneratorUI"), "HashGeneratorUI");
const LazyExtractArchiveUI = lazyNamed(() => import("@/components/tool-ui/ExtractArchiveUI"), "ExtractArchiveUI");
const LazyCreateZipUI = lazyNamed(() => import("@/components/tool-ui/CreateZipUI"), "CreateZipUI");
const LazyCsvJsonUI = lazyNamed(() => import("@/components/tool-ui/CsvJsonUI"), "CsvJsonUI");
const LazyMarkdownHtmlUI = lazyNamed(() => import("@/components/tool-ui/MarkdownHtmlUI"), "MarkdownHtmlUI");
const LazyImageOcrUI = lazyNamed(() => import("@/components/tool-ui/ImageOcrUI"), "ImageOcrUI");
const LazyBarcodeGeneratorUI = lazyNamed(() => import("@/components/tool-ui/BarcodeGeneratorUI"), "BarcodeGeneratorUI");
const LazyUrlToPdfUI = lazyNamed(() => import("@/components/tool-ui/UrlToPdfUI"), "UrlToPdfUI");
const LazyImageWatermarkUI = lazyNamed(() => import("@/components/tool-ui/ImageWatermarkUI"), "ImageWatermarkUI");
const LazyCollageUI = lazyNamed(() => import("@/components/tool-ui/CollageUI"), "CollageUI");
const LazyBackgroundRemoverUI = lazyNamed(() => import("@/components/tool-ui/BackgroundRemoverUI"), "BackgroundRemoverUI");
const LazySvgToPngUI = lazyNamed(() => import("@/components/tool-ui/SvgToPngUI"), "SvgToPngUI");
const LazyHeicToJpgUI = lazyNamed(() => import("@/components/tool-ui/HeicToJpgUI"), "HeicToJpgUI");
const LazyFaviconUI = lazyNamed(() => import("@/components/tool-ui/FaviconUI"), "FaviconUI");
const LazyQrReaderUI = lazyNamed(() => import("@/components/tool-ui/QrReaderUI"), "QrReaderUI");
const LazyMergeImagesUI = lazyNamed(() => import("@/components/tool-ui/MergeImagesUI"), "MergeImagesUI");

// Round-N video tools (added 2026-05-04)
const LazyVideoToPdfUI    = lazyNamed(() => import("@/components/tool-ui/VideoToolVariants"), "VideoToPdfUI");
const LazyVideoConverterUI = lazyNamed(() => import("@/components/tool-ui/VideoToolVariants"), "VideoConverterUI");
const LazyVideoResizerUI  = lazyNamed(() => import("@/components/tool-ui/VideoToolVariants"), "VideoResizerUI");
const LazyVideoThumbnailUI = lazyNamed(() => import("@/components/tool-ui/VideoToolVariants"), "VideoThumbnailUI");
const LazyGifToMp4UI      = lazyNamed(() => import("@/components/tool-ui/VideoToolVariants"), "GifToMp4UI");
const LazyAddSubtitlesUI  = lazyNamed(() => import("@/components/tool-ui/VideoToolVariants"), "AddSubtitlesUI");

// Round-O client-only utilities (all in /components/tool-ui/UtilityTools.tsx)
const LazySubtitleConverterUI = lazyNamed(() => import("@/components/tool-ui/SubtitleConverterUI"), "SubtitleConverterUI");
const LazyPasswordGenUI   = lazyNamed(() => import("@/components/tool-ui/UtilityTools"), "PasswordGeneratorUI");
const LazyUuidGenUI       = lazyNamed(() => import("@/components/tool-ui/UtilityTools"), "UuidGeneratorUI");
const LazyLoremUI         = lazyNamed(() => import("@/components/tool-ui/UtilityTools"), "LoremIpsumUI");
const LazyWordCounterUI   = lazyNamed(() => import("@/components/tool-ui/UtilityTools"), "WordCounterUI");
const LazyColorConverterUI = lazyNamed(() => import("@/components/tool-ui/UtilityTools"), "ColorConverterUI");
const LazyUrlEncoderUI    = lazyNamed(() => import("@/components/tool-ui/UtilityTools"), "UrlEncoderUI");

// v1.2.0 browser-only utilities (also live in UtilityTools.tsx)
const LazyJwtDecoderUI         = lazyNamed(() => import("@/components/tool-ui/UtilityTools"), "JwtDecoderUI");
const LazyRegexTesterUI        = lazyNamed(() => import("@/components/tool-ui/UtilityTools"), "RegexTesterUI");
const LazyTimestampConverterUI = lazyNamed(() => import("@/components/tool-ui/UtilityTools"), "TimestampConverterUI");

// v1.4.0 browser-only converters
const LazyYamlToJsonUI       = lazyNamed(() => import("@/components/tool-ui/UtilityTools"), "YamlToJsonConverterUI");
const LazyJsonToYamlUI       = lazyNamed(() => import("@/components/tool-ui/UtilityTools"), "JsonToYamlConverterUI");
const LazyCaseConverterUI    = lazyNamed(() => import("@/components/tool-ui/UtilityTools"), "CaseConverterUI");

// v1.5.0 / phase 7 — competitor-gap tools
const LazyVideoSpeedUI       = lazyNamed(() => import("@/components/tool-ui/Phase7Tools"), "VideoSpeedUI");
const LazyAudioTrimUI        = lazyNamed(() => import("@/components/tool-ui/Phase7Tools"), "AudioTrimUI");
const LazyImagePaletteUI     = lazyNamed(() => import("@/components/tool-ui/Phase7Tools"), "ImagePaletteUI");
const LazyPixelateImageUI    = lazyNamed(() => import("@/components/tool-ui/Phase7Tools"), "PixelateImageUI");

// Round-U dedicated UIs (formerly fell through to GenericUI)
const LazyMultiFileUI       = lazyNamed(() => import("@/components/tool-ui/MultiFileUI"), "MultiFileUI");
const LazyAudioConverterUI  = lazyNamed(() => import("@/components/tool-ui/AudioConverterUI"), "AudioConverterUI");
const LazyImageUpscalerUI   = lazyNamed(() => import("@/components/tool-ui/ImageUpscalerUI"), "ImageUpscalerUI");

function CategoryToolNav({ currentSlug, category }: { currentSlug: string; category: NonPdfCategory }) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const categoryTools = nonPdfTools.filter(t => t.category === category);
  const meta = nonPdfCategoryMeta[category];
  useEffect(() => {
    const el = scrollRef.current?.querySelector('[data-active="true"]');
    if (el) el.scrollIntoView({ behavior: "smooth", inline: "center", block: "nearest" });
  }, [currentSlug]);
  return (
    <div className="mb-6 min-w-0 max-w-full">
      <p className="font-mono-meta text-[10px] text-muted-foreground/80 mb-2">{meta.label} — {categoryTools.length} tools</p>
      <div ref={scrollRef} className="flex items-center gap-1 overflow-x-auto no-scrollbar pb-1 w-full max-w-full">
        {categoryTools.map(t => {
          const TIcon = t.icon;
          const isActive = t.slug === currentSlug;
          return (
            <Link key={t.slug} to={`/tools/${t.slug}`} data-active={isActive}
              className={cn(
                "flex items-center gap-1.5 whitespace-nowrap px-2.5 py-1.5 text-[12px] font-sans-ui font-medium transition-all shrink-0 border-b-2",
                isActive ? "border-primary text-primary" : "border-transparent text-muted-foreground/80 hover:text-foreground hover:border-foreground/20"
              )}>
              <TIcon size={12} strokeWidth={1.75} />
              {t.name}
            </Link>
          );
        })}
      </div>
      <div className="rule-thin" />
    </div>
  );
}

function ToolLoadingCard() {
  return (
    <div className="space-y-4" role="status" aria-label="Loading tool">
      <div className="rounded-2xl border-2 border-dashed border-border/60 bg-card/40 p-10 sm:p-14">
        <div className="mx-auto flex max-w-sm flex-col items-center gap-3">
          <div className="h-12 w-12 rounded-2xl bg-secondary/70 animate-pulse" />
          <div className="h-4 w-44 rounded-md bg-secondary/70 animate-pulse" />
          <div className="h-3 w-28 rounded-md bg-secondary/50 animate-pulse" />
        </div>
      </div>
      <div className="flex items-center justify-between gap-3">
        <div className="h-9 w-28 rounded-xl bg-secondary/60 animate-pulse" />
        <div className="h-10 w-36 rounded-xl bg-primary/30 animate-pulse" />
      </div>
      <span className="sr-only">Loading…</span>
    </div>
  );
}

function ToolUI({ slug, toolName, outputLabel, accepts }: { slug: string; toolName: string; outputLabel: string; accepts: string }) {
  switch (slug) {
    case "image-compressor": return <LazyImageCompressorUI />;
    case "image-converter": return <LazyImageConverterUI />;
    case "remove-exif": return <LazyRemoveExifUI />;
    case "resize-crop-image": return <LazyResizeCropImageUI />;
    case "video-to-gif": return <LazyVideoToGifUI />;
    case "extract-audio": return <LazyExtractAudioUI />;
    case "trim-media": return <LazyTrimMediaUI />;
    case "compress-video": return <LazyCompressVideoUI />;
    case "json-xml-formatter": return <LazyJsonXmlFormatterUI />;
    case "text-diff": return <LazyTextDiffUI />;
    case "base64": return <LazyBase64UI />;
    case "hash-generator": return <LazyHashGeneratorUI />;
    case "extract-archive": return <LazyExtractArchiveUI />;
    case "create-zip": return <LazyCreateZipUI />;
    case "csv-json": return <LazyCsvJsonUI />;
    case "markdown-html": return <LazyMarkdownHtmlUI />;
    case "image-ocr": return <LazyImageOcrUI />;
    case "generate-barcode": return <LazyBarcodeGeneratorUI />;
    case "url-to-pdf": return <LazyUrlToPdfUI />;
    case "image-watermark": return <LazyImageWatermarkUI />;
    case "make-collage": return <LazyCollageUI />;
    case "remove-background": return <LazyBackgroundRemoverUI />;
    case "svg-to-png": return <LazySvgToPngUI />;
    case "heic-to-jpg": return <LazyHeicToJpgUI />;
    case "generate-favicon": return <LazyFaviconUI />;
    case "qr-reader": return <LazyQrReaderUI />;
    case "merge-images": return <LazyMergeImagesUI />;
    // Round-N video tools
    case "video-to-pdf":   return <LazyVideoToPdfUI />;
    case "video-converter": return <LazyVideoConverterUI />;
    case "video-resizer":  return <LazyVideoResizerUI />;
    case "video-thumbnail": return <LazyVideoThumbnailUI />;
    case "gif-to-mp4":     return <LazyGifToMp4UI />;
    case "add-subtitles":  return <LazyAddSubtitlesUI />;
    // Round-O utilities
    case "password-generator": return <LazyPasswordGenUI />;
    case "uuid-generator":     return <LazyUuidGenUI />;
    case "lorem-ipsum":        return <LazyLoremUI />;
    case "word-counter":       return <LazyWordCounterUI />;
    case "color-converter":    return <LazyColorConverterUI />;
    case "url-encoder":        return <LazyUrlEncoderUI />;
    case "subtitle-converter": return <LazySubtitleConverterUI />;
    // Round-U
    case "audio-converter":    return <LazyAudioConverterUI />;
    case "image-upscaler":     return <LazyImageUpscalerUI />;
    case "audio-merge":
      return <LazyMultiFileUI
        endpoint="/audio-merge"
        accepts="audio/*,.mp3,.wav,.ogg,.flac,.aac,.m4a"
        outputFilename="merged.mp3"
        fileLabel="audio files"
        actionVerb="Merge"
        ordered={true}
      />;
    case "video-merge":
      return <LazyMultiFileUI
        endpoint="/video-merge"
        accepts="video/*,.mp4,.mov,.avi,.mkv,.webm"
        outputFilename="merged.mp4"
        fileLabel="videos"
        actionVerb="Merge"
        ordered={true}
      />;
    // v1.2.0 — browser-only dev utilities
    case "jwt-decoder":         return <LazyJwtDecoderUI />;
    case "regex-tester":        return <LazyRegexTesterUI />;
    case "timestamp-converter": return <LazyTimestampConverterUI />;
    // v1.2.0 — image-converter SEO aliases (preset target_format)
    case "webp-to-jpg":
      return <GenericUI toolName={toolName} outputLabel={outputLabel} accepts=".webp" slug={slug} apiEndpoint="/image-converter" params={{ target_format: "jpeg" }} />;
    case "webp-to-png":
      return <GenericUI toolName={toolName} outputLabel={outputLabel} accepts=".webp" slug={slug} apiEndpoint="/image-converter" params={{ target_format: "png" }} />;
    case "heic-to-png":
      return <GenericUI toolName={toolName} outputLabel={outputLabel} accepts=".heic,.heif" slug={slug} apiEndpoint="/image-converter" params={{ target_format: "png" }} />;
    // v1.4.0 — additional image-converter aliases
    case "jpg-to-png":
      return <GenericUI toolName={toolName} outputLabel={outputLabel} accepts=".jpg,.jpeg" slug={slug} apiEndpoint="/image-converter" params={{ target_format: "png" }} />;
    case "png-to-jpg":
      return <GenericUI toolName={toolName} outputLabel={outputLabel} accepts=".png" slug={slug} apiEndpoint="/image-converter" params={{ target_format: "jpeg" }} />;
    case "jpg-to-webp":
      return <GenericUI toolName={toolName} outputLabel={outputLabel} accepts=".jpg,.jpeg" slug={slug} apiEndpoint="/image-converter" params={{ target_format: "webp" }} />;
    case "png-to-webp":
      return <GenericUI toolName={toolName} outputLabel={outputLabel} accepts=".png" slug={slug} apiEndpoint="/image-converter" params={{ target_format: "webp" }} />;
    case "tiff-to-jpg":
      return <GenericUI toolName={toolName} outputLabel={outputLabel} accepts=".tif,.tiff" slug={slug} apiEndpoint="/image-converter" params={{ target_format: "jpeg" }} />;
    case "tiff-to-png":
      return <GenericUI toolName={toolName} outputLabel={outputLabel} accepts=".tif,.tiff" slug={slug} apiEndpoint="/image-converter" params={{ target_format: "png" }} />;
    case "bmp-to-jpg":
      return <GenericUI toolName={toolName} outputLabel={outputLabel} accepts=".bmp" slug={slug} apiEndpoint="/image-converter" params={{ target_format: "jpeg" }} />;
    case "bmp-to-png":
      return <GenericUI toolName={toolName} outputLabel={outputLabel} accepts=".bmp" slug={slug} apiEndpoint="/image-converter" params={{ target_format: "png" }} />;
    case "gif-to-jpg":
      return <GenericUI toolName={toolName} outputLabel={outputLabel} accepts=".gif" slug={slug} apiEndpoint="/image-converter" params={{ target_format: "jpeg" }} />;
    case "gif-to-png":
      return <GenericUI toolName={toolName} outputLabel={outputLabel} accepts=".gif" slug={slug} apiEndpoint="/image-converter" params={{ target_format: "png" }} />;
    // v1.4.0 — audio/video converter aliases (preset format/target_format)
    case "m4a-to-mp3":
      return <GenericUI toolName={toolName} outputLabel={outputLabel} accepts=".m4a" slug={slug} apiEndpoint="/audio-converter" params={{ format: "mp3", bitrate: "192k" }} />;
    case "mp4-to-mp3":
      return <GenericUI toolName={toolName} outputLabel={outputLabel} accepts=".mp4" slug={slug} apiEndpoint="/extract-audio" params={{ format: "mp3" }} />;
    case "mov-to-mp4":
      return <GenericUI toolName={toolName} outputLabel={outputLabel} accepts=".mov" slug={slug} apiEndpoint="/video-converter" params={{ target_format: "mp4" }} />;
    case "avi-to-mp4":
      return <GenericUI toolName={toolName} outputLabel={outputLabel} accepts=".avi" slug={slug} apiEndpoint="/video-converter" params={{ target_format: "mp4" }} />;
    case "webm-to-mp4":
      return <GenericUI toolName={toolName} outputLabel={outputLabel} accepts=".webm" slug={slug} apiEndpoint="/video-converter" params={{ target_format: "mp4" }} />;
    case "mp4-to-webm":
      return <GenericUI toolName={toolName} outputLabel={outputLabel} accepts=".mp4" slug={slug} apiEndpoint="/video-converter" params={{ target_format: "webm" }} />;
    // v1.4.0 — browser-only dev converters
    case "yaml-to-json":     return <LazyYamlToJsonUI />;
    case "json-to-yaml":     return <LazyJsonToYamlUI />;
    case "case-converter":   return <LazyCaseConverterUI />;
    // ── v1.5.0 / phase 7 competitor-gap tools ──────────────────────────
    case "mute-video":
      return <GenericUI toolName={toolName} outputLabel={outputLabel} accepts=".mp4,.mov,.webm,.mkv,.avi,.m4v" slug={slug} apiEndpoint="/mute-video" />;
    case "reverse-video":
      return <GenericUI toolName={toolName} outputLabel={outputLabel} accepts=".mp4,.mov,.webm,.mkv,.avi" slug={slug} apiEndpoint="/reverse-video" />;
    case "video-speed":      return <LazyVideoSpeedUI />;
    case "audio-trim":       return <LazyAudioTrimUI />;
    case "image-palette":    return <LazyImagePaletteUI />;
    case "pixelate-image":   return <LazyPixelateImageUI />;
    default:
      return <GenericUI toolName={toolName} outputLabel={outputLabel} accepts={accepts} slug={slug} />;
  }
}

export default function NonPdfToolPage() {
  const { slug } = useParams<{ slug: string }>();
  const tool = slug ? nonPdfToolBySlug[slug] : null;
  const { addEntry } = useHistory();

  useEffect(() => {
    if (tool && slug) {
      addEntry({ slug, name: tool.name, href: `/tools/${slug}` });
    }
  }, [slug, tool, addEntry]);

  useEffect(() => {
    if (tool) {
      document.title = `${tool.name} — PrivaTools`;
      let m = document.querySelector('meta[name="description"]') as HTMLMetaElement | null;
      if (!m) {
        m = document.createElement("meta");
        m.name = "description";
        document.head.appendChild(m);
      }
      m.content = tool.longDescription || tool.description;
    }
    return () => { document.title = "PrivaTools"; };
  }, [tool]);

  const relatedTools = nonPdfTools.filter(t => t.category === tool?.category && t.slug !== slug).slice(0, 6);

  if (!tool) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="text-center">
          <p className="font-serif-body text-muted-foreground mb-4">Tool not found.</p>
          <Link to="/" className="btn-editorial inline-block">← Back to all tools</Link>
        </div>
      </div>
    );
  }

  const meta = nonPdfCategoryMeta[tool.category];

  return (
    <div className="min-h-screen bg-background">
      <EditorialMasthead />
      <main className="mx-auto max-w-6xl px-4 sm:px-6 py-8 sm:py-12">
        <nav className="font-mono-meta text-[11px] text-muted-foreground mb-6 flex items-center gap-1.5">
          <Link to="/" className="hover:text-foreground transition-colors">ALL TOOLS</Link>
          <span className="text-muted-foreground/85">›</span>
          <span className="hover:text-foreground transition-colors">{meta.label.toUpperCase()}</span>
          <span className="text-muted-foreground/85">›</span>
          <span className="text-foreground">{tool.name.toUpperCase()}</span>
        </nav>

        <CategoryToolNav currentSlug={slug!} category={tool.category} />

        <div className="grid grid-cols-1 lg:grid-cols-[1fr_280px] gap-10">
          <div>
            <div className="mb-8 flex items-start gap-4 sm:gap-6">
              <div className={cn("shrink-0 hidden sm:inline-flex", `cat-${tool.category}`)}>
                <ToolIllustration slug={slug!} fallback={tool.icon} catClass={`cat-${tool.category}`} size="lg" />
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 flex-wrap mb-3">
                  <span className="section-flag">{meta.label}</span>
                  {tool.clientOnly && <span className="section-flag !text-emerald-700 dark:!text-emerald-400 !border-emerald-500/30">CLIENT-SIDE</span>}
                </div>
                <h1 className="text-3xl sm:text-5xl font-bold text-foreground tracking-tight">{tool.name}</h1>
                <p className="text-base sm:text-lg text-muted-foreground leading-relaxed max-w-xl mt-4">{tool.longDescription || tool.description}</p>
              </div>
            </div>

            <div className="editorial-insert p-4 sm:p-6 mb-8">
              <Suspense fallback={<ToolLoadingCard />}>
                <ToolUI slug={slug!} toolName={tool.name} outputLabel={tool.outputLabel} accepts={tool.accepts} />
              </Suspense>
            </div>

            <div className="mt-10 mb-4">
              <div className="flex items-center gap-3 mb-6">
                <div className="section-flag">HOW IT WORKS</div>
                <div className="flex-1 rule-thin" />
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-5">
                {(() => {
                  // Pure-input tools (no file upload, no download — output is text shown inline).
                  // These browser-only utilities don't fit the upload→configure→download narrative.
                  const PURE_INPUT_TOOLS = new Set([
                    "jwt-decoder", "regex-tester", "timestamp-converter",
                    "password-generator", "uuid-generator", "lorem-ipsum",
                    "color-converter", "word-counter", "hash-generator",
                    "base64", "url-encoder", "csv-json", "markdown-html",
                    "json-xml-formatter", "text-diff",
                  ]);
                  // Generator tools (no input, just generate)
                  const GENERATOR_TOOLS = new Set([
                    "password-generator", "uuid-generator", "lorem-ipsum",
                    "generate-barcode",
                  ]);

                  if (slug && PURE_INPUT_TOOLS.has(slug)) {
                    if (GENERATOR_TOOLS.has(slug)) {
                      return [
                        { step: "I.", title: "Set your options", desc: "Choose length, format, character classes, or whatever the tool offers." },
                        { step: "II.", title: "Generate", desc: "Click the generate button. Runs entirely in your browser using the Web Crypto API." },
                        { step: "III.", title: "Copy the result", desc: "One-click copy. Nothing is sent to any server — verify with DevTools → Network." },
                      ];
                    }
                    return [
                      { step: "I.", title: "Paste your input", desc: "Drop text or input directly. Auto-detects format where applicable." },
                      { step: "II.", title: "See the result live", desc: "Output updates instantly as you type. Everything runs in JavaScript inside your browser." },
                      { step: "III.", title: "Copy or download", desc: "Click copy on any field. Or download as a text file if you prefer. Zero server roundtrips." },
                    ];
                  }
                  return [
                    { step: "I.", title: "Upload your file", desc: tool.clientOnly ? "Drag & drop or click to select. Processing happens locally in your browser." : "Drag & drop or click to select. Files are processed on the self-hosted server and deleted immediately after the response." },
                    { step: "II.", title: "Configure & process", desc: tool.clientOnly ? "Adjust settings and process instantly without uploading file contents." : "Adjust any settings, then process instantly." },
                    { step: "III.", title: "Download result", desc: "Your processed file is ready. Download it — no waiting, no email, no account." },
                  ];
                })().map(s => (
                  <div key={s.step} className="editorial-insert p-5">
                    <div className="font-heading text-2xl font-bold text-primary/70 mb-2">{s.step}</div>
                    <p className="font-heading text-sm font-bold text-foreground mb-1.5">{s.title}</p>
                    <p className="font-serif-body text-xs text-muted-foreground leading-relaxed">{s.desc}</p>
                  </div>
                ))}
              </div>
            </div>
          </div>

          <div className="space-y-5">
            {relatedTools.length > 0 && (
              <div className="editorial-insert p-5">
                <h3 className="font-sans-ui text-xs font-bold uppercase tracking-widest text-muted-foreground mb-4">Related tools</h3>
                <div className="space-y-0.5">
                  {relatedTools.map(t => {
                    const TIcon = t.icon;
                    return (
                      <Link key={t.slug} to={`/tools/${t.slug}`} className="flex items-center gap-3 px-2 py-2 hover:bg-card/60 transition-colors group">
                        <TIcon size={14} strokeWidth={1.75} className="text-primary shrink-0" />
                        <span className="font-serif-body text-sm text-muted-foreground group-hover:text-foreground transition-colors flex-1 truncate">{t.name}</span>
                      </Link>
                    );
                  })}
                </div>
              </div>
            )}

            {(() => {
              const posts = slug ? postsForTool(slug, 4) : [];
              if (posts.length === 0) return null;
              return (
                <div className="editorial-insert p-5">
                  <h3 className="font-sans-ui text-xs font-bold uppercase tracking-widest text-muted-foreground mb-4">Related articles</h3>
                  <div className="space-y-0.5">
                    {posts.map(p => (
                      <Link key={p.slug} to={`/blog/${p.slug}`} className="block px-2 py-2 hover:bg-card/60 transition-colors group">
                        <span className="font-serif-body text-sm text-muted-foreground group-hover:text-foreground transition-colors leading-snug block">{p.title}</span>
                      </Link>
                    ))}
                  </div>
                </div>
              );
            })()}

            <div className="editorial-insert p-5">
              <div className="flex items-center gap-2 mb-2">
                <Github size={14} className="text-foreground" />
                <span className="font-sans-ui text-sm font-bold text-foreground">Open Source</span>
              </div>
              <p className="font-serif-body text-xs text-muted-foreground leading-relaxed mb-3">100% free, no accounts, no behavioural tracking. Forever.</p>
              <a href="https://github.com/taiyeba-dg/privatools" target="_blank" rel="noopener noreferrer" className="font-sans-ui inline-flex items-center gap-1.5 text-xs text-primary font-semibold hover:underline">
                View on GitHub <ArrowUpRight size={11} />
              </a>
            </div>

            <div className="editorial-insert p-5 border-l-4 !border-l-primary">
              <p className="font-serif-body text-xs text-muted-foreground leading-relaxed">
                <Lock size={12} className="inline-block mr-1 text-primary" />
                <span className="text-foreground font-semibold">Your files stay private.</span>{" "}
                All processing happens locally on your self-hosted server — files are never sent to third parties.
              </p>
            </div>
          </div>
        </div>
      </main>
      <EditorialFooter />
    </div>
  );
}
