import { useEffect } from "react";
import { useLocation } from "react-router-dom";
import { tools } from "@/data/tools";
import { nonPdfTools } from "@/data/non-pdf-tools";
import { blogPosts } from "@/data/blog";

const BASE_URL = "https://privatools.me";

type ToolMeta = {
    name: string;
    description: string;
    longDescription?: string;
    category?: string;
    slug?: string;
};

const toolMap: Record<string, ToolMeta> = {};
tools.forEach(t => { toolMap[`/tool/${t.slug}`] = { ...t }; });
nonPdfTools.forEach(t => { toolMap[`/tools/${t.slug}`] = { ...t }; });

const TOTAL_TOOL_COUNT = tools.length + nonPdfTools.length;

const pageMeta: Record<string, { title: string; description: string }> = {
    "/": {
        title: "PrivaTools — Free, Open-Source Privacy-First File Tools",
        description: `${TOTAL_TOOL_COUNT} free, open-source file tools — PDF, image, video, and developer utilities. Self-hostable so your files stay on your own infrastructure. Files never leave the processing container, no behavioural tracking, no accounts.`,
    },
    "/about": {
        title: "About PrivaTools — How We Handle Your Files | Privacy-First",
        description: "Learn how PrivaTools processes your files with zero-knowledge architecture. Files are processed and immediately deleted — never stored, never read, never shared. 100% open source.",
    },
    "/batch": {
        title: "Batch Process Files — Apply Tools to Multiple Files | PrivaTools",
        description: "Upload multiple files and apply the same tool to all of them at once. Batch compress, convert, or transform PDF, image, and video files privately. Free, no limits.",
    },
    "/pipeline": {
        title: "PDF Pipeline — Chain Multiple PDF Tools Together | PrivaTools",
        description: "Chain multiple PDF tools together into a processing pipeline. Compress, rotate, watermark, and more — all in one pass. Privacy-first and free.",
    },
    "/privacy": {
        title: "Privacy Policy — PrivaTools",
        description: "PrivaTools privacy policy: file content is never stored, read, or shared. Anonymous pageview telemetry only — full transparency about what we do and don't collect.",
    },
    "/terms": {
        title: "Terms of Service — PrivaTools",
        description: "Terms of service for PrivaTools. Free, open-source file tools provided as-is under the MIT license. No accounts, no data collection.",
    },
    "/compare": {
        title: "PrivaTools vs iLovePDF vs Smallpdf vs Adobe — Free Comparison",
        description: "Compare PrivaTools with iLovePDF, Smallpdf, Adobe Acrobat, Sejda, PDF24, Foxit, and LightPDF. See which tool is truly free, private, and open source.",
    },
    "/compare/ilovepdf": {
        title: "PrivaTools vs iLovePDF — Honest Feature Comparison (2026)",
        description: "PrivaTools vs iLovePDF compared: pricing, file limits, privacy, features. PrivaTools is 100% free with no ads, no accounts, and open source. See the full comparison.",
    },
    "/compare/smallpdf": {
        title: "PrivaTools vs Smallpdf — Honest Feature Comparison (2026)",
        description: "PrivaTools vs Smallpdf compared: no 2-tasks/day limit, no premium upsells, no watermarks. 152+ tools vs 30 tools. See the full comparison.",
    },
    "/compare/adobe-acrobat": {
        title: "PrivaTools vs Adobe Acrobat Online — Free Alternative (2026)",
        description: "PrivaTools is a free, open-source alternative to Adobe Acrobat Online. No Adobe ID required, no subscription, 152+ tools. Compare features side by side.",
    },
    "/compare/sejda": {
        title: "PrivaTools vs Sejda — Free PDF Tool Comparison (2026)",
        description: "PrivaTools vs Sejda: unlimited tools vs Sejda's 3 tasks/hour limit. 100% free, open source, self-hostable. See how PrivaTools compares to Sejda PDF.",
    },
    "/compare/pdf24": {
        title: "PrivaTools vs PDF24 — Free PDF Tools Comparison (2026)",
        description: "PrivaTools vs PDF24: both free, but PrivaTools is open source, self-hostable, and privacy-first. Compare features, privacy practices, and tool breadth.",
    },
    "/compare/foxit": {
        title: "PrivaTools vs Foxit PDF — Free vs Paid Comparison (2026)",
        description: "PrivaTools vs Foxit PDF: free, open-source tools vs Foxit's paid subscription. 152+ privacy-first PDF tools with no account required vs Foxit's enterprise pricing.",
    },
    "/compare/lightpdf": {
        title: "PrivaTools vs LightPDF — Privacy & Feature Comparison (2026)",
        description: "PrivaTools vs LightPDF: 100% free and open source vs LightPDF's freemium model. No file limits, no accounts, no ads. Compare privacy and features.",
    },
};

const categoryLabels: Record<string, string> = {
    organize: "PDF Tools",
    edit: "PDF Editor",
    optimize: "PDF Optimization",
    security: "PDF Security",
    "to-pdf": "File Conversion",
    "from-pdf": "PDF Conversion",
    advanced: "Advanced PDF Tools",
    image: "Image Tools",
    "video-audio": "Video & Audio Tools",
    developer: "Developer Tools",
    archive: "Archive Tools",
    "document-office": "Document Conversion",
};

const categoryPaths: Record<string, string> = {
    organize: "PDF Tools",
    edit: "Edit PDF",
    optimize: "Optimize PDF",
    security: "PDF Security",
    "to-pdf": "Convert to PDF",
    "from-pdf": "Convert from PDF",
    advanced: "Advanced",
    image: "Image Tools",
    "video-audio": "Video & Audio",
    developer: "Developer Tools",
    archive: "Archives",
    "document-office": "Document Tools",
};

/** Shared Organization schema block, referenced by @id across pages. */
const organizationSchema = {
    "@type": "Organization",
    "@id": `${BASE_URL}/#organization`,
    name: "PrivaTools",
    url: BASE_URL,
    logo: {
        "@type": "ImageObject",
        url: `${BASE_URL}/icons/icon-192.png`,
        width: 192,
        height: 192,
    },
    alternateName: "PrivaTools.me",
    description: `Free, open-source suite of ${TOTAL_TOOL_COUNT} file tools for PDF, image, video, and developer workflows. MIT-licensed and self-hostable via Docker — files stay on your own infrastructure.`,
    foundingDate: "2026",
    license: "https://opensource.org/licenses/MIT",
    sameAs: [
        "https://github.com/taiyeba-dg/privatools",
    ],
    contactPoint: {
        "@type": "ContactPoint",
        contactType: "customer support",
        email: "hello@privatools.me",
        url: "https://github.com/taiyeba-dg/privatools/issues",
    },
};

/** FAQ entries shown on every tool page for FAQPage schema. */
function getToolFAQ(toolName: string) {
    return [
        {
            question: `Is ${toolName} free to use?`,
            answer: `Yes, ${toolName} on PrivaTools is 100% free with no limits, no accounts required, and no premium tiers.`,
        },
        {
            question: `Is it safe to use ${toolName} online?`,
            answer: `Yes. PrivaTools is open-source and self-hostable, so files stay on your own infrastructure. On the public demo, files are processed in an isolated container and deleted immediately after the response is returned — never stored, shared, or analyzed. Many tools run entirely in your browser.`,
        },
        {
            question: `Do I need to create an account?`,
            answer: `No. PrivaTools requires no account, no email, and no registration. Just upload your file and use the tool immediately.`,
        },
        {
            question: `Can I use ${toolName} on mobile?`,
            answer: `Yes. PrivaTools is fully responsive and works on phones, tablets, and desktops in any modern browser.`,
        },
    ];
}

/** Person schema for the default blog author — gives BlogPosting an E-E-A-T
 * signal that AI / Google can crawl. The Organization remains the publisher.
 */
const authorSchema = {
    "@type": "Person",
    "@id": `${BASE_URL}/about#author-privatools-team`,
    name: "PrivaTools Team",
    url: `${BASE_URL}/about`,
    jobTitle: "Open-source maintainers",
    worksFor: { "@id": `${BASE_URL}/#organization` },
    knowsAbout: [
        "PDF processing",
        "File privacy",
        "Open-source software",
        "Self-hosted document tools",
        "Local AI / on-device inference",
    ],
    sameAs: [
        "https://github.com/taiyeba-dg/privatools",
    ],
};

/**
 * Updates <title>, <meta>, <link rel="canonical">, and JSON-LD on every route change.
 * Schemas: WebApplication, FAQPage, BreadcrumbList (tools), BlogPosting (blog),
 * Article (compare), Organization + WebSite (home), SoftwareApplication (about).
 */
export function DynamicHead() {
    const { pathname } = useLocation();

    useEffect(() => {
        const tool = toolMap[pathname];
        const url = `${BASE_URL}${pathname === "/" ? "" : pathname}`;

        if (tool) {
            // ── Tool pages ──────────────────────────────────────
            const title = `${tool.name} Online Free — No Sign Up | PrivaTools`;
            const desc = tool.longDescription || tool.description;
            const category = tool.category || "";
            const breadcrumbCategory = categoryPaths[category] || "Tools";

            document.title = title;
            setMeta("description", desc);
            setMeta("og:title", `${tool.name} — Free, Private, Open Source | PrivaTools`);
            setMeta("og:description", desc);
            setMeta("og:url", url);
            setMeta("og:type", "website");
            setMeta("og:image", `${BASE_URL}/api/og-image?p=${pathname}`);
            setMeta("og:image:width", "1200");
            setMeta("og:image:height", "630");
            setMeta("twitter:title", `${tool.name} — Free Online | PrivaTools`);
            setMeta("twitter:description", desc);
            setMeta("twitter:image", `${BASE_URL}/api/og-image?p=${pathname}`);
            setCanonical(url);

            const faq = getToolFAQ(tool.name);

            setJsonLd({
                "@context": "https://schema.org",
                "@graph": [
                    // WebApplication (no more HowTo)
                    {
                        "@type": "WebApplication",
                        name: `${tool.name} — PrivaTools`,
                        description: desc,
                        url,
                        applicationCategory: categoryLabels[category] || "UtilitiesApplication",
                        operatingSystem: "Any (browser-based)",
                        offers: { "@type": "Offer", price: "0", priceCurrency: "USD" },
                        provider: { "@id": `${BASE_URL}/#organization` },
                        isAccessibleForFree: true,
                        image: `${BASE_URL}/api/og-image?p=${pathname}`,
                        datePublished: "2026-03-15",
                        dateModified: "2026-03-29",
                        speakable: {
                            "@type": "SpeakableSpecification",
                            cssSelector: ["h1", ".tool-description", ".faq-section"],
                        },
                    },
                    // BreadcrumbList
                    {
                        "@type": "BreadcrumbList",
                        itemListElement: [
                            { "@type": "ListItem", position: 1, name: "PrivaTools", item: BASE_URL },
                            { "@type": "ListItem", position: 2, name: breadcrumbCategory, item: `${BASE_URL}/` },
                            { "@type": "ListItem", position: 3, name: tool.name, item: url },
                        ],
                    },
                    // FAQPage (still useful for AI semantic understanding)
                    {
                        "@type": "FAQPage",
                        mainEntity: faq.map(f => ({
                            "@type": "Question",
                            name: f.question,
                            acceptedAnswer: { "@type": "Answer", text: f.answer },
                        })),
                    },
                    organizationSchema,
                ],
            });
        } else if (pathname.startsWith("/blog/") && pathname !== "/blog") {
            // ── Blog post pages ─────────────────────────────────
            const slug = pathname.replace("/blog/", "");
            const post = blogPosts.find(p => p.slug === slug);
            if (post) {
                const title = `${post.title} | PrivaTools Blog`;
                document.title = title;
                setMeta("description", post.description);
                setMeta("og:title", post.title);
                setMeta("og:description", post.description);
                setMeta("og:url", url);
                setMeta("og:type", "article");
                setMeta("og:image", `${BASE_URL}/api/og-image?p=${pathname}`);
                setMeta("og:image:width", "1200");
                setMeta("og:image:height", "630");
                setMeta("twitter:title", post.title);
                setMeta("twitter:description", post.description);
                setMeta("twitter:image", `${BASE_URL}/api/og-image?p=${pathname}`);
                setCanonical(url);

                // Word count gives Google + AI extraction a signal of depth.
                const wordCount = (post.body || "").split(/\s+/).filter(Boolean).length;

                setJsonLd({
                    "@context": "https://schema.org",
                    "@graph": [
                        {
                            "@type": "BlogPosting",
                            headline: post.title,
                            description: post.description,
                            url,
                            mainEntityOfPage: { "@type": "WebPage", "@id": url },
                            datePublished: post.publishedAt,
                            dateModified: post.publishedAt,
                            author: authorSchema,
                            publisher: { "@id": `${BASE_URL}/#organization` },
                            image: {
                                "@type": "ImageObject",
                                url: `${BASE_URL}/api/og-image?p=${pathname}`,
                                width: 1200,
                                height: 630,
                            },
                            articleSection: post.tags[0] || "PDF Tools",
                            keywords: post.tags?.join(", "),
                            wordCount: wordCount > 0 ? wordCount : undefined,
                            inLanguage: "en-US",
                            speakable: {
                                "@type": "SpeakableSpecification",
                                cssSelector: ["h1", ".blog-prose h2", ".blog-prose p:first-of-type"],
                            },
                        },
                        authorSchema,
                        {
                            "@type": "BreadcrumbList",
                            itemListElement: [
                                { "@type": "ListItem", position: 1, name: "PrivaTools", item: BASE_URL },
                                { "@type": "ListItem", position: 2, name: "Blog", item: `${BASE_URL}/blog` },
                                { "@type": "ListItem", position: 3, name: post.title, item: url },
                            ],
                        },
                        organizationSchema,
                    ],
                });
            } else {
                removeJsonLd();
            }
        } else if (pathname.startsWith("/compare/") && pathname !== "/compare") {
            // ── Comparison pages ────────────────────────────────
            const meta = pageMeta[pathname];
            if (meta) {
                document.title = meta.title;
                setMeta("description", meta.description);
                setMeta("og:title", meta.title);
                setMeta("og:description", meta.description);
                setMeta("og:url", url);
                setMeta("og:type", "article");
                setMeta("og:image", `${BASE_URL}/api/og-image?p=${pathname}`);
                setMeta("og:image:width", "1200");
                setMeta("og:image:height", "630");
                setMeta("twitter:title", meta.title);
                setMeta("twitter:description", meta.description);
                setMeta("twitter:image", `${BASE_URL}/api/og-image?p=${pathname}`);
                setCanonical(url);

                const competitor = pathname.replace("/compare/", "").replace(/-/g, " ").replace(/\b\w/g, c => c.toUpperCase());

                setJsonLd({
                    "@context": "https://schema.org",
                    "@graph": [
                        {
                            "@type": "Article",
                            headline: meta.title,
                            description: meta.description,
                            url,
                            mainEntityOfPage: { "@type": "WebPage", "@id": url },
                            datePublished: "2026-03-22",
                            dateModified: "2026-03-29",
                            author: authorSchema,
                            publisher: { "@id": `${BASE_URL}/#organization` },
                            image: {
                                "@type": "ImageObject",
                                url: `${BASE_URL}/api/og-image?p=${pathname}`,
                                width: 1200,
                                height: 630,
                            },
                            about: {
                                "@type": "SoftwareApplication",
                                name: competitor,
                            },
                            speakable: {
                                "@type": "SpeakableSpecification",
                                cssSelector: ["h1", ".comparison-summary", "h2"],
                            },
                        },
                        {
                            "@type": "BreadcrumbList",
                            itemListElement: [
                                { "@type": "ListItem", position: 1, name: "PrivaTools", item: BASE_URL },
                                { "@type": "ListItem", position: 2, name: "Compare", item: `${BASE_URL}/compare` },
                                { "@type": "ListItem", position: 3, name: meta.title.split(" — ")[0], item: url },
                            ],
                        },
                        organizationSchema,
                    ],
                });
            } else {
                removeJsonLd();
            }
        } else if (pathname === "/about") {
            // ── About page ──────────────────────────────────────
            const meta = pageMeta[pathname]!;
            document.title = meta.title;
            setMeta("description", meta.description);
            setMeta("og:title", meta.title);
            setMeta("og:description", meta.description);
            setMeta("og:url", url);
            setMeta("og:type", "website");
            setMeta("og:image", `${BASE_URL}/og-image.png`);
            setMeta("twitter:title", meta.title);
            setMeta("twitter:description", meta.description);
            setMeta("twitter:image", `${BASE_URL}/og-image.png`);
            setCanonical(url);

            setJsonLd({
                "@context": "https://schema.org",
                "@graph": [
                    organizationSchema,
                    {
                        "@type": "SoftwareApplication",
                        name: "PrivaTools",
                        url: BASE_URL,
                        description: `Free, open-source suite of ${TOTAL_TOOL_COUNT} file tools for PDF, image, video, audio, and developer workflows. Files are processed in an isolated container and deleted after the response — no file content is logged or shared.`,
                        applicationCategory: "UtilitiesApplication",
                        operatingSystem: "Any (browser-based)",
                        offers: { "@type": "Offer", price: "0", priceCurrency: "USD" },
                        provider: { "@id": `${BASE_URL}/#organization` },
                        license: "https://opensource.org/licenses/MIT",
                        codeRepository: "https://github.com/taiyeba-dg/privatools",
                        isAccessibleForFree: true,
                        featureList: "PDF merge, PDF split, PDF compress, image conversion, video compression, OCR, format conversion, metadata removal",
                    },
                    {
                        "@type": "WebPage",
                        "@id": url,
                        name: meta.title,
                        description: meta.description,
                        url,
                        about: { "@id": `${BASE_URL}/#organization` },
                    },
                ],
            });
        } else {
            // ── All other pages ─────────────────────────────────
            const meta = pageMeta[pathname] || pageMeta["/"]!;
            document.title = meta.title;
            setMeta("description", meta.description);
            setMeta("og:title", meta.title);
            setMeta("og:description", meta.description);
            setMeta("og:url", url);
            setMeta("og:type", "website");
            setMeta("og:image", `${BASE_URL}/og-image.png`);
            setMeta("twitter:title", meta.title);
            setMeta("twitter:description", meta.description);
            setMeta("twitter:image", `${BASE_URL}/og-image.png`);
            setCanonical(url);

            if (pathname === "/") {
                const pdfItems = tools.map((t, i) => ({
                    "@type": "ListItem",
                    position: i + 1,
                    url: `${BASE_URL}/tool/${t.slug}`,
                    name: t.name,
                }));
                const nonPdfItems = nonPdfTools.map((t, i) => ({
                    "@type": "ListItem",
                    position: tools.length + i + 1,
                    url: `${BASE_URL}/tools/${t.slug}`,
                    name: t.name,
                }));
                setJsonLd({
                    "@context": "https://schema.org",
                    "@graph": [
                        {
                            "@type": "WebSite",
                            "@id": `${BASE_URL}/#website`,
                            name: "PrivaTools",
                            url: BASE_URL,
                            description: meta.description,
                            publisher: { "@id": `${BASE_URL}/#organization` },
                            potentialAction: {
                                "@type": "SearchAction",
                                target: `${BASE_URL}/?q={search_term_string}`,
                                "query-input": "required name=search_term_string",
                            },
                        },
                        organizationSchema,
                        {
                            "@type": "ItemList",
                            "@id": `${BASE_URL}/#tool-catalog`,
                            name: "PrivaTools — All File Tools",
                            description: `Complete catalog of ${TOTAL_TOOL_COUNT} free, open-source file tools.`,
                            numberOfItems: TOTAL_TOOL_COUNT,
                            itemListOrder: "https://schema.org/ItemListOrderAscending",
                            itemListElement: [...pdfItems, ...nonPdfItems],
                        },
                    ],
                });
            } else {
                removeJsonLd();
            }
        }
    }, [pathname]);

    return null;
}

function setMeta(name: string, content: string) {
    const isOg = name.startsWith("og:");
    const attr = isOg ? "property" : "name";
    const selector = isOg ? `meta[property="${name}"]` : `meta[name="${name}"]`;
    let el = document.querySelector(selector) as HTMLMetaElement | null;
    if (!el) {
        el = document.createElement("meta");
        el.setAttribute(attr, name);
        document.head.appendChild(el);
    }
    el.setAttribute("content", content);
}

function setCanonical(url: string) {
    let el = document.querySelector('link[rel="canonical"]') as HTMLLinkElement | null;
    if (!el) {
        el = document.createElement("link");
        el.setAttribute("rel", "canonical");
        document.head.appendChild(el);
    }
    el.setAttribute("href", url);
}

function setJsonLd(data: Record<string, unknown>) {
    let el = document.getElementById("jsonld-seo") as HTMLScriptElement | null;
    if (!el) {
        el = document.createElement("script");
        el.id = "jsonld-seo";
        el.type = "application/ld+json";
        document.head.appendChild(el);
    }
    el.textContent = JSON.stringify(data);
}

function removeJsonLd() {
    document.getElementById("jsonld-seo")?.remove();
}
