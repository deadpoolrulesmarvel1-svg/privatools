import { useParams, Link } from "react-router-dom";
import { useEffect, useRef, useState, Suspense, lazy, type ComponentType } from "react";
import { toolBySlug, tools, categoryMeta, type Category } from "@/data/tools";
import { postsForTool } from "@/data/blog";
import { formatReviewedDate, getToolLastReviewed } from "@/data/tool-review-dates";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { Shield, ChevronRight, Github, ExternalLink, ArrowUpRight, ArrowRight, Lock, BookOpen, GitBranch, Star } from "lucide-react";
import { useHistory } from "@/hooks/useHistory";
import { useFavorites } from "@/hooks/useFavorites";
import { Breadcrumb } from "@/components/Breadcrumb";
import { GenericUI } from "@/components/tool-ui/GenericUI";
import { ToolIllustration } from "@/components/ToolIllustration";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { ToolSkeleton } from "@/components/ToolSkeleton";

type AnyModule = Record<string, unknown>;

// Preserve the exported component's prop signature through React.lazy so
// the call site can keep passing its actual props without TS treating it
// as ComponentType<{}>.
function lazyNamed<T extends AnyModule, K extends keyof T>(
  loader: () => Promise<T>,
  exportName: K,
) {
  return lazy(async () => ({
    default: (await loader())[exportName] as T[K] extends ComponentType<infer P>
      ? ComponentType<P>
      : never,
  })) as unknown as T[K] extends ComponentType<infer P> ? ComponentType<P> : never;
}

const LazyMergeUI = lazyNamed(() => import("@/components/tool-ui/MergeUI"), "MergeUI");
const LazySplitUI = lazyNamed(() => import("@/components/tool-ui/SplitUI"), "SplitUI");
const LazySplitByBookmarksUI = lazyNamed(() => import("@/components/tool-ui/SplitByBookmarksUI"), "SplitByBookmarksUI");
const LazySplitBySizeUI = lazyNamed(() => import("@/components/tool-ui/SplitBySizeUI"), "SplitBySizeUI");
const LazyCompressUI = lazyNamed(() => import("@/components/tool-ui/CompressUI"), "CompressUI");
const LazyProtectUI = lazyNamed(() => import("@/components/tool-ui/ProtectUI"), "ProtectUI");
const LazyWatermarkUI = lazyNamed(() => import("@/components/tool-ui/WatermarkUI"), "WatermarkUI");
const LazySignUI = lazyNamed(() => import("@/components/tool-ui/SignUI"), "SignUI");
const LazyCompareUI = lazyNamed(() => import("@/components/tool-ui/CompareUI"), "CompareUI");
const LazyOcrUI = lazyNamed(() => import("@/components/tool-ui/OcrUI"), "OcrUI");
const LazyPageNumbersUI = lazyNamed(() => import("@/components/tool-ui/PageNumbersUI"), "PageNumbersUI");
const LazyOrganizeUI = lazyNamed(() => import("@/components/tool-ui/OrganizeUI"), "OrganizeUI");
const LazyDeletePagesUI = lazyNamed(() => import("@/components/tool-ui/DeletePagesUI"), "DeletePagesUI");
const LazyExtractPagesUI = lazyNamed(() => import("@/components/tool-ui/ExtractPagesUI"), "ExtractPagesUI");
const LazyHeaderFooterUI = lazyNamed(() => import("@/components/tool-ui/HeaderFooterUI"), "HeaderFooterUI");
const LazyBookmarksUI = lazyNamed(() => import("@/components/tool-ui/BookmarksUI"), "BookmarksUI");
const LazyBatesUI = lazyNamed(() => import("@/components/tool-ui/BatesUI"), "BatesUI");
const LazyResizeUI = lazyNamed(() => import("@/components/tool-ui/ResizeUI"), "ResizeUI");
const LazyRedactUI = lazyNamed(() => import("@/components/tool-ui/RedactUI"), "RedactUI");
const LazyMetadataUI = lazyNamed(() => import("@/components/tool-ui/MetadataUI"), "MetadataUI");
const LazyNupUI = lazyNamed(() => import("@/components/tool-ui/NupUI"), "NupUI");
const LazyQrCodeUI = lazyNamed(() => import("@/components/tool-ui/QrCodeUI"), "QrCodeUI");
const LazyRemoveBlankPagesUI = lazyNamed(() => import("@/components/tool-ui/RemoveBlankPagesUI"), "RemoveBlankPagesUI");
const LazyAutoCropUI = lazyNamed(() => import("@/components/tool-ui/AutoCropUI"), "AutoCropUI");
const LazyPdfToEpubUI = lazyNamed(() => import("@/components/tool-ui/PdfToEpubUI"), "PdfToEpubUI");
const LazyMarkdownToPdfUI = lazyNamed(() => import("@/components/tool-ui/MarkdownToPdfUI"), "MarkdownToPdfUI");
const LazyCsvToPdfUI = lazyNamed(() => import("@/components/tool-ui/CsvToPdfUI"), "CsvToPdfUI");
const LazyAddHyperlinksUI = lazyNamed(() => import("@/components/tool-ui/AddHyperlinksUI"), "AddHyperlinksUI");
const LazyFormCreatorUI = lazyNamed(() => import("@/components/tool-ui/FormCreatorUI"), "FormCreatorUI");
const LazyTransparentBackgroundUI = lazyNamed(() => import("@/components/tool-ui/TransparentBackgroundUI"), "TransparentBackgroundUI");
const LazyInvertColorsUI = lazyNamed(() => import("@/components/tool-ui/InvertColorsUI"), "InvertColorsUI");
const LazyPdfaValidatorUI = lazyNamed(() => import("@/components/tool-ui/PdfaValidatorUI"), "PdfaValidatorUI");
const LazyVerifySignatureUI = lazyNamed(() => import("@/components/tool-ui/VerifySignatureUI"), "VerifySignatureUI");
const LazySanitizeUI = lazyNamed(() => import("@/components/tool-ui/SanitizeUI"), "SanitizeUI");
const LazyUnlockUI = lazyNamed(() => import("@/components/tool-ui/UnlockUI"), "UnlockUI");
const LazyPdfToImageUI = lazyNamed(() => import("@/components/tool-ui/PdfToImageUI"), "PdfToImageUI");
const LazyImageToPdfUI = lazyNamed(() => import("@/components/tool-ui/ImageToPdfUI"), "ImageToPdfUI");
const LazyJpgToPdfUI  = lazyNamed(() => import("@/components/tool-ui/NamedImageToPdfVariants"), "JpgToPdfUI");
const LazyPngToPdfUI  = lazyNamed(() => import("@/components/tool-ui/NamedImageToPdfVariants"), "PngToPdfUI");
const LazyHeicToPdfUI = lazyNamed(() => import("@/components/tool-ui/NamedImageToPdfVariants"), "HeicToPdfUI");
const LazyWebpToPdfUI = lazyNamed(() => import("@/components/tool-ui/NamedImageToPdfVariants"), "WebpToPdfUI");
const LazyTiffToPdfUI = lazyNamed(() => import("@/components/tool-ui/NamedImageToPdfVariants"), "TiffToPdfUI");
const LazyBmpToPdfUI  = lazyNamed(() => import("@/components/tool-ui/NamedImageToPdfVariants"), "BmpToPdfUI");
const LazyGifToPdfUI  = lazyNamed(() => import("@/components/tool-ui/NamedImageToPdfVariants"), "GifToPdfUI");
const LazySvgToPdfUI  = lazyNamed(() => import("@/components/tool-ui/NamedImageToPdfVariants"), "SvgToPdfUI");
const LazyPdfToTiffUI = lazyNamed(() => import("@/components/tool-ui/NamedPdfToImageVariants"), "PdfToTiffUI");
const LazyPdfToBmpUI  = lazyNamed(() => import("@/components/tool-ui/NamedPdfToImageVariants"), "PdfToBmpUI");
const LazyPdfToGifUI  = lazyNamed(() => import("@/components/tool-ui/NamedPdfToImageVariants"), "PdfToGifUI");
const LazyPdfToSvgUI  = lazyNamed(() => import("@/components/tool-ui/NamedPdfToImageVariants"), "PdfToSvgUI");
const LazyPdfToJpgUI  = lazyNamed(() => import("@/components/tool-ui/NamedPdfToImageVariants"), "PdfToJpgUI");
const LazyPdfToPngUI  = lazyNamed(() => import("@/components/tool-ui/NamedPdfToImageVariants"), "PdfToPngUI");
const LazySplitInHalfUI = lazyNamed(() => import("@/components/tool-ui/SplitInHalfUI"), "SplitInHalfUI");
const LazySplitByTextUI = lazyNamed(() => import("@/components/tool-ui/SplitByTextUI"), "SplitByTextUI");
const LazyHighlightUI = lazyNamed(() => import("@/components/tool-ui/HighlightUI"), "HighlightUI");
const LazySummarizePdfUI = lazyNamed(() => import("@/components/tool-ui/SummarizePdfUI"), "SummarizePdfUI");
const LazySmartRedactUI = lazyNamed(() => import("@/components/tool-ui/SmartRedactUI"), "SmartRedactUI");
const LazyHtmlToPdfUI = lazyNamed(() => import("@/components/tool-ui/HtmlToPdfUI"), "HtmlToPdfUI");
const LazyCropUI = lazyNamed(() => import("@/components/tool-ui/CropUI"), "CropUI");
const LazyPdfToTextUI = lazyNamed(() => import("@/components/tool-ui/PdfToTextUI"), "PdfToTextUI");
const LazyRotateUI = lazyNamed(() => import("@/components/tool-ui/RotateUI"), "RotateUI");
const LazyFillFormUI = lazyNamed(() => import("@/components/tool-ui/FillFormUI"), "FillFormUI");
const LazyEditPdfUI = lazyNamed(() => import("@/components/tool-ui/EditPdfUI"), "EditPdfUI");
const LazyStampUI = lazyNamed(() => import("@/components/tool-ui/StampUI"), "StampUI");
const LazyESignUI = lazyNamed(() => import("@/components/tool-ui/ESignUI"), "ESignUI");
const LazyPermissionsUI = lazyNamed(() => import("@/components/tool-ui/PermissionsUI"), "PermissionsUI");
const LazyAttachmentUI = lazyNamed(() => import("@/components/tool-ui/AttachmentUI"), "AttachmentUI");
const LazyAnnotateUI = lazyNamed(() => import("@/components/tool-ui/AnnotateUI"), "AnnotateUI");
const LazyShapesUI = lazyNamed(() => import("@/components/tool-ui/ShapesUI"), "ShapesUI");
const LazyWhiteoutUI = lazyNamed(() => import("@/components/tool-ui/WhiteoutUI"), "WhiteoutUI");
const LazyOverlayUI = lazyNamed(() => import("@/components/tool-ui/OverlayUI"), "OverlayUI");
const LazyAlternateMixUI = lazyNamed(() => import("@/components/tool-ui/AlternateMixUI"), "AlternateMixUI");
const LazyPdfToWordUI = lazyNamed(() => import("@/components/tool-ui/PdfToWordUI"), "PdfToWordUI");
const LazyPdfToExcelUI = lazyNamed(() => import("@/components/tool-ui/PdfToExcelUI"), "PdfToExcelUI");
const LazyPdfToPptxUI = lazyNamed(() => import("@/components/tool-ui/PdfToPptxUI"), "PdfToPptxUI");

const loadSimpleConvertUI = () => import("@/components/tool-ui/SimpleConvertUI");
const LazyPdfToMarkdownUI2 = lazyNamed(loadSimpleConvertUI, "PdfToMarkdownUI2");
const LazyExtractImagesUI = lazyNamed(loadSimpleConvertUI, "ExtractImagesUI");
const LazyExtractTablesUI = lazyNamed(loadSimpleConvertUI, "ExtractTablesUI");
const LazyPdfToPdfaUI = lazyNamed(loadSimpleConvertUI, "PdfToPdfaUI");
const LazyWordToPdfUI = lazyNamed(loadSimpleConvertUI, "WordToPdfUI");
const LazyExcelToPdfUI = lazyNamed(loadSimpleConvertUI, "ExcelToPdfUI");
const LazyPptxToPdfUI = lazyNamed(loadSimpleConvertUI, "PptxToPdfUI");
const LazyTxtToPdfUI = lazyNamed(loadSimpleConvertUI, "TxtToPdfUI");
const LazyJsonToPdfUI = lazyNamed(loadSimpleConvertUI, "JsonToPdfUI");
const LazyXmlToPdfUI = lazyNamed(loadSimpleConvertUI, "XmlToPdfUI");
const LazyEpubToPdfUI = lazyNamed(loadSimpleConvertUI, "EpubToPdfUI");
const LazyRtfToPdfUI = lazyNamed(loadSimpleConvertUI, "RtfToPdfUI");
const LazyFlattenUI = lazyNamed(loadSimpleConvertUI, "FlattenUI");
const LazyDeskewUI = lazyNamed(loadSimpleConvertUI, "DeskewUI");
const LazyRepairUI = lazyNamed(loadSimpleConvertUI, "RepairUI");
const LazyGrayscaleUI = lazyNamed(loadSimpleConvertUI, "GrayscaleUI");
const LazyStripMetadataUI = lazyNamed(() => import("@/components/tool-ui/StripMetadataUI"), "StripMetadataUI");
const LazyDeleteAnnotationsUI = lazyNamed(loadSimpleConvertUI, "DeleteAnnotationsUI");
const LazyOfficeToPdfUI = lazyNamed(loadSimpleConvertUI, "OfficeToPdfUI");
const LazyReversePdfUI = lazyNamed(loadSimpleConvertUI, "ReversePdfUI");
const LazyBookletUI = lazyNamed(loadSimpleConvertUI, "BookletUI");
const LazyMultiFileUI = lazyNamed(() => import("@/components/tool-ui/MultiFileUI"), "MultiFileUI");
const LazyPdfPageCounterUI = lazyNamed(() => import("@/components/tool-ui/PdfPageCounterUI"), "PdfPageCounterUI");

// Map tool slugs to related blog posts for internal linking
const TOOL_BLOG_LINKS: Record<string, { slug: string; title: string }[]> = {
  "merge-pdf": [
    { slug: "merge-pdf-files-online-free", title: "How to Merge PDF Files Online for Free" },
    { slug: "best-free-pdf-tools-2026", title: "Best Free PDF Tools in 2026" },
  ],
  "split-pdf": [
    { slug: "split-pdf-online-free", title: "How to Split a PDF File Online — 3 Methods" },
  ],
  "split-by-bookmarks": [
    { slug: "split-pdf-online-free", title: "How to Split a PDF File Online — 3 Methods" },
  ],
  "split-by-size": [
    { slug: "split-pdf-online-free", title: "How to Split a PDF File Online — 3 Methods" },
  ],
  "compress-pdf": [
    { slug: "compress-pdf-without-losing-quality", title: "How to Compress a PDF Without Losing Quality" },
    { slug: "best-free-pdf-tools-2026", title: "Best Free PDF Tools in 2026" },
  ],
  "edit-pdf": [
    { slug: "edit-pdf-online-free-no-sign-up", title: "How to Edit a PDF Online — No Sign-Up" },
    { slug: "best-free-online-pdf-editors-2026", title: "Best Free Online PDF Editors in 2026" },
  ],
  "sign-pdf": [
    { slug: "edit-pdf-online-free-no-sign-up", title: "How to Edit a PDF Online — No Sign-Up" },
  ],
  "esign-pdf": [
    { slug: "edit-pdf-online-free-no-sign-up", title: "How to Edit a PDF Online — No Sign-Up" },
  ],
  "annotate-pdf": [
    { slug: "edit-pdf-online-free-no-sign-up", title: "How to Edit a PDF Online — No Sign-Up" },
  ],
  "protect-pdf": [
    { slug: "remove-password-from-pdf", title: "How to Remove a Password from a PDF" },
  ],
  "unlock-pdf": [
    { slug: "remove-password-from-pdf", title: "How to Remove a Password from a PDF" },
  ],
  "redact-pdf": [
    { slug: "redact-pdf-free-guide", title: "How to Redact Sensitive Information from PDFs" },
  ],
  "word-to-pdf": [
    { slug: "convert-word-to-pdf-free", title: "How to Convert Word to PDF for Free" },
  ],
  "office-to-pdf": [
    { slug: "convert-word-to-pdf-free", title: "How to Convert Word to PDF for Free" },
  ],
  "pdf-to-word": [
    { slug: "best-free-pdf-tools-2026", title: "Best Free PDF Tools in 2026" },
  ],
  "ocr-pdf": [
    { slug: "best-free-pdf-tools-2026", title: "Best Free PDF Tools in 2026" },
  ],
  "fill-form": [
    { slug: "edit-pdf-online-free-no-sign-up", title: "How to Edit a PDF Online — No Sign-Up" },
  ],
  "form-creator": [
    { slug: "edit-pdf-online-free-no-sign-up", title: "How to Edit a PDF Online — No Sign-Up" },
  ],
  "flatten-pdf": [
    { slug: "best-free-pdf-tools-2026", title: "Best Free PDF Tools in 2026" },
  ],
  "watermark": [
    { slug: "edit-pdf-online-free-no-sign-up", title: "How to Edit a PDF Online — No Sign-Up" },
  ],
  "strip-metadata": [
    { slug: "redact-pdf-free-guide", title: "How to Redact Sensitive Information from PDFs" },
  ],
  "sanitize-pdf": [
    { slug: "redact-pdf-free-guide", title: "How to Redact Sensitive Information from PDFs" },
  ],
};

function CategoryToolNav({ currentSlug, category }: { currentSlug: string; category: Category }) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const categoryTools = tools.filter(t => t.category === category);
  const meta = categoryMeta[category];
  useEffect(() => {
    const el = scrollRef.current?.querySelector('[data-active="true"]');
    if (el) el.scrollIntoView({ behavior: "smooth", inline: "center", block: "nearest" });
  }, [currentSlug]);
  return (
    <div className="border-t border-border pt-5 -mx-4 sm:mx-0 overflow-hidden">
      <div className="flex items-baseline gap-2 mb-3 px-4 sm:px-0">
        <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">More {meta.label.toLowerCase()} tools</p>
        <span className="text-[11px] font-mono text-muted-foreground/80">{categoryTools.length}</span>
      </div>
      <div ref={scrollRef} className="flex items-center gap-1.5 overflow-x-auto no-scrollbar pb-1 px-4 sm:px-0">
        {categoryTools.map(t => {
          const TIcon = t.icon;
          const isActive = t.slug === currentSlug;
          return (
            <Link key={t.slug} to={`/tool/${t.slug}`} data-active={isActive}
              className={cn(
                "inline-flex items-center gap-1.5 whitespace-nowrap h-8 px-3 text-[12.5px] font-medium rounded-full transition-all shrink-0 border",
                isActive
                  ? "bg-primary text-primary-foreground border-primary"
                  : "border-border text-muted-foreground hover:text-foreground hover:bg-secondary"
              )}>
              <TIcon size={12} strokeWidth={1.75} />
              {t.name}
            </Link>
          );
        })}
      </div>
    </div>
  );
}

function ToolLoadingCard() {
  return (
    <div className="space-y-4" role="status" aria-label="Loading tool">
      {/* Dropzone skeleton */}
      <div className="rounded-2xl border-2 border-dashed border-border/60 bg-card/40 p-10 sm:p-14">
        <div className="mx-auto flex max-w-sm flex-col items-center gap-3">
          <div className="h-12 w-12 rounded-2xl bg-secondary/70 animate-pulse" />
          <div className="h-4 w-44 rounded-md bg-secondary/70 animate-pulse" />
          <div className="h-3 w-28 rounded-md bg-secondary/50 animate-pulse" />
        </div>
      </div>
      {/* Action row skeleton */}
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
    case "merge-pdf": return <LazyMergeUI />;
    case "split-pdf": return <LazySplitUI />;
    case "split-by-bookmarks": return <LazySplitByBookmarksUI />;
    case "split-by-size": return <LazySplitBySizeUI />;
    case "organize-pages": return <LazyOrganizeUI />;
    case "delete-pages": return <LazyDeletePagesUI />;
    case "extract-pages": return <LazyExtractPagesUI />;
    case "edit-pdf": return <LazyEditPdfUI />;
    case "sign-pdf": return <LazySignUI />;
    case "watermark": return <LazyWatermarkUI />;
    case "header-footer": return <LazyHeaderFooterUI />;
    case "page-numbers": return <LazyPageNumbersUI />;
    case "bates-numbering": return <LazyBatesUI />;
    case "bookmarks": return <LazyBookmarksUI />;
    case "compress-pdf": return <LazyCompressUI />;
    case "resize-pdf": return <LazyResizeUI />;
    case "rotate-pdf": return <LazyRotateUI />;
    case "protect-pdf": return <LazyProtectUI />;
    case "unlock-pdf": return <LazyUnlockUI />;
    case "redact-pdf": return <LazyRedactUI />;
    case "metadata": return <LazyMetadataUI />;
    case "compare-pdf": return <LazyCompareUI />;
    case "ocr-pdf": return <LazyOcrUI />;
    case "nup": return <LazyNupUI />;
    case "qr-code": return <LazyQrCodeUI />;
    case "fill-form": return <LazyFillFormUI />;
    case "alternate-mix": return <LazyAlternateMixUI />;
    case "overlay": return <LazyOverlayUI />;
    case "form-creator": return <LazyFormCreatorUI />;
    case "pdfa-validator": return <LazyPdfaValidatorUI />;
    case "verify-signature": return <LazyVerifySignatureUI />;
    case "remove-blank-pages": return <LazyRemoveBlankPagesUI />;
    case "auto-crop": return <LazyAutoCropUI />;
    case "invert-colors": return <LazyInvertColorsUI />;
    case "crop-pdf": return <LazyCropUI />;
    case "pdf-to-epub": return <LazyPdfToEpubUI />;
    case "pdf-to-image": return <LazyPdfToImageUI />;
    case "pdf-to-text": return <LazyPdfToTextUI />;
    case "image-to-pdf": return <LazyImageToPdfUI />;
    case "jpg-to-pdf": return <LazyJpgToPdfUI />;
    case "png-to-pdf": return <LazyPngToPdfUI />;
    case "heic-to-pdf": return <LazyHeicToPdfUI />;
    case "webp-to-pdf": return <LazyWebpToPdfUI />;
    case "tiff-to-pdf": return <LazyTiffToPdfUI />;
    case "bmp-to-pdf":  return <LazyBmpToPdfUI />;
    case "gif-to-pdf":  return <LazyGifToPdfUI />;
    case "svg-to-pdf":  return <LazySvgToPdfUI />;
    case "pdf-to-tiff": return <LazyPdfToTiffUI />;
    case "pdf-to-bmp":  return <LazyPdfToBmpUI />;
    case "pdf-to-gif":  return <LazyPdfToGifUI />;
    case "pdf-to-svg":  return <LazyPdfToSvgUI />;
    case "pdf-to-jpg":  return <LazyPdfToJpgUI />;
    case "pdf-to-png":  return <LazyPdfToPngUI />;
    case "split-in-half": return <LazySplitInHalfUI />;
    case "split-by-text": return <LazySplitByTextUI />;
    case "highlight-pdf": return <LazyHighlightUI />;
    case "summarize-pdf": return <LazySummarizePdfUI />;
    case "smart-redact": return <LazySmartRedactUI />;
    case "html-to-pdf": return <LazyHtmlToPdfUI />;
    case "markdown-to-pdf": return <LazyMarkdownToPdfUI />;
    case "csv-to-pdf": return <LazyCsvToPdfUI />;
    case "add-hyperlinks": return <LazyAddHyperlinksUI />;
    case "transparent-background": return <LazyTransparentBackgroundUI />;
    case "stamp-pdf": return <LazyStampUI />;
    case "esign-pdf": return <LazyESignUI />;
    case "set-permissions": return <LazyPermissionsUI />;
    case "add-attachment": return <LazyAttachmentUI />;
    case "annotate-pdf": return <LazyAnnotateUI />;
    case "add-shapes": return <LazyShapesUI />;
    case "whiteout-pdf": return <LazyWhiteoutUI />;
    case "sanitize-pdf": return <LazySanitizeUI />;
    case "pdf-to-word": return <LazyPdfToWordUI />;
    case "pdf-to-excel": return <LazyPdfToExcelUI />;
    case "pdf-to-pptx": return <LazyPdfToPptxUI />;
    case "pdf-to-markdown": return <LazyPdfToMarkdownUI2 />;
    case "extract-images": return <LazyExtractImagesUI />;
    case "extract-tables": return <LazyExtractTablesUI />;
    case "pdf-to-pdfa": return <LazyPdfToPdfaUI />;
    case "word-to-pdf": return <LazyWordToPdfUI />;
    case "excel-to-pdf": return <LazyExcelToPdfUI />;
    case "pptx-to-pdf-convert": return <LazyPptxToPdfUI />;
    case "txt-to-pdf": return <LazyTxtToPdfUI />;
    case "json-to-pdf": return <LazyJsonToPdfUI />;
    case "xml-to-pdf": return <LazyXmlToPdfUI />;
    case "epub-to-pdf": return <LazyEpubToPdfUI />;
    case "rtf-to-pdf": return <LazyRtfToPdfUI />;
    case "office-to-pdf": return <LazyOfficeToPdfUI />;
    case "flatten-pdf": return <LazyFlattenUI />;
    case "deskew-pdf": return <LazyDeskewUI />;
    case "repair-pdf": return <LazyRepairUI />;
    case "grayscale-pdf": return <LazyGrayscaleUI />;
    case "strip-metadata": return <LazyStripMetadataUI />;
    case "delete-annotations": return <LazyDeleteAnnotationsUI />;
    case "reverse-pdf": return <LazyReversePdfUI />;
    case "booklet-pdf": return <LazyBookletUI />;
    case "batch-compress-pdf":
      return <LazyMultiFileUI
        endpoint="/batch-compress-pdf"
        accepts=".pdf,application/pdf"
        outputFilename="compressed-pdfs.zip"
        fileLabel="PDFs"
        actionVerb="Compress"
        ordered={false}
      />;
    case "pdf-page-counter": return <LazyPdfPageCounterUI />;
    default:
      return <GenericUI toolName={toolName} outputLabel={outputLabel} accepts={accepts} slug={slug} />;
  }
}

export default function ToolPage() {
  const { slug } = useParams<{ slug: string }>();
  const tool = slug ? toolBySlug[slug] : null;
  const { addEntry } = useHistory();
  const { toggle, isFavorite } = useFavorites();
  // Bumped by the per-tool ErrorBoundary's onReset to force a remount of
  // the tool subtree (clears bad in-memory state without a full reload).
  const [resetKey, setResetKey] = useState(0);

  useEffect(() => {
    if (tool && slug) {
      addEntry({ slug, name: tool.name, href: `/tool/${slug}` });
    }
  }, [slug, tool, addEntry]);

  const relatedTools = tools.filter(t => t.category === tool?.category && t.slug !== slug).slice(0, 6);

  if (!tool) {
    return (
      <div className="h-full flex items-center justify-center">
        <div className="text-center">
          <p className="font-serif-body text-muted-foreground mb-4">Tool not found.</p>
          <Link to="/" className="btn-editorial inline-block">← Back to all tools</Link>
        </div>
      </div>
    );
  }

  const meta = categoryMeta[tool.category];

  const cc = `cat-${tool.category}`;

  const ToolIcon = tool.icon;
  const favorite = isFavorite(tool.slug);
  const reviewedDate = getToolLastReviewed(tool.slug);
  return (
    <div className={cn("h-full flex flex-col", cc)}>
      {/* ─── Workspace header — slim, like Pipeline/Batch ───────────── */}
      <header className="flex items-start justify-between gap-3 px-5 sm:px-7 py-5 border-b border-border bg-paper-2/30">
        <div className="min-w-0 flex-1">
          {/* Breadcrumb */}
          <nav aria-label="Breadcrumb" className="font-mono text-[10px] tracking-[0.10em] uppercase text-muted-foreground mb-3 flex items-center gap-2">
            <span className="text-accent">§</span>
            <Link to="/" className="hover:text-foreground transition-colors">All tools</Link>
            <span className="opacity-50">/</span>
            <Link to={`/?tab=${tool.category}`} className="hover:text-foreground transition-colors">{meta.label}</Link>
            <span className="opacity-50">/</span>
            <span className="text-foreground">{tool.name}</span>
          </nav>

          <div className="flex items-start gap-4">
            {/* Tool icon */}
            <span className="hidden sm:inline-flex icon-tile icon-tile-lg shrink-0">
              <ToolIcon size={22} strokeWidth={1.75} />
            </span>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2 mb-1 flex-wrap">
                <span className="section-flag">{meta.label}</span>
                {tool.clientOnly && (
                  <span className="section-flag" style={{ color: "hsl(var(--accent))", borderColor: "hsl(var(--accent) / 0.4)", background: "hsl(var(--accent) / 0.08)" }}>
                    100% Browser
                  </span>
                )}
                <span className="section-flag">
                  Last reviewed <time dateTime={reviewedDate}>{formatReviewedDate(reviewedDate)}</time>
                </span>
              </div>
              <div className="flex items-center gap-2">
                <h1 className="font-display font-bold text-foreground text-[28px] sm:text-[34px] tracking-[-0.025em] leading-tight" style={{ fontVariationSettings: '"opsz" 144, "SOFT" 50' }}>
                  {tool.name}
                </h1>
                <button
                  type="button"
                  onClick={() => toggle(tool.slug)}
                  aria-label={favorite ? `Unpin ${tool.name}` : `Pin ${tool.name}`}
                  aria-pressed={favorite}
                  title={favorite ? "Pinned to sidebar" : "Pin to sidebar"}
                  className={cn(
                    "inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border transition-colors",
                    favorite
                      ? "border-accent/45 bg-accent/10 text-accent"
                      : "border-border bg-card text-muted-foreground hover:border-accent/45 hover:text-accent",
                  )}
                >
                  <Star size={16} strokeWidth={1.8} fill={favorite ? "currentColor" : "none"} />
                </button>
              </div>
              <p className="mt-1.5 text-[14px] text-muted-foreground leading-relaxed max-w-2xl">
                {tool.longDescription || tool.description}
              </p>
            </div>
          </div>
        </div>
      </header>

      {/* ─── Tool workspace ────────────────────────────────────────── */}
      <section aria-label="Tool" className="flex-1 overflow-y-auto">
       <div className="mx-auto max-w-5xl px-4 sm:px-6 py-7 sm:py-10">
        <div className="mb-8">
          {/*
            Per-tool ErrorBoundary so a single tool throwing during render
            doesn't take down the AppShell, sidebar, or other tools.
            - key={slug} resets the boundary when the user navigates to a
              different tool (otherwise the fallback would stick around).
            - onReset bumps a key on the Suspense subtree to force a clean
              remount of the lazy component without a full page reload.
          */}
          <ErrorBoundary
            key={slug}
            scope="tool"
            onReset={() => setResetKey((k) => k + 1)}
          >
            <Suspense fallback={<ToolSkeleton />}>
              <div key={resetKey}>
                <ToolUI slug={slug!} toolName={tool.name} outputLabel={tool.outputLabel} accepts={tool.accepts} />
              </div>
            </Suspense>
          </ErrorBoundary>
        </div>

        {/* Trust strip + pipeline cross-sell */}
        <div className="flex flex-col sm:flex-row gap-3 mb-12">
          <div className="flex items-center gap-2.5 px-4 py-3 rounded-lg border border-border bg-card flex-1">
            <Lock size={14} className="text-accent shrink-0" />
            <p className="text-[13px] text-muted-foreground leading-snug">
              <span className="text-foreground font-medium">Your files stay private.</span>{" "}
              {tool.clientOnly ? "Processed entirely in your browser." : "Processed on your own infrastructure — never on third-party clouds."}
            </p>
          </div>
          <Link to="/pipeline" className="group inline-flex items-center justify-center gap-2 px-4 py-3 rounded-lg border border-accent/20 bg-accent/[0.04] hover:border-accent/40 hover:bg-accent/[0.08] transition-all shrink-0">
            <GitBranch size={14} className="text-accent" />
            <span className="text-[13px] font-medium text-foreground">Try Pipeline</span>
            <ArrowRight size={12} className="text-accent group-hover:translate-x-0.5 transition-transform" />
          </Link>
        </div>

        {/* Related tools — horizontal scroll category nav */}
        <CategoryToolNav currentSlug={slug!} category={tool.category} />

        {/* How it works + sidebar */}
        <div className="grid grid-cols-1 lg:grid-cols-[1fr_280px] gap-10 lg:gap-12 mt-12">
          <div>
            <div className="flex items-baseline gap-3 mb-5">
              <span className="font-mono text-[10.5px] tracking-[0.12em] uppercase text-accent">§</span>
              <h2 className="font-display text-[22px] font-semibold text-foreground tracking-[-0.02em]">How it works</h2>
              <span className="flex-1 h-px bg-border ml-2" />
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              {[
                { step: "01", title: "Upload",    desc: tool.clientOnly ? "Drag & drop or click. Processing happens in your browser." : "Drag & drop or click. Files go to your self-hosted server, not third-party clouds." },
                { step: "02", title: "Configure", desc: tool.clientOnly ? "Adjust settings; nothing is uploaded." : "Adjust any settings, then process instantly." },
                { step: "03", title: "Download",  desc: "Result ready immediately — no waiting, no email." },
              ].map(s => (
                <div key={s.step} className="rounded-xl border border-border bg-card p-5">
                  <div className="font-mono text-[10.5px] tracking-[0.12em] uppercase text-accent mb-3">{s.step}</div>
                  <p className="font-display text-[17px] font-semibold text-foreground tracking-[-0.015em] mb-1.5">{s.title}</p>
                  <p className="text-[13px] text-muted-foreground leading-relaxed">{s.desc}</p>
                </div>
              ))}
            </div>
          </div>

          <div className="space-y-4">
            <div className="rounded-xl border border-border bg-card p-5">
              <h3 className="font-mono text-[10.5px] font-semibold uppercase tracking-[0.12em] text-muted-foreground mb-4">
                <span className="text-accent">§</span> Related
              </h3>
              <div className="space-y-0.5">
                {relatedTools.map(t => {
                  const TIcon = t.icon;
                  return (
                    <Link key={t.slug} to={`/tool/${t.slug}`} className="flex items-center gap-2.5 px-2 py-1.5 -mx-2 rounded hover:bg-secondary/60 transition-colors group">
                      <TIcon size={13} strokeWidth={1.75} className="text-muted-foreground group-hover:text-accent transition-colors shrink-0" />
                      <span className="text-[13px] text-foreground/80 group-hover:text-foreground transition-colors flex-1 truncate">{t.name}</span>
                    </Link>
                  );
                })}
              </div>
            </div>

            <a href="https://github.com/deadpoolrulesmarvel1-svg/privatools" target="_blank" rel="noopener noreferrer"
              className="block rounded-xl border border-border bg-card p-5 hover:border-accent/40 transition-colors group">
              <div className="flex items-center gap-2 mb-2">
                <Github size={14} className="text-foreground" />
                <span className="font-display text-[15px] font-semibold text-foreground tracking-[-0.015em]">Open source</span>
              </div>
              <p className="text-[12.5px] text-muted-foreground leading-relaxed mb-3">Free forever, MIT licensed. Audit, fork, or self-host.</p>
              <span className="inline-flex items-center gap-1 font-mono text-[11px] tracking-[0.06em] uppercase font-medium text-accent">
                View on GitHub <ArrowUpRight size={10} className="group-hover:translate-x-0.5 group-hover:-translate-y-0.5 transition-transform" />
              </span>
            </a>

            {slug && (() => {
              // Posts that mention this tool in their relatedTools array.
              // Falls back to the hand-curated TOOL_BLOG_LINKS for any tool
              // that doesn't yet have any blog post linking back to it.
              const derived = postsForTool(slug, 4);
              const fallback = TOOL_BLOG_LINKS[slug] || [];
              const posts = derived.length > 0
                ? derived.map(p => ({ slug: p.slug, title: p.title }))
                : fallback;
              if (posts.length === 0) return null;
              return (
                <div className="rounded-xl border border-border bg-card p-5">
                  <h3 className="font-mono text-[10.5px] font-semibold uppercase tracking-[0.12em] text-muted-foreground mb-4">
                    <span className="text-accent">§</span> Related articles
                  </h3>
                  <div className="space-y-0.5">
                    {posts.map(post => (
                      <Link key={post.slug} to={`/blog/${post.slug}`} className="flex items-center gap-2.5 px-2 py-1.5 -mx-2 rounded hover:bg-secondary/60 transition-colors group">
                        <BookOpen size={13} strokeWidth={1.75} className="text-muted-foreground group-hover:text-accent transition-colors shrink-0" />
                        <span className="text-[12.5px] text-foreground/80 group-hover:text-foreground transition-colors flex-1 leading-snug">{post.title}</span>
                      </Link>
                    ))}
                  </div>
                </div>
              );
            })()}
          </div>
        </div>
       </div>
      </section>
    </div>
  );
}
