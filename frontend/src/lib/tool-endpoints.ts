const TOOL_ENDPOINT_OVERRIDES: Record<string, string> = {
  "merge-pdf": "/merge",
  "split-pdf": "/split",
  "compress-pdf": "/compress",
  "resize-pdf": "/resize",
  "rotate-pdf": "/rotate",
  "protect-pdf": "/protect",
  "unlock-pdf": "/unlock",
  "redact-pdf": "/redact",
  "crop-pdf": "/crop",
  "flatten-pdf": "/flatten",
  "deskew-pdf": "/deskew",
  "repair-pdf": "/repair",
  "grayscale-pdf": "/grayscale",
  "ocr-pdf": "/ocr",
  "compare-pdf": "/compare",
  "sanitize-pdf": "/sanitize",
  "booklet-pdf": "/booklet",
  "qr-reader": "/read-qr",
  // Named SEO entries that share the underlying image-to-pdf endpoint:
  "jpg-to-pdf": "/image-to-pdf",
  "png-to-pdf": "/image-to-pdf",
  "heic-to-pdf": "/image-to-pdf",
  "webp-to-pdf": "/image-to-pdf",
  "tiff-to-pdf": "/image-to-pdf",
  "bmp-to-pdf": "/image-to-pdf",
  "gif-to-pdf": "/image-to-pdf",
  "svg-to-pdf": "/image-to-pdf",
  // ODT routes to the office-to-pdf converter (LibreOffice handles ODT).
  "odt-to-pdf": "/office-to-pdf",
  // Split-in-half is a preset of the split endpoint:
  "split-in-half": "/split-in-half",
  // Highlight is a focused preset on top of annotate logic:
  "highlight-pdf": "/highlight",
  // PDF→raster variants share the pdf-to-image endpoint with a `format` param:
  "pdf-to-tiff": "/pdf-to-image",
  "pdf-to-bmp":  "/pdf-to-image",
  "pdf-to-gif":  "/pdf-to-image",
  // PDF→SVG (vector) is its own endpoint:
  "pdf-to-svg":  "/pdf-to-svg",
  // Smart Redact uses the dedicated text-search redact backend:
  "smart-redact": "/smart-redact",
  // Video tools — already 1:1 with route name, but listed for clarity:
  "video-to-pdf":   "/video-to-pdf",
  "video-converter": "/video-converter",
  "video-resizer":  "/video-resizer",
  "video-thumbnail": "/video-thumbnail",
  "gif-to-mp4":     "/gif-to-mp4",
  "add-subtitles":  "/add-subtitles",
  // Round-O additions
  "video-merge":    "/video-merge",
  "audio-merge":    "/audio-merge",
  "pdf-to-jpg":     "/pdf-to-image",
  "pdf-to-png":     "/pdf-to-image",
};

const CONTENT_TYPE_EXTENSION_MAP: Record<string, string> = {
  "application/pdf": ".pdf",
  "application/zip": ".zip",
  "application/epub+zip": ".epub",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": ".docx",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": ".xlsx",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation": ".pptx",
  "text/plain": ".txt",
  "text/markdown": ".md",
  "text/csv": ".csv",
  "image/png": ".png",
  "image/jpeg": ".jpg",
  "image/webp": ".webp",
  "image/gif": ".gif",
  "image/x-icon": ".ico",
  "video/mp4": ".mp4",
  "audio/mpeg": ".mp3",
  "audio/wav": ".wav",
  "audio/aac": ".aac",
  "audio/flac": ".flac",
  "audio/ogg": ".ogg",
};

export function getToolEndpoint(slug: string): string {
  return TOOL_ENDPOINT_OVERRIDES[slug] ?? `/${slug}`;
}

export function getFilenameFromContentDisposition(contentDisposition: string | null): string | null {
  if (!contentDisposition) return null;

  const utf8Match = contentDisposition.match(/filename\*=UTF-8''([^;]+)/i);
  if (utf8Match?.[1]) {
    try {
      return decodeURIComponent(utf8Match[1].trim());
    } catch {
      return utf8Match[1].trim();
    }
  }

  const asciiMatch = contentDisposition.match(/filename=(\"?)([^\";]+)\1/i);
  if (asciiMatch?.[2]) {
    return asciiMatch[2].trim();
  }

  return null;
}

export function guessExtensionFromContentType(contentType: string | null): string | null {
  if (!contentType) return null;

  const normalized = contentType.split(";")[0].trim().toLowerCase();
  return CONTENT_TYPE_EXTENSION_MAP[normalized] ?? null;
}
