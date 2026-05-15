// Regenerate public/llms.txt from the tool data files so it never goes stale.
// Parses src/data/tools.ts + src/data/non-pdf-tools.ts with regex (the data
// shape is uniform enough for this to be reliable).
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");

const PDF_LABELS = {
    organize:    "Merge & Split / Organize Pages",
    edit:        "Edit & Annotate",
    optimize:    "Optimize & Transform",
    security:    "Security & Privacy",
    "to-pdf":    "Convert to PDF",
    "from-pdf":  "Convert from PDF",
    advanced:    "Advanced",
};

const NONPDF_LABELS = {
    image:             "Image Tools",
    "video-audio":     "Video & Audio Tools",
    developer:         "Developer Tools",
    archive:           "Archive Tools",
    "document-office": "Document & Office Tools",
};

function parseTools(filePath) {
    const text = readFileSync(filePath, "utf8");
    // Match: { slug: "...", icon: X, name: "...", description: "...", longDescription: "...", category: "...", ...}
    const re = /\{\s*slug:\s*"([^"]+)"[^}]*?name:\s*"([^"]+)"[^}]*?description:\s*"((?:\\.|[^"\\])*)"[^}]*?category:\s*"([^"]+)"/g;
    const out = [];
    let m;
    while ((m = re.exec(text)) !== null) {
        out.push({ slug: m[1], name: m[2], description: m[3].replace(/\\"/g, '"'), category: m[4] });
    }
    return out;
}

const pdfTools    = parseTools(join(root, "src/data/tools.ts"));
const nonPdfTools = parseTools(join(root, "src/data/non-pdf-tools.ts"));
const total = pdfTools.length + nonPdfTools.length;

const groupBy = (tools, labels) => {
    const groups = {};
    for (const t of tools) (groups[t.category] ||= []).push(t);
    return Object.entries(labels)
        .filter(([cat]) => groups[cat]?.length)
        .map(([cat, label]) => ({ label, items: groups[cat] }));
};

const pdfGroups    = groupBy(pdfTools,    PDF_LABELS);
const nonPdfGroups = groupBy(nonPdfTools, NONPDF_LABELS);

let md = `# PrivaTools

> ${total}+ free, open-source file tools — PDF, image, video, audio, and developer utilities. The entire stack is MIT-licensed and self-hostable via Docker, so files stay on your own infrastructure. On the public demo, files are processed in an isolated container and deleted immediately after the response is returned. File content is never logged or shared with third parties; the public site uses anonymous Google Analytics 4 pageview telemetry only (IP-anonymized, blockable by any standard extension). No accounts.

PrivaTools is a privacy-first alternative to iLovePDF, Smallpdf, and Adobe Acrobat Online. The architecture is open-source so the privacy claim is auditable: see https://github.com/taiyeba-dg/privatools.

## Key Facts

- ${total} tools: ${pdfTools.length} PDF tools + ${nonPdfTools.length} non-PDF tools (image, video/audio, developer, archive, utilities)
- 100% free, no premium tiers, no per-day limits, 500 MB upload cap per file
- Open source under the MIT license
- Self-hostable via Docker (\`docker compose up\`) — entire stack runs on your hardware
- No account or sign-up required
- Public demo: files processed in an isolated container, deleted immediately after the response
- Browser-only tools (no upload at all): JSON/XML formatter, hash, base64, text diff, markdown↔HTML, password generator, UUID generator, lorem ipsum, word counter, color converter, URL/JWT encoder, subtitle converter, summarize PDF, smart redact (PII)
- Local AI tools: Summarize PDF (distilbart) and Smart Redact (BERT-NER) run entirely in your browser via WebAssembly — no third-party API calls
- Pipeline (industry first): chain merge → compress → watermark → sign in one click — no competitor offers this
- Contact: hello@privatools.me
- Privacy Policy: https://privatools.me/privacy
- Terms of Service: https://privatools.me/terms

## PDF Tools
`;

for (const g of pdfGroups) {
    md += `\n### ${g.label}\n`;
    for (const t of g.items) {
        md += `- [${t.name}](https://privatools.me/tool/${t.slug}): ${t.description}\n`;
    }
}

md += `\n## Non-PDF Tools\n`;
for (const g of nonPdfGroups) {
    md += `\n### ${g.label}\n`;
    for (const t of g.items) {
        md += `- [${t.name}](https://privatools.me/tools/${t.slug}): ${t.description}\n`;
    }
}

md += `
## Comparisons
- [vs iLovePDF](https://privatools.me/compare/ilovepdf)
- [vs Smallpdf](https://privatools.me/compare/smallpdf)
- [vs Adobe Acrobat](https://privatools.me/compare/adobe-acrobat)
- [vs Sejda](https://privatools.me/compare/sejda)
- [vs PDF24](https://privatools.me/compare/pdf24)
- [vs Foxit](https://privatools.me/compare/foxit)
- [vs LightPDF](https://privatools.me/compare/lightpdf)
- [vs Stirling PDF](https://privatools.me/compare/stirling-pdf)
- [vs DocHub](https://privatools.me/compare/dochub)
- [vs PDFescape](https://privatools.me/compare/pdfescape)
- [vs Nitro PDF](https://privatools.me/compare/nitro-pdf)

## Source Code
- GitHub: https://github.com/taiyeba-dg/privatools
`;

writeFileSync(join(root, "public/llms.txt"), md);
console.log(`[llms] wrote ${total} tools (${pdfTools.length} PDF + ${nonPdfTools.length} non-PDF) → public/llms.txt`);
