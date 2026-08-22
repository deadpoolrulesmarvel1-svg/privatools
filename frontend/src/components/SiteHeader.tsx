/**
 * SiteHeader — two-tier navigation.
 *
 * Replaces the 280px left rail that listed all 219 tools as a tree. That rail
 * was the "hard to find things" problem rather than the cure: a 219-item tree
 * is a filing cabinet, and it stole a fifth of the viewport on every one of the
 * tool pages that are the actual product.
 *
 * The structure is Foxit's, which was the one genuinely good navigation idea in
 * the competitor audit: a thin brand bar over a persistent category bar. It is
 * what turns a pile of SEO landing pages into something that reads as one
 * product, and it costs 44px instead of 280.
 *
 * Search is deliberately the widest thing in the header. Adobe and LightPDF
 * ship no search at all — at 45 and 92 tools that is already a weakness, and at
 * 219 it would be disqualifying.
 */
import { Link, useLocation } from "react-router-dom";
import { Command, Github, Keyboard, Menu, Search, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { ThemeMenu } from "./ThemeMenu";
import { CATEGORY_NAV } from "@/lib/nav";



interface Props {
    onOpenSearch: () => void;
    onOpenShortcuts: () => void;
    mobileOpen: boolean;
    onToggleMobile: () => void;
    mobileTriggerRef?: React.Ref<HTMLButtonElement>;
}

export function SiteHeader({
    onOpenSearch, onOpenShortcuts, mobileOpen, onToggleMobile, mobileTriggerRef,
}: Props) {
    const { pathname, search } = useLocation();

    const iconBtn =
        "inline-flex h-9 w-9 coarse:h-11 coarse:w-11 items-center justify-center rounded-lg " +
        "text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors " +
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background";

    return (
        <header className="sticky top-0 z-40 bg-background/85 backdrop-blur-xl border-b border-border">
            {/* Tier 1 — brand, search, actions */}
            <div className="mx-auto max-w-[1200px] px-4 sm:px-6 h-14 flex items-center gap-3">
                <button
                    ref={mobileTriggerRef}
                    onClick={onToggleMobile}
                    className={cn(iconBtn, "lg:hidden -ml-1")}
                    aria-label={mobileOpen ? "Close menu" : "Open menu"}
                    aria-expanded={mobileOpen}
                    aria-controls="mobile-nav-drawer"
                >
                    {mobileOpen ? <X size={18} /> : <Menu size={18} />}
                </button>

                <Link
                    to="/"
                    className="shrink-0 font-display font-bold text-foreground tracking-[-0.03em] text-[20px] leading-none rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    aria-label="PrivaTools — home"
                >
                    Privatools
                </Link>

                {/* Widest element in the header, on purpose. */}
                <div className="flex-1 flex justify-center min-w-0">
                    <button
                        onClick={onOpenSearch}
                        className="group hidden sm:flex items-center gap-2.5 h-9 w-full max-w-[440px] pl-3 pr-2 rounded-lg border border-border bg-paper-2 hover:bg-card hover:border-border-strong text-[14px] text-muted-foreground transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                        aria-label="Search tools"
                    >
                        <Search size={15} className="shrink-0" />
                        <span className="flex-1 text-left truncate">Search 219 tools, or paste a file…</span>
                        <kbd className="hidden md:inline-flex items-center gap-0.5 font-mono text-[11px] text-muted-foreground px-1.5 py-0.5 rounded border border-border bg-background">
                            <Command size={10} />K
                        </kbd>
                    </button>
                    <button onClick={onOpenSearch} className={cn(iconBtn, "sm:hidden ml-auto")} aria-label="Search tools">
                        <Search size={18} />
                    </button>
                </div>

                <div className="flex items-center gap-0.5 shrink-0">
                    <button onClick={onOpenShortcuts} className={cn(iconBtn, "hidden md:inline-flex")} aria-label="Keyboard shortcuts" title="Keyboard shortcuts (?)">
                        <Keyboard size={17} />
                    </button>
                    <ThemeMenu />
                    <a
                        href="https://github.com/deadpoolrulesmarvel1-svg/privatools"
                        target="_blank"
                        rel="noopener noreferrer"
                        className={iconBtn}
                        aria-label="View PrivaTools on GitHub"
                        title="View on GitHub"
                    >
                        <Github size={17} />
                    </a>
                </div>
            </div>

            {/* Tier 2 — the category bar. Scrolls horizontally on small screens
                rather than wrapping, so the header height never jumps. */}
            <nav aria-label="Tool categories" className="border-t border-border">
                <div className="mx-auto max-w-[1200px] px-4 sm:px-6">
                    <ul className="flex items-center gap-1 overflow-x-auto no-scrollbar -mx-1 px-1">
                        {CATEGORY_NAV.map(item => {
                            const active = item.match(pathname, search);
                            return (
                                <li key={item.href} className="shrink-0">
                                    <Link
                                        to={item.href}
                                        aria-current={active ? "page" : undefined}
                                        className={cn(
                                            "relative inline-flex items-center h-11 px-3 text-[13.5px] font-medium transition-colors rounded-md",
                                            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                                            active
                                                ? "text-foreground"
                                                : "text-muted-foreground hover:text-foreground",
                                        )}
                                    >
                                        {item.label}
                                        {/* Underline rather than a filled pill: the active tab should
                                            read as position, not as a button you can press again. */}
                                        <span
                                            aria-hidden="true"
                                            className={cn(
                                                "absolute inset-x-3 -bottom-px h-0.5 rounded-full transition-opacity",
                                                active ? "bg-foreground opacity-100" : "opacity-0",
                                            )}
                                        />
                                    </Link>
                                </li>
                            );
                        })}
                    </ul>
                </div>
            </nav>
        </header>
    );
}
