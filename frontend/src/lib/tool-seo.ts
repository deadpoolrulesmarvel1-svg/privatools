/**
 * One source for a tool page's title, heading and description. The server
 * reads the same registry fields through the build manifest and renders the
 * same heading for crawlers (backend/app/seo_meta.py, `_tool_page_body`).
 *
 * The search title (`seoTitle`) is the tab title and the meta title. The
 * visible H1 is the tool's name and its one-line promise, the registry's
 * `description`: "Compress PDF: Reduce the file size of your PDF". The page
 * shows the two parts on two lines and keeps the colon for screen readers.
 */
export interface ToolSeoInput { name: string; seoTitle?: string; metaDescription?: string; longDescription?: string; description?: string }
export interface ToolSeo {
  title: string;
  /** The H1's full text: name, then the promise after a colon. */
  h1: string;
  name: string;
  /** The registry description, shown under the name. Empty when there is none. */
  promise: string;
  description: string;
}

export function toolSeo(tool: ToolSeoInput): ToolSeo {
  const title = tool.seoTitle?.trim();
  const promise = tool.description?.trim() || "";
  return {
    title: title || `${tool.name} — Free Online | PrivaTools`,
    h1: promise ? `${tool.name}: ${promise}` : tool.name,
    name: tool.name,
    promise,
    description: tool.metaDescription?.trim() || tool.longDescription || tool.description || "",
  };
}
