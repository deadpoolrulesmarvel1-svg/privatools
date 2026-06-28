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
  "pdf-to-long-image": "/pdf-to-long-image",
  // v1.2.0 additions
  "web-optimize-pdf": "/web-optimize",
  "split-by-text":    "/split-by-text",
  "pdf-to-html":      "/pdf-to-html",
  "pdf-to-rtf":       "/pdf-to-rtf",
  "view-exif":        "/view-exif",
  // Image-converter SEO aliases (all route to /image-converter with a target_format):
  "webp-to-jpg":      "/image-converter",
  "webp-to-png":      "/image-converter",
  "heic-to-png":      "/image-converter",
  // v1.4.0 image converter aliases
  "jpg-to-png":       "/image-converter",
  "png-to-jpg":       "/image-converter",
  "jpg-to-webp":      "/image-converter",
  "png-to-webp":      "/image-converter",
  "tiff-to-jpg":      "/image-converter",
  "tiff-to-png":      "/image-converter",
  "bmp-to-jpg":       "/image-converter",
  "bmp-to-png":       "/image-converter",
  "gif-to-jpg":       "/image-converter",
  "gif-to-png":       "/image-converter",
  // v1.4.0 audio/video converter aliases
  "m4a-to-mp3":       "/audio-converter",
  "mp4-to-mp3":       "/extract-audio",
  "mov-to-mp4":       "/video-converter",
  "avi-to-mp4":       "/video-converter",
  "webm-to-mp4":      "/video-converter",
  "mp4-to-webm":      "/video-converter",
  // Phase 2 conversion alias pack
  "jpg-to-tiff":      "/image-converter",
  "png-to-tiff":      "/image-converter",
  "webp-to-tiff":     "/image-converter",
  "jpg-to-bmp":       "/image-converter",
  "png-to-bmp":       "/image-converter",
  "webp-to-bmp":      "/image-converter",
  "mp3-to-wav":       "/audio-converter",
  "wav-to-mp3":       "/audio-converter",
  "flac-to-mp3":      "/audio-converter",
  "ogg-to-mp3":       "/audio-converter",
  "aac-to-mp3":       "/audio-converter",
  "mp3-to-ogg":       "/audio-converter",
  "mp3-to-flac":      "/audio-converter",
  "mp3-to-aac":       "/audio-converter",
  "wav-to-flac":      "/audio-converter",
  "wav-to-ogg":       "/audio-converter",
  "mkv-to-mp4":       "/video-converter",
  "mp4-to-mov":       "/video-converter",
  "mov-to-webm":      "/video-converter",
  "mkv-to-webm":      "/video-converter",
  "mp4-to-avi":       "/video-converter",
  "avi-to-webm":      "/video-converter",
  "webm-to-mov":      "/video-converter",
  "mov-to-mkv":       "/video-converter",
  "webm-to-gif":      "/video-to-gif",
  "mov-to-gif":       "/video-to-gif",
  // v1.5.0 / phase 7 — competitor-gap tools
  "mute-video":       "/mute-video",
  "reverse-video":    "/reverse-video",
  "video-speed":      "/video-speed",
  "audio-trim":       "/audio-trim",
  "image-palette":    "/image-palette",
  "pixelate-image":   "/pixelate-image",
  // v1.5.1 — image rotate/flip
  "rotate-image":     "/rotate-image",
  "flip-image":       "/flip-image",
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

  const asciiMatch = contentDisposition.match(/filename=("?)([^";]+)\1/i);
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
