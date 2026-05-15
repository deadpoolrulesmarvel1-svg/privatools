import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";
import fs from "fs";

const BASE_URL = "https://privatools.me";

/**
 * Build-time sitemap generator. Reads tool slugs from the data files and emits
 * /dist/sitemap.xml covering home, static pages, every tool, and every blog post.
 * Replaces the hand-maintained one referenced from robots.txt.
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

      const pdfSlugs = slugs(read("src/data/tools.ts"));
      const nonPdfSlugs = slugs(read("src/data/non-pdf-tools.ts"));
      const blogSlugs = slugs(read("src/data/blog.ts"))
        .filter(s => s !== "string"); // skip the `slug: string;` type field

      const today = new Date().toISOString().slice(0, 10);
      const urls: { loc: string; priority: string; changefreq: string }[] = [
        { loc: `${BASE_URL}/`,         priority: "1.0", changefreq: "weekly" },
        { loc: `${BASE_URL}/about`,    priority: "0.7", changefreq: "monthly" },
        { loc: `${BASE_URL}/compare`,  priority: "0.7", changefreq: "monthly" },
        { loc: `${BASE_URL}/pipeline`, priority: "0.8", changefreq: "monthly" },
        { loc: `${BASE_URL}/batch`,    priority: "0.7", changefreq: "monthly" },
        { loc: `${BASE_URL}/blog`,     priority: "0.7", changefreq: "weekly" },
        { loc: `${BASE_URL}/privacy`,  priority: "0.4", changefreq: "yearly" },
        { loc: `${BASE_URL}/terms`,    priority: "0.4", changefreq: "yearly" },
        ...pdfSlugs.map(s => ({ loc: `${BASE_URL}/tool/${s}`,   priority: "0.9", changefreq: "monthly" })),
        ...nonPdfSlugs.map(s => ({ loc: `${BASE_URL}/tools/${s}`, priority: "0.9", changefreq: "monthly" })),
        ...blogSlugs.map(s => ({ loc: `${BASE_URL}/blog/${s}`,   priority: "0.6", changefreq: "monthly" })),
      ];

      const xml =
        `<?xml version="1.0" encoding="UTF-8"?>\n` +
        `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n` +
        urls.map(u =>
          `  <url>\n    <loc>${u.loc}</loc>\n    <lastmod>${today}</lastmod>\n` +
          `    <changefreq>${u.changefreq}</changefreq>\n    <priority>${u.priority}</priority>\n  </url>`
        ).join("\n") +
        `\n</urlset>\n`;

      fs.writeFileSync(path.resolve(__dirname, "dist/sitemap.xml"), xml, "utf8");
      // eslint-disable-next-line no-console
      console.log(`[sitemap] wrote ${urls.length} URLs`);
    },
  };
}

export default defineConfig({
  server: {
    host: "::",
    port: 8080,
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
    rollupOptions: {
      output: {
        manualChunks: {
          // Split large vendor libraries into separate cached chunks
          "vendor-react": ["react", "react-dom", "react-router-dom"],
          "vendor-radix": [
            "@radix-ui/react-tooltip",
            "@radix-ui/react-dialog",
            "@radix-ui/react-tabs",
            "@radix-ui/react-select",
            "@radix-ui/react-slot",
          ],
          "vendor-query": ["@tanstack/react-query"],
          "vendor-icons": ["lucide-react"],
        },
      },
    },
    // Target modern browsers for smaller output
    target: "es2020",
    // Increase chunk warning threshold (our vendor chunks are expected to be large)
    chunkSizeWarningLimit: 600,
  },
});
