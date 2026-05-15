import { Link } from "react-router-dom";
import { Github, Lock, Shield } from "lucide-react";
import { tools } from "@/data/tools";
import { nonPdfTools } from "@/data/non-pdf-tools";

const TOOL_TOTAL = tools.length + nonPdfTools.length;

const productLinks = [
    { label: "All tools",       href: "/" },
    { label: "Pipeline",        href: "/pipeline", badge: "NEW" },
    { label: "Batch process",   href: "/batch" },
    { label: "Compare",         href: "/compare" },
];

const resourceLinks = [
    { label: "Blog",       href: "/blog" },
    { label: "About",      href: "/about" },
    { label: "Contribute", href: "https://github.com/taiyeba-dg/privatools#contributing", external: true },
    { label: "Issues",     href: "https://github.com/taiyeba-dg/privatools/issues",     external: true },
];

const legalLinks = [
    { label: "Privacy", href: "/privacy" },
    { label: "Terms",   href: "/terms" },
    { label: "Contact", href: "mailto:hello@privatools.me" },
];

export function EditorialFooter() {
    return (
        <footer className="border-t border-border mt-20 pb-20 sm:pb-0">
            <div className="mx-auto max-w-6xl px-4 sm:px-6 py-12">
                <div className="grid grid-cols-2 sm:grid-cols-12 gap-8">
                    {/* Brand */}
                    <div className="col-span-2 sm:col-span-4">
                        <Link to="/" className="inline-flex items-center gap-2 mb-3">
                            <div className="h-7 w-7 rounded-md bg-primary/10 border border-primary/20 flex items-center justify-center">
                                <Shield size={14} className="text-primary" strokeWidth={2.25} />
                            </div>
                            <span className="font-bold text-[15px] tracking-tight text-foreground">PrivaTools</span>
                        </Link>
                        <p className="text-sm text-muted-foreground leading-relaxed max-w-xs">
                            {TOOL_TOTAL} free, open-source tools for a more private internet. Self-hostable so files stay on your own infrastructure.
                        </p>
                        <a
                            href="https://github.com/taiyeba-dg/privatools"
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center gap-1.5 mt-4 h-8 px-3 rounded-full border border-border text-xs font-medium text-foreground hover:bg-secondary transition-colors"
                        >
                            <Github size={12} /> Star on GitHub
                        </a>
                    </div>

                    {/* Columns */}
                    <FooterCol title="Product" links={productLinks} />
                    <FooterCol title="Resources" links={resourceLinks} />
                    <FooterCol title="Legal" links={legalLinks} />
                </div>

                <div className="mt-12 pt-6 border-t border-border flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
                    <p className="text-xs text-muted-foreground/80">
                        © {new Date().getFullYear()} PrivaTools · MIT licensed
                    </p>
                    <div className="flex items-center gap-3 text-xs text-muted-foreground/80">
                        <span className="inline-flex items-center gap-1.5"><Lock size={11} className="text-primary" /> No third-party uploads</span>
                        <span className="text-muted-foreground/80">·</span>
                        <span>No tracking</span>
                        <span className="text-muted-foreground/80">·</span>
                        <span>No accounts</span>
                    </div>
                </div>
            </div>
        </footer>
    );
}

interface LinkItem { label: string; href: string; badge?: string; external?: boolean }

function FooterCol({ title, links }: { title: string; links: LinkItem[] }) {
    return (
        <div className="col-span-1 sm:col-span-2 lg:col-span-2">
            <h3 className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground mb-3">
                {title}
            </h3>
            <ul className="space-y-2">
                {links.map(link => (
                    <li key={link.label}>
                        {link.external ? (
                            <a href={link.href} target="_blank" rel="noopener noreferrer"
                                className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors">
                                {link.label}
                            </a>
                        ) : (
                            <Link to={link.href}
                                className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors">
                                {link.label}
                                {link.badge && (
                                    <span className="px-1 py-px text-[8px] font-bold tracking-wider bg-primary text-primary-foreground rounded leading-none">
                                        {link.badge}
                                    </span>
                                )}
                            </Link>
                        )}
                    </li>
                ))}
            </ul>
        </div>
    );
}
