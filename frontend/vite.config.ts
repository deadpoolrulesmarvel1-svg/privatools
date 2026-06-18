import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";
import fs from "fs";

const BASE_URL = "https://privatools.me";

// High-volume tools that get a priority bump in the sitemap. Mirrors the
// `_HIGH_PRIORITY_TOOLS` set in backend/app/routes/sitemap.py — both lists
// should stay aligned so the static `dist/sitemap.xml` and the live
// `/sitemap.xml` route produce the same crawl-budget signal.
const HIGH_PRIORITY_TOOLS = new Set([
  "merge-pdf", "split-pdf", "compress-pdf",
  "pdf-to-word", "pdf-to-excel", "pdf-to-jpg",
  "jpg-to-pdf", "word-to-pdf", "image-to-pdf",
  "edit-pdf", "sign-pdf", "ocr-pdf",
  "protect-pdf", "unlock-pdf", "rotate-pdf",
  "redact-pdf", "watermark",
  "image-compressor", "image-converter", "heic-to-jpg",
  "remove-background", "video-to-gif",
]);

// /compare/<competitor> landing pages. Must stay in sync with
// _STATIC_META keys in backend/app/seo_meta.py and COMPARE_PAGES in
// backend/app/routes/sitemap.py — every URL in here resolves to a real
// SSR-rendered comparison article.
const COMPARE_SLUGS = [
  "ilovepdf", "smallpdf", "adobe-acrobat", "sejda", "pdf24",
  "foxit", "lightpdf", "stirling-pdf", "dochub", "pdfescape", "nitro-pdf",
];

function manualChunks(id: string): string | undefined {
  const normalized = id.split(path.sep).join("/");

  if (normalized.endsWith("/src/data/tools.ts") || normalized.endsWith("/src/data/non-pdf-tools.ts")) {
    return "tool-catalog";
  }

  if (!normalized.includes("/node_modules/")) {
    return undefined;
  }

  if (
    normalized.includes("/node_modules/react/") ||
    normalized.includes("/node_modules/react-dom/") ||
    normalized.includes("/node_modules/react-router") ||
    normalized.includes("/node_modules/@remix-run/router/")
  ) {
    return "vendor-react";
  }

  if (
    normalized.includes("/node_modules/@radix-ui/react-tooltip/") ||
    normalized.includes("/node_modules/@radix-ui/react-dialog/") ||
    normalized.includes("/node_modules/@radix-ui/react-tabs/") ||
    normalized.includes("/node_modules/@radix-ui/react-select/") ||
    normalized.includes("/node_modules/@radix-ui/react-slot/")
  ) {
    return "vendor-radix";
  }

  if (normalized.includes("/node_modules/lucide-react/")) {
    return "vendor-icons";
  }

  return undefined;
}

/**
 * Build-time sitemap generator. Reads tool slugs from the data files and emits
 * /dist/sitemap.xml covering home, static pages, every tool, every blog post,
 * and every comparison landing page. Replaces the hand-maintained one
 * referenced from robots.txt.
 *
 * Priority scheme (matches backend/app/routes/sitemap.py):
 *   1.0  homepage
 *   0.9  high-volume tools (merge, compress, pdf-to-word, ...)
 *   0.8  long-tail tools + /blog index + per-tool /blog post + compare pages
 *   0.7  /pipeline, /batch
 *   0.6  /about
 *   0.4  /privacy, /terms
 */
function sitemapPlugin(): Plugin {
  return {
    name: "privatools-sitemap",
    apply: "build",
    closeBundle: async () => {
      // Lazy-read TS data files via regex (no need to spin up TS).
      const read = (p: string) => fs.readFileSync(path.resolve(__dirname, p), "utf8");
      const slugs = (src: string) =>
        Array.from(src.matchAll(/^\s*slug:\s*"([^"]+)"/gm)).map(m => m[1]);

      const pdfSlugs = Array.from(new Set(slugs(read("src/data/tools.ts"))));
      const nonPdfSlugs = Array.from(new Set(slugs(read("src/data/non-pdf-tools.ts"))));

      // Blog data file holds: type definitions (`slug: string;`), the post
      // entries themselves, and the helper signatures at the bottom. We
      // want only the post slugs + their `publishedAt` dates.
      const blogSrc = read("src/data/blog.ts");
      const blogPosts: { slug: string; publishedAt: string }[] = [];
      const postRe = /slug:\s*"([^"]+)"[\s\S]*?publishedAt:\s*"([^"]+)"/g;
      let m: RegExpExecArray | null;
      while ((m = postRe.exec(blogSrc)) !== null) {
        if (m[1] !== "string") {
          blogPosts.push({ slug: m[1], publishedAt: m[2] });
        }
      }

      const today = new Date().toISOString().slice(0, 10);
      type Url = { loc: string; priority: string; changefreq: string; lastmod: string };
      const urls: Url[] = [
        { loc: `${BASE_URL}/`,         priority: "1.0", changefreq: "daily",   lastmod: today },
        { loc: `${BASE_URL}/about`,    priority: "0.6", changefreq: "monthly", lastmod: today },
        { loc: `${BASE_URL}/compare`,  priority: "0.7", changefreq: "monthly", lastmod: today },
        { loc: `${BASE_URL}/pipeline`, priority: "0.7", changefreq: "weekly",  lastmod: today },
        { loc: `${BASE_URL}/batch`,    priority: "0.7", changefreq: "weekly",  lastmod: today },
        { loc: `${BASE_URL}/blog`,     priority: "0.8", changefreq: "weekly",  lastmod: today },
        { loc: `${BASE_URL}/privacy`,  priority: "0.4", changefreq: "yearly",  lastmod: "2026-03-29" },
        { loc: `${BASE_URL}/terms`,    priority: "0.4", changefreq: "yearly",  lastmod: "2026-03-29" },
        ...COMPARE_SLUGS.map(s => ({
          loc: `${BASE_URL}/compare/${s}`,
          priority: "0.8",
          changefreq: "monthly",
          lastmod: today,
        } satisfies Url)),
        ...blogPosts.map(p => ({
          loc: `${BASE_URL}/blog/${p.slug}`,
          priority: "0.6",
          changefreq: "weekly",
          lastmod: p.publishedAt,
        } satisfies Url)),
        ...pdfSlugs.map(s => ({
          loc: `${BASE_URL}/tool/${s}`,
          priority: HIGH_PRIORITY_TOOLS.has(s) ? "0.9" : "0.8",
          changefreq: "weekly",
          lastmod: today,
        } satisfies Url)),
        ...nonPdfSlugs.map(s => ({
          loc: `${BASE_URL}/tools/${s}`,
          priority: HIGH_PRIORITY_TOOLS.has(s) ? "0.9" : "0.8",
          changefreq: "weekly",
          lastmod: today,
        } satisfies Url)),
      ];

      const xml =
        `<?xml version="1.0" encoding="UTF-8"?>\n` +
        `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n` +
        urls.map(u =>
          `  <url>\n    <loc>${u.loc}</loc>\n    <lastmod>${u.lastmod}</lastmod>\n` +
          `    <changefreq>${u.changefreq}</changefreq>\n    <priority>${u.priority}</priority>\n  </url>`
        ).join("\n") +
        `\n</urlset>\n`;

      fs.writeFileSync(path.resolve(__dirname, "dist/sitemap.xml"), xml, "utf8");
      console.log(`[sitemap] wrote ${urls.length} URLs`);
    },
  };
}

export default defineConfig({
  server: {
    host: "::",
    port: Number(process.env.PORT) || 8080,
    strictPort: false,
    hmr: { overlay: false },
    proxy: {
      "/api": {
        target: "http://localhost:8000",
        changeOrigin: true,
      },
    },
  },
  plugins: [react(), sitemapPlugin()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  build: {
    modulePreload: {
      resolveDependencies: (_filename, deps) =>
        deps.filter(dep => !/(^|\/)(vendor-icons|tool-catalog)-/.test(dep)),
    },
    rollupOptions: {
      output: {
        // Split large vendor libraries into separate cached chunks so
        // returning users get them from the SW/CDN cache instead of
        // re-downloading on every deploy. Vite 8/Rolldown requires the
        // function form here; the object form Rollup accepted in Vite 5 now
        // fails at build time.
        manualChunks,
      },
    },
    // Target modern browsers for smaller output
    target: "es2020",
    // The only expected >600 kB JS chunk is the lazy-loaded
    // @huggingface/transformers runtime for AI PDF tools. Keep the warning
    // below 1 MB so accidental eager bundles still fail loudly.
    chunkSizeWarningLimit: 900,
  },
  esbuild: {
    // Drop dev-only console calls + debugger statements from the production
    // bundle so accidental `console.log("foo", bigObject)` left in tool UIs
    // doesn't ship to users. `console.error` / `console.warn` are kept so
    // real failures still surface in production telemetry.
    drop: ["debugger"],
    pure: ["console.log", "console.debug", "console.trace"],
  },
});
