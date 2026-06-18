// Mirrors backend/app/seo_meta.py. Update a tool date only after a real review.
export const TOOL_LAST_REVIEWED_DEFAULT = "2026-05-01";

export const TOOL_LAST_REVIEWED: Record<string, string> = {
  "compress-pdf": "2026-05-15",
  "merge-pdf": "2026-05-10",
  "split-pdf": "2026-05-08",
  "pdf-to-word": "2026-05-12",
  "pdf-to-excel": "2026-04-28",
  "pdf-to-jpg": "2026-04-22",
  "jpg-to-pdf": "2026-04-18",
  "edit-pdf": "2026-05-05",
  "sign-pdf": "2026-05-02",
  "ocr-pdf": "2026-05-14",
  "protect-pdf": "2026-04-12",
  "unlock-pdf": "2026-04-10",
  "rotate-pdf": "2026-03-25",
  "watermark": "2026-04-05",
  "redact-pdf": "2026-05-09",
  "smart-redact": "2026-05-13",
  "summarize-pdf": "2026-05-16",
  "highlight-pdf": "2026-03-20",
  "image-compressor": "2026-05-11",
  "image-converter": "2026-04-15",
  "heic-to-jpg": "2026-04-02",
  "remove-background": "2026-05-06",
  "remove-exif": "2026-03-28",
  "video-converter": "2026-04-25",
  "audio-converter": "2026-04-20",
  "compress-video": "2026-04-08",
  "video-to-gif": "2026-03-30",
  "jwt-decoder": "2026-02-15",
  "regex-tester": "2026-02-22",
  "password-generator": "2026-02-10",
  "pdf-to-text": "2026-03-15",
  "pdf-to-image": "2026-03-12",
  "word-to-pdf": "2026-03-18",
  "excel-to-pdf": "2026-03-08",
  "html-to-pdf": "2026-03-05",
  "extract-pages": "2026-02-28",
  "delete-pages": "2026-02-26",
  "compare-pdfs": "2026-02-20",
  "batch-compress-pdf": "2026-04-30",
  "hash-generator": "2026-01-25",
  "base64": "2026-01-22",
  "qr-code": "2026-01-18",
  "qr-reader": "2026-01-15",
  "uuid-generator": "2026-01-12",
};

export function getToolLastReviewed(slug: string) {
  return TOOL_LAST_REVIEWED[slug] ?? TOOL_LAST_REVIEWED_DEFAULT;
}

export function formatReviewedDate(isoDate: string) {
  const date = new Date(`${isoDate}T00:00:00Z`);
  return date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });
}
