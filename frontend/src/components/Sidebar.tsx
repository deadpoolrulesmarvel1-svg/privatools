/**
 * Sidebar — the tool tree. The primary navigation.
 *
 * Layout (top → bottom):
 *   - Top-level routes (Pipeline, Batch, Blog, Compare, About)
 *   - "Pinned" — user favorites
 *   - "Recent" — history
 *   - "Tools" — expandable suite tree (PDF / Image / Video / Dev / Archive / Docs)
 *
 * In collapsed mode (48px wide), only icons render with tooltips.
 */
import { memo, useState, useMemo } from "react";
import { Link, useLocation } from "react-router-dom";
import {
    ChevronRight, GitBranch, Layers, History, BookOpen,
    Scale, Info, Home, FileText, Image as ImageIcon, Video, Code as CodeIcon,
    Archive as ArchiveIcon, FileBox, Star,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { tools, Category } from "@/data/tools";
import { nonPdfTools, NonPdfCategory } from "@/data/non-pdf-tools";
import { useHistory } from "@/hooks/useHistory";
import { useFavorites } from "@/hooks/useFavorites";
import { prefetchRoute, loadToolPage, loadNonPdfToolPage } from "@/lib/prefetch";

type Suite = {
    id: string;
    label: string;
    icon: typeof FileText;
    catClass: string;
    pdfCategories?: { id: Category; label: string; no: string }[];
    nonPdfCategory?: NonPdfCategory;
};

const SUITES: Suite[] = [
    {
        id: "pdf", label: "PDF", icon: FileText, catClass: "cat-optimize",
        pdfCategories: [
            { id: "organize", no: "01", label: "Organize" },
            { id: "edit",     no: "02", label: "Edit" },
            { id: "optimize", no: "03", label: "Optimize" },
            { id: "security", no: "04", label: "Security" },
            { id: "to-pdf",   no: "05", label: "Convert to PDF" },
            { id: "from-pdf", no: "06", label: "Convert from PDF" },
            { id: "advanced", no: "07", label: "Advanced" },
        ],
    },
    { id: "image",           label: "Image",     icon: ImageIcon,   catClass: "cat-image",           nonPdfCategory: "image" },
    { id: "video-audio",     label: "Video",     icon: Video,       catClass: "cat-video-audio",     nonPdfCategory: "video-audio" },
    { id: "developer",       label: "Developer", icon: CodeIcon,    catClass: "cat-developer",       nonPdfCategory: "developer" },
    { id: "archive",         label: "Archive",   icon: ArchiveIcon, catClass: "cat-archive",         nonPdfCategory: "archive" },
    { id: "document-office", label: "Docs",      icon: FileBox,     catClass: "cat-document-office", nonPdfCategory: "document-office" },
];

const TOP_NAV = [
    { label: "Home",     href: "/",         icon: Home },
    { label: "Pipeline", href: "/pipeline", icon: GitBranch, badge: "NEW" },
    { label: "Batch",    href: "/batch",    icon: Layers },
    { label: "Compare",  href: "/compare",  icon: Scale },
    { label: "Blog",     href: "/blog",     icon: BookOpen },
    { label: "About",    href: "/about",    icon: Info },
];

const TOOL_TOTAL = tools.length + nonPdfTools.length;

function SidebarInner({ collapsed, onNavigate }: { collapsed: boolean; onNavigate?: () => void }) {
    const location = useLocation();
    const { history } = useHistory();
    const { favorites } = useFavorites();

    // Suite expansion state — derive initial value from current route
    const [expanded, setExpanded] = useState<Set<string>>(() => {
        const initial = new Set<string>();
        if (location.pathname.startsWith("/tool/")) initial.add("pdf");
        if (location.pathname.startsWith("/tools/")) {
            const slug = location.pathname.split("/")[2];
            const t = nonPdfTools.find(x => x.slug === slug);
            if (t) {
                const s = SUITES.find(s => s.nonPdfCategory === t.category);
                if (s) initial.add(s.id);
            }
        }
        return initial;
    });

    const toggle = (id: string) => setExpanded(prev => {
        const next = new Set(prev);
        if (next.has(id)) next.delete(id); else next.add(id);
        return next;
    });

    // Favorites mapped to tool objects
    const favItems = useMemo(() =>
        favorites.slice(0, 8).map(slug => {
            const pdf = tools.find(t => t.slug === slug);
            const nonPdf = nonPdfTools.find(t => t.slug === slug);
            if (pdf) return { slug: pdf.slug, name: pdf.name, icon: pdf.icon, href: `/tool/${pdf.slug}`, catClass: `cat-${pdf.category}` };
            if (nonPdf) return { slug: nonPdf.slug, name: nonPdf.name, icon: nonPdf.icon, href: `/tools/${nonPdf.slug}`, catClass: `cat-${nonPdf.category}` };
            return null;
        }).filter(Boolean) as { slug: string; name: string; icon: typeof FileText; href: string; catClass: string }[]
    , [favorites]);

    const recentItems = useMemo(() =>
        history.slice(0, 5).map(h => {
            const pdf = tools.find(t => t.slug === h.slug);
            const nonPdf = nonPdfTools.find(t => t.slug === h.slug);
            if (pdf) return { slug: pdf.slug, name: pdf.name, icon: pdf.icon, href: `/tool/${pdf.slug}`, catClass: `cat-${pdf.category}` };
            if (nonPdf) return { slug: nonPdf.slug, name: nonPdf.name, icon: nonPdf.icon, href: `/tools/${nonPdf.slug}`, catClass: `cat-${nonPdf.category}` };
            return null;
        }).filter(Boolean) as { slug: string; name: string; icon: typeof FileText; href: string; catClass: string }[]
    , [history]);

    if (collapsed) {
        // Collapsed: icons only
        return (
            <nav className="flex-1 overflow-y-auto py-2 flex flex-col items-center gap-1" aria-label="Tool navigation, collapsed">
                {TOP_NAV.map(n => {
                    const Icon = n.icon;
                    const active = location.pathname === n.href || (n.href !== "/" && location.pathname.startsWith(n.href));
                    return (
                        <Link
                            key={n.href}
                            to={n.href}
                            onClick={onNavigate}
                            aria-current={active ? "page" : undefined}
                            className={cn(
                                "inline-flex h-8 w-8 items-center justify-center rounded-md transition-colors relative",
                                active
                                    ? "bg-secondary text-foreground"
                                    : "text-muted-foreground hover:text-foreground hover:bg-secondary/60"
                            )}
                            title={n.label}
                            aria-label={n.badge ? `${n.label} (new)` : n.label}
                        >
                            <Icon size={15} strokeWidth={1.75} aria-hidden="true" />
                            {n.badge && <span className="absolute top-0.5 right-0.5 h-1.5 w-1.5 rounded-full bg-accent" aria-hidden="true" />}
                        </Link>
                    );
                })}
                <div className="my-1 h-px w-6 bg-border" />
                {SUITES.map(s => {
                    const Icon = s.icon;
                    const count = s.id === "pdf"
                        ? tools.length
                        : nonPdfTools.filter(t => t.category === s.nonPdfCategory).length;
                    return (
                        <button
                            key={s.id}
                            onClick={() => toggle(s.id)}
                            className={cn(
                                "inline-flex h-8 w-8 items-center justify-center rounded-md transition-colors relative",
                                s.catClass,
                                "text-muted-foreground hover:text-foreground hover:bg-secondary/60"
                            )}
                            title={`${s.label} — ${count} tools`}
                            aria-label={`${s.label} — ${count} tools`}
                        >
                            <Icon size={15} strokeWidth={1.75} style={{ color: "hsl(var(--tile, var(--accent)))" }} />
                        </button>
                    );
                })}
            </nav>
        );
    }

    return (
        <nav className="flex-1 overflow-y-auto pb-3" aria-label="Tool navigation">
            {/* Top-level routes */}
            <div className="pt-3 px-2.5">
                {TOP_NAV.map(n => {
                    const Icon = n.icon;
                    const active = location.pathname === n.href || (n.href !== "/" && location.pathname.startsWith(n.href));
                    return (
                        <Link
                            key={n.href}
                            to={n.href}
                            onClick={onNavigate}
                            aria-current={active ? "page" : undefined}
                            className={cn(
                                "group relative flex items-center gap-2.5 px-2.5 h-8 rounded-md text-[13px] font-medium transition-colors",
                                active
                                    ? "bg-secondary text-foreground"
                                    : "text-muted-foreground hover:text-foreground hover:bg-secondary/50"
                            )}
                        >
                            {/* Active marker — thin vertical accent bar */}
                            {active && (
                                <span className="absolute -left-1 top-1/2 -translate-y-1/2 h-4 w-0.5 bg-accent rounded-full" aria-hidden="true" />
                            )}
                            <Icon
                                size={13}
                                strokeWidth={1.75}
                                aria-hidden="true"
                                className={cn(
                                    "transition-transform group-hover:scale-110",
                                    active ? "text-accent" : "text-muted-foreground/85 group-hover:text-foreground"
                                )}
                            />
                            <span className="flex-1 truncate">{n.label}</span>
                            {n.badge && (
                                <span
                                    aria-label="(new)"
                                    className="px-1 py-px font-mono text-[8.5px] font-semibold tracking-wider bg-accent text-accent-foreground rounded leading-none animate-accent-pulse"
                                >
                                    {n.badge}
                                </span>
                            )}
                        </Link>
                    );
                })}
            </div>

            {/* Pinned */}
            {favItems.length > 0 && (
                <div className="mt-4 px-2.5">
                    <SectionLabel label="Pinned" icon={Star} count={favItems.length} />
                    <div className="mt-1">
                        {favItems.map(t => (
                            <SidebarToolLink key={t.slug} {...t} onNavigate={onNavigate} active={location.pathname.endsWith(`/${t.slug}`)} />
                        ))}
                    </div>
                </div>
            )}

            {/* Recently used */}
            {recentItems.length > 0 && (
                <div className="mt-4 px-2.5">
                    <SectionLabel label="Recent" icon={History} count={recentItems.length} />
                    <div className="mt-1">
                        {recentItems.map(t => (
                            <SidebarToolLink key={t.slug} {...t} onNavigate={onNavigate} active={location.pathname.endsWith(`/${t.slug}`)} />
                        ))}
                    </div>
                </div>
            )}

            {/* Tool tree by suite */}
            <div className="mt-4 px-2.5">
                <SectionLabel label={`All ${TOOL_TOTAL} tools`} />
                <div className="mt-1 space-y-px">
                    {SUITES.map(suite => {
                        const isOpen = expanded.has(suite.id);
                        const Icon = suite.icon;
                        const count = suite.id === "pdf"
                            ? tools.length
                            : nonPdfTools.filter(t => t.category === suite.nonPdfCategory).length;
                        return (
                            <div key={suite.id} className={suite.catClass}>
                                <button
                                    onClick={() => toggle(suite.id)}
                                    aria-expanded={isOpen}
                                    className="group flex items-center gap-2 w-full px-2.5 h-8 rounded-md text-[13px] font-medium text-foreground/85 hover:bg-secondary/50 hover:text-foreground transition-colors"
                                >
                                    <ChevronRight
                                        size={12}
                                        className={cn("text-muted-foreground/85 transition-transform shrink-0", isOpen && "rotate-90")}
                                    />
                                    <Icon size={13} strokeWidth={1.75} style={{ color: "hsl(var(--tile))" }} className="shrink-0" />
                                    <span className="flex-1 text-left truncate">{suite.label}</span>
                                    <span className="font-mono text-[10px] text-muted-foreground/70">{count}</span>
                                </button>

                                {isOpen && suite.pdfCategories && (
                                    <div className="ml-3 mt-1 pl-2.5 border-l border-border space-y-0.5 mb-1 animate-slide-down">
                                        {suite.pdfCategories.map(cat => {
                                            const catTools = tools.filter(t => t.category === cat.id);
                                            const isCatOpen = expanded.has(`pdf-${cat.id}`);
                                            return (
                                                <div key={cat.id} className={`cat-${cat.id}`}>
                                                    <button
                                                        onClick={() => toggle(`pdf-${cat.id}`)}
                                                        aria-expanded={isCatOpen}
                                                        className="group flex items-center gap-2 w-full px-2 h-7 rounded-md text-[12.5px] text-muted-foreground hover:text-foreground hover:bg-secondary/50 transition-colors"
                                                    >
                                                        <ChevronRight
                                                            size={10}
                                                            className={cn("opacity-50 transition-transform shrink-0", isCatOpen && "rotate-90")}
                                                        />
                                                        <span className="font-mono text-[9.5px] tracking-[0.10em] text-accent">{cat.no}</span>
                                                        <span className="flex-1 text-left truncate">{cat.label}</span>
                                                        <span className="font-mono text-[10px] text-muted-foreground/70">{catTools.length}</span>
                                                    </button>
                                                    {isCatOpen && (
                                                        <div className="ml-3 pl-2.5 border-l border-border space-y-px mb-1">
                                                            {catTools.map(t => (
                                                                <SidebarToolLink
                                                                    key={t.slug}
                                                                    slug={t.slug}
                                                                    name={t.name}
                                                                    icon={t.icon}
                                                                    href={`/tool/${t.slug}`}
                                                                    catClass={`cat-${t.category}`}
                                                                    onNavigate={onNavigate}
                                                                    active={location.pathname === `/tool/${t.slug}`}
                                                                />
                                                            ))}
                                                        </div>
                                                    )}
                                                </div>
                                            );
                                        })}
                                    </div>
                                )}

                                {isOpen && suite.nonPdfCategory && (
                                    <div className="ml-3 mt-1 pl-2.5 border-l border-border space-y-px mb-1 animate-slide-down">
                                        {nonPdfTools
                                            .filter(t => t.category === suite.nonPdfCategory)
                                            .map(t => (
                                                <SidebarToolLink
                                                    key={t.slug}
                                                    slug={t.slug}
                                                    name={t.name}
                                                    icon={t.icon}
                                                    href={`/tools/${t.slug}`}
                                                    catClass={`cat-${t.category}`}
                                                    onNavigate={onNavigate}
                                                    active={location.pathname === `/tools/${t.slug}`}
                                                />
                                            ))}
                                    </div>
                                )}
                            </div>
                        );
                    })}
                </div>
            </div>
        </nav>
    );
}

function SectionLabel({ label, icon: Icon, count }: { label: string; icon?: typeof FileText; count?: number }) {
    return (
        <div className="px-2.5 flex items-center gap-1.5">
            {Icon && <Icon size={10} className="text-muted-foreground/85" />}
            <span className="font-mono text-[10px] font-medium tracking-[0.12em] uppercase text-muted-foreground/85">
                <span className="text-accent">§</span> {label}
            </span>
            {typeof count === "number" && (
                <span className="ml-auto font-mono text-[10px] text-muted-foreground/70">{count}</span>
            )}
        </div>
    );
}

const SidebarToolLink = memo(function SidebarToolLink({
    name, icon: Icon, href, catClass, active, onNavigate,
}: {
    slug: string; name: string; icon: typeof FileText; href: string; catClass: string;
    active?: boolean; onNavigate?: () => void;
}) {
    // Hover-prefetch the right page shell. The actual per-tool chunk is
    // also dynamically imported by ToolPage / NonPdfToolPage when the
    // route renders, but warming up the page-level shell on hover saves
    // a render frame and avoids the Suspense fallback flash for most
    // mouse-driven navigations.
    const prefetch = () => {
        prefetchRoute(href.startsWith("/tools/") ? loadNonPdfToolPage : loadToolPage);
    };
    return (
        <Link
            to={href}
            onClick={onNavigate}
            onMouseEnter={prefetch}
            onFocus={prefetch}
            onTouchStart={prefetch}
            aria-current={active ? "page" : undefined}
            className={cn(
                "group flex items-center gap-2 px-2 h-7 rounded-md text-[12.5px] transition-colors",
                catClass,
                active
                    ? "bg-secondary text-foreground"
                    : "text-muted-foreground/90 hover:text-foreground hover:bg-secondary/50"
            )}
        >
            <Icon size={12} strokeWidth={1.75} style={{ color: "hsl(var(--tile, var(--accent)))" }} className="shrink-0" aria-hidden="true" />
            <span className="flex-1 truncate">{name}</span>
        </Link>
    );
});

// Memoise the sidebar so route changes that only flip `location.pathname`
// (e.g. /tool/merge-pdf → /tool/compress-pdf) don't re-run the 179-tool tree render when
// the AppShell re-renders. Internally we still consume `useLocation` for
// active-row highlighting so navigation stays correct.
export const Sidebar = memo(SidebarInner);
