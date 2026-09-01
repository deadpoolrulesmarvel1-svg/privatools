/* eslint-disable */
// @ts-nocheck
/**
 * Real tool UIs inside a ported design's tool page.
 *
 * The designs' own tool pages simulate a run — progress bars and result panels
 * that process nothing, labelled as simulations in their own copy. This
 * replaces that panel with the same 112 tool components the house design uses,
 * so a tool in a ported theme genuinely runs against the backend.
 *
 * The design's chrome around it is kept: hero, breadcrumb, trust chips, related
 * tools. That is what carries the theme's identity, and it is written in the
 * extension markup in each design's own idiom. Only the run panel changes.
 *
 * `realToolUI` is a React element handed to the design's markup as an ordinary
 * binding — the generated JSX renders `{v.realToolUI}` like any other value.
 */
import React, { Suspense, lazy } from "react";
import { Skeleton } from "@/components/ui/skeleton";
import { tools } from "@/data/tools";
import { nonPdfTools } from "@/data/non-pdf-tools";

// Never literals. CLAUDE.md: the site once advertised 221 when it had 219.
const TOOL_TOTAL = tools.length + nonPdfTools.length;
const PDF_COUNT = tools.length;
const NON_PDF_COUNT = nonPdfTools.length;

const ToolUI = lazy(() =>
    import("@/pages/ToolPage").then((m) => ({ default: m.ToolUI })),
);

const BY_SLUG = new Map(
    [...tools, ...nonPdfTools].map((t) => [t.slug, t]),
);

export function withRealTools(Base, config) {
    return class WithRealTools extends Base {
        renderVals() {
            const v = super.renderVals();

            // Counts, from the registry. The designs shipped literals — "200+
            // tools", "106 tools", and a "107 tools" that was never right — and
            // a literal is wrong the day a tool is added. Supplied here because
            // this mixin already holds both registries and every skin uses it.
            const vTotals = {
                toolTotal: TOOL_TOTAL,
                toolTotalLabel: `${TOOL_TOTAL} tools`,
                pdfToolCount: PDF_COUNT,
                pdfToolCountLabel: `${PDF_COUNT} tools`,
                nonPdfToolCount: NON_PDF_COUNT,
                searchToolsLabel: `Search ${TOOL_TOTAL} tools`,
                seeAllToolsLabel: `See all ${TOOL_TOTAL} tools`,
                toolTotalFreeLabel: `${TOOL_TOTAL} free file tools`,
            };

            const slug = config.slugOf(this.state, v);
            const tool = slug ? BY_SLUG.get(slug) : undefined;

            if (!tool) {
                return { ...v, ...vTotals, isRealTool: false, realToolUI: null, realToolSlug: "", realToolName: "" };
            }

            const related = [...BY_SLUG.values()]
                .filter((t) => t.category === tool.category && t.slug !== tool.slug)
                .slice(0, 4);

            return {
                ...v,
                ...vTotals,
                // The design's own tool route is switched off: its run panel
                // simulates processing, and the block in the extension markup
                // renders the real component in its place.
                ...Object.fromEntries((config.suppressFlags ?? ["isTool"]).map((f) => [f, false])),
                isRealTool: true,
                rtIcon: config.icon ?? "build",
                rtHome: (e) => { if (e?.preventDefault) e.preventDefault(); config.go(""); },
                rtTools: (e) => { if (e?.preventDefault) e.preventDefault(); config.go("tools"); },
                rtChips: config.chips(tool),
                rtRelatedD: related.length ? "block" : "none",
                rtRelated: related.map((t) => ({
                    name: t.name, desc: t.description, icon: config.icon ?? "build",
                    go: () => config.goTool(t.slug),
                })),
                realToolSlug: tool.slug,
                realToolName: tool.name,
                realToolDesc: tool.description,
                realToolAccepts: tool.accepts ?? "",
                realToolUI: (
                    <Suspense
                        fallback={
                            <div style={{ padding: "24px 0", display: "grid", gap: 12 }} aria-label={`Loading ${tool.name}`}>
                                <Skeleton className="h-44 w-full rounded-[14px]" />
                                <Skeleton className="h-4 w-56" />
                            </div>
                        }
                    >
                        <ToolUI
                            slug={tool.slug}
                            toolName={tool.name}
                            outputLabel={tool.outputLabel ?? "file"}
                            accepts={tool.accepts ?? ""}
                        />
                    </Suspense>
                ),
            };
        }
    };
}
