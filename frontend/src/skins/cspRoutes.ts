/**
 * Document capabilities granted by backend/app/main.py. Hash navigation cannot
 * change response headers. Keep ordinary tools in this document, but request a
 * new document when the destination needs capabilities this response lacks.
 * The backend CSP tests compare these lists to the actual server policy sets.
 */
export const CSP_TRANSFORMER_PATHS = [
  "/ai", "/tool/summarize-pdf", "/tool/smart-redact", "/tool/translate-pdf",
  "/tools/remove-background", "/tools/transcribe-audio", "/tools/subtitle-generator",
  "/tools/subtitle-translator",
] as const;
export const CSP_OCR_PATHS = ["/tool/ocr-pdf", "/tools/image-ocr"] as const;
export const CSP_BYOK_PATHS = [
  "/tool/summarize-pdf", "/tool/smart-redact", "/tool/chat-with-pdf",
  "/tool/translate-pdf", "/tools/transcribe-audio", "/tool/ocr-pdf", "/tools/image-ocr",
  "/tools/ai-token-counter", "/tools/subtitle-translator",
] as const;

const transformers = new Set<string>(CSP_TRANSFORMER_PATHS);
const ocr = new Set<string>(CSP_OCR_PATHS);
const byok = new Set<string>(CSP_BYOK_PATHS);
const scopedPaths = [...new Set([...CSP_TRANSFORMER_PATHS, ...CSP_OCR_PATHS, ...CSP_BYOK_PATHS])];
const toolPaths = new Map(scopedPaths.filter(path => path !== "/ai").map(path => [path.split("/").pop()!, path]));

function capabilities(path: string) {
  const wasm = transformers.has(path) || ocr.has(path);
  const cdnScript = wasm;
  // Transformer workers may import their downloaded runtime as a blob module.
  const blobScript = transformers.has(path);
  return (wasm ? 1 : 0) | (cdnScript ? 2 : 0) | (blobScript ? 4 : 0) | (byok.has(path) ? 8 : 0);
}

/** A URL to request, or null when the current document can handle this route. */
export function documentNavigationFor(currentPath: string, href: string): string | null {
  const raw = href.startsWith("#/") ? href.slice(1) : href;
  if (!raw.startsWith("/") || raw.startsWith("//")) return null;
  const [pathAndQuery] = raw.split("#");
  const queryAt = pathAndQuery.indexOf("?");
  const query = queryAt < 0 ? "" : pathAndQuery.slice(queryAt);
  const path = (queryAt < 0 ? pathAndQuery : pathAndQuery.slice(0, queryAt)).replace(/\/+$/, "") || "/";
  if (path === "/settings") return "/account/settings" + query;

  // The skin addresses all tools as #/tool/slug; non-PDF public URLs have
  // /tools/slug, and only that canonical spelling receives the server policy.
  const slug = /^\/tools?\/([^/]+)$/.exec(path)?.[1];
  const target = (slug && toolPaths.get(slug)) || path;
  const required = capabilities(target);
  if (!required) return null;
  const available = capabilities(currentPath.replace(/\/+$/, "") || "/");
  return (available & required) === required ? null : target + query;
}


const accountDocuments = /^\/account(?:\/(?:keys|settings|sign-in|sign-up))?\/?$/;

/** Account subpages share one CSP: preserve the SDK/session during navigation. */
export function accountNavigationFor(currentPath: string, href: string): string | null {
  if (!accountDocuments.test(currentPath)) return null;
  if (!href.startsWith("/") || href.startsWith("//")) return null;
  const [destination] = href.split("#");
  const [path] = destination.split("?");
  if (path === "/settings") return destination.replace(/^\/settings/, "/account/settings");
  return accountDocuments.test(path) ? destination : null;
}
