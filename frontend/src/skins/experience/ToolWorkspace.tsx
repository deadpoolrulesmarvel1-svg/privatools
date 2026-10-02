import { useEffect, useRef, useState, type CSSProperties, type ElementType, type ReactNode, type RefObject } from "react";
import { ArrowLeft, ArrowRight, ArrowUpRight, CircleHelp, FileText, Search, X } from "lucide-react";
import { FavoriteButton } from "../daylight/consumer/ConsumerChrome";
import { nonPdfTools } from "@/data/non-pdf-tools";
import { toolSeo } from "@/lib/tool-seo";
import { ToolGuide } from "./ToolGuide";
import { ToolLocationProvider, toolLocation } from "./tool-location";
import { ToolWhere } from "./ToolWhere";
import "./tool-workspace.css";

type CatalogTool = { slug: string; name: string; description: string; category: string; accepts?: string; outputLabel?: string; byok?: boolean; clientOnly?: boolean; icon?: ElementType; seoTitle?: string; metaDescription?: string; longDescription?: string };
const NON_PDF_SLUGS = new Set(nonPdfTools.map(tool => tool.slug));
/** A tool UI that says where the file goes itself: a shared kit, or its own location line. */
const OWN_WHERE = ".tool-studio,.ms-workspace,.merge-workbench,.consumer-formatter,.tool-where";

/**
 * Whether the tool UI has said where the file goes itself. Decided as soon as
 * it shows a shared kit or its own line, and kept for the page view: when an
 * editor replaces the intake that said it, or a result replaces the layout,
 * the page-level line must not jump in above the tool (one place per tool).
 */
function useOwnWhere(area: RefObject<HTMLElement>, slug: string) {
    const [own, setOwn] = useState(false);
    useEffect(() => {
        setOwn(false);
        const element = area.current;
        if (!element) return;
        const look = () => {
            const found = !!element.querySelector(OWN_WHERE);
            if (found) setOwn(true);
            return found;
        };
        if (look()) return;
        const watch = new MutationObserver(() => { if (look()) watch.disconnect(); });
        watch.observe(element, { childList: true, subtree: true });
        return () => watch.disconnect();
    }, [area, slug]);
    return own;
}

/**
 * Every tool page: one row of wayfinding and page utilities, the tool's name
 * and promise as the H1, then the tool itself (intake, options, action bar,
 * result) and its guide. Where the file goes is said in the intake and the
 * action bar of the shared tool kits; any other tool UI gets the same line
 * just above it (tool-workspace.css), and keeps it there.
 */
export function ToolWorkspace({ tool, categoryLabel, related, children, onFindTool }: {
    tool: CatalogTool; categoryLabel: string; related: CatalogTool[]; children: ReactNode; onFindTool: () => void;
}) {
    const [helpOpen, setHelpOpen] = useState(false);
    const area = useRef<HTMLDivElement>(null);
    const ownWhere = useOwnWhere(area, tool.slug);
    const Icon = tool.icon || FileText;
    const where = toolLocation(tool);
    const heading = toolSeo(tool);
    const tone = tool.category === "image" ? "image" : tool.category === "video-audio" ? "media" : tool.category === "developer" ? "code" : "pdf";
    return <ToolLocationProvider value={where}><article className="tw-workspace" data-tool={tool.slug} data-where={where.kind} data-own-where={ownWhere || undefined} style={{ "--tw-tone": `var(--pt-${tone})`, "--tw-tone-ink": `var(--pt-${tone}-ink)` } as CSSProperties}>
        <div className="tw-wayfinding">
            <a href="/tools"><ArrowLeft size={15} aria-hidden="true" /> All tools</a>
            <span>{categoryLabel}</span>
            <span className="tw-free">Free to use. No account needed.</span>
            <div className="tw-utilities">
                <FavoriteButton slug={tool.slug} />
                <button type="button" onClick={() => setHelpOpen(open => !open)} aria-expanded={helpOpen} aria-controls="tw-help"><CircleHelp size={16} aria-hidden="true" /><span>How it works</span></button>
                <button type="button" onClick={onFindTool}><Search size={15} aria-hidden="true" /><span>Find another tool</span></button>
            </div>
        </div>
        <header className="tw-heading">
            {/* The H1 reads "Name: promise", as the crawler HTML does; the colon is for screen readers, the promise sits on its own line. */}
            <h1 className="tw-title"><span className="tw-name">{heading.name}{heading.promise && <span className="sr-only">:</span>}</span>{heading.promise && <> <span className="tw-promise">{heading.promise}</span></>}</h1>
            <span className="tw-tool-emblem" aria-hidden="true"><Icon size={48} strokeWidth={1.3} /><i /></span>
        </header>
        {helpOpen && <section className="tw-help" id="tw-help"><div className="tw-help-intro"><h2>Before you begin</h2><button type="button" className="ts-icon-button" aria-label="Close tool help" onClick={() => setHelpOpen(false)}><X size={17} /></button></div><dl><div><dt>Bring</dt><dd>{tool.accepts?.replace(/,/g, " · ") || "Text or supported files"}</dd></div><div><dt>Take away</dt><dd>{tool.outputLabel || "Your finished result"}</dd></div></dl><p>{where.detail}</p><a href="/trust">Read about file handling <ArrowRight size={14} aria-hidden="true" /></a></section>}
        <ToolWhere className="tw-where-fallback" />
        <div className="tw-working-area" ref={area}><div className="dl-toolui">{children}</div></div>
        <ToolGuide slug={tool.slug} name={tool.name} />
        <section className="tw-afterword"><div><p className="tw-kicker">Keep going</p><h2>What’s next for your file?</h2><a href="/tools">Explore all tools <ArrowRight size={17} /></a></div><div className="tw-related">{related.slice(0, 3).map(item => <a key={item.slug} href={`${NON_PDF_SLUGS.has(item.slug) ? "/tools" : "/tool"}/${item.slug}`}><span><strong>{item.name}</strong><small>{item.description}</small></span><ArrowUpRight size={20} /></a>)}</div></section>
    </article></ToolLocationProvider>;
}
