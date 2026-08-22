/**
 * SiteFooter — a categorised tool index on every page.
 *
 * Adobe, Foxit, Nitro and PDFescape all repeat a full categorised tool index in
 * the footer of every tool page. It was one of the seven things all five
 * incumbents had converged on independently, and the only one we had no version
 * of at all.
 *
 * It is not a link farm. At 219 tools spread across pages people reach directly
 * from search, this is the sitemap the visitor actually gets: they landed on one
 * tool from Google and have no idea the other 218 exist. Showing the most-wanted
 * few per category with an honest "all N" link is the difference between a
 * single-use utility and a product.
 */
import { Link } from "react-router-dom";
import { Lock } from "lucide-react";
import { tools, categoryMeta, type Category } from "@/data/tools";
import { nonPdfTools, nonPdfCategoryMeta, type NonPdfCategory } from "@/data/non-pdf-tools";

const PER_COLUMN = 6;

/** Lower `popularity` means higher search demand; unranked tools sort last. */
const byDemand = <T extends { popularity?: number }>(a: T, b: T) =>
    (a.popularity ?? 9_999) - (b.popularity ?? 9_999);

interface Column {
    label: string;
    href: string;
    total: number;
    items: { slug: string; name: string; href: string }[];
}

function buildColumns(): Column[] {
    const columns: Column[] = [];

    const pdfCategories: Category[] = ["organize", "edit", "optimize", "security", "to-pdf", "from-pdf"];
    for (const cat of pdfCategories) {
        const inCat = tools.filter(t => t.category === cat).sort(byDemand);
        if (!inCat.length) continue;
        columns.push({
            label: categoryMeta[cat].label,
            href: `/?tab=pdf`,
            total: inCat.length,
            items: inCat.slice(0, PER_COLUMN).map(t => ({ slug: t.slug, name: t.name, href: `/tool/${t.slug}` })),
        });
    }

    const otherCategories: NonPdfCategory[] = ["image", "video-audio", "developer"];
    for (const cat of otherCategories) {
        const inCat = nonPdfTools.filter(t => t.category === cat).sort(byDemand);
        if (!inCat.length) continue;
        columns.push({
            label: nonPdfCategoryMeta[cat].label,
            href: `/?tab=${cat}`,
            total: inCat.length,
            items: inCat.slice(0, PER_COLUMN).map(t => ({ slug: t.slug, name: t.name, href: `/tools/${t.slug}` })),
        });
    }

    return columns;
}

const COLUMNS = buildColumns();
const TOTAL_TOOLS = tools.length + nonPdfTools.length;

export function SiteFooter() {
    return (
        <footer className="mt-20 border-t border-border bg-paper-2/50">
            <div className="mx-auto max-w-6xl px-4 sm:px-6 py-12">
                <div className="grid gap-x-8 gap-y-9 grid-cols-2 md:grid-cols-3 lg:grid-cols-5">
                    {COLUMNS.map(col => (
                        <nav key={col.label} aria-label={col.label}>
                            <h2 className="text-[13px] font-semibold text-foreground mb-3">{col.label}</h2>
                            <ul className="space-y-1.5">
                                {col.items.map(item => (
                                    <li key={item.slug}>
                                        <Link
                                            to={item.href}
                                            className="text-[13px] text-muted-foreground hover:text-foreground transition-colors rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                                        >
                                            {item.name}
                                        </Link>
                                    </li>
                                ))}
                                {col.total > PER_COLUMN && (
                                    <li>
                                        <Link
                                            to={col.href}
                                            className="text-[13px] text-accent hover:underline rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                                        >
                                            All {col.total}
                                        </Link>
                                    </li>
                                )}
                            </ul>
                        </nav>
                    ))}
                </div>

                <div className="mt-12 pt-6 border-t border-border flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                    <p className="flex items-center gap-2 text-[13px] text-muted-foreground">
                        <Lock size={13} className="shrink-0 text-foreground" />
                        {/* The accurate claim, not the flattering one: most tools do upload. */}
                        <span>
                            {TOTAL_TOOLS} free tools. No account, no watermarks. Files are deleted
                            as soon as they're processed.
                        </span>
                    </p>
                    <nav aria-label="Site" className="flex flex-wrap items-center gap-x-5 gap-y-2 text-[13px]">
                        {[
                            { label: "About", href: "/about" },
                            { label: "Blog", href: "/blog" },
                            { label: "Status", href: "/status" },
                            { label: "Support", href: "/support" },
                            { label: "Privacy", href: "/privacy" },
                            { label: "Security", href: "/security" },
                            { label: "Terms", href: "/terms" },
                        ].map(l => (
                            <Link
                                key={l.href}
                                to={l.href}
                                className="text-muted-foreground hover:text-foreground transition-colors rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                            >
                                {l.label}
                            </Link>
                        ))}
                        <a
                            href="https://github.com/deadpoolrulesmarvel1-svg/privatools"
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-muted-foreground hover:text-foreground transition-colors rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                        >
                            Source
                        </a>
                    </nav>
                </div>
            </div>
        </footer>
    );
}
