import { useEffect, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { Sun, Moon, Github, Search, Shield, Command, Menu, X } from "lucide-react";
import { useTheme } from "@/hooks/useTheme";
import { cn } from "@/lib/utils";
import { tools } from "@/data/tools";
import { nonPdfTools } from "@/data/non-pdf-tools";

const TOOL_TOTAL = tools.length + nonPdfTools.length;

const navLinks = [
  { label: "Tools",    href: "/" },
  { label: "Pipeline", href: "/pipeline", badge: "NEW" },
  { label: "Batch",    href: "/batch" },
  { label: "Blog",     href: "/blog" },
  { label: "Compare",  href: "/compare" },
  { label: "About",    href: "/about" },
];

/**
 * Slim Linear-style sticky header — 56px tall, backdrop-blur, single rule.
 * No editorial title, no dateline bar, no shrinking gymnastics.
 */
export function EditorialMasthead() {
  const { theme, toggleTheme } = useTheme();
  const location = useLocation();
  const [scrolled, setScrolled] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);

  useEffect(() => {
    let ticking = false;
    const onScroll = () => {
      if (!ticking) {
        requestAnimationFrame(() => {
          setScrolled(window.scrollY > 4);
          ticking = false;
        });
        ticking = true;
      }
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  // Close drawer on route change.
  useEffect(() => { setDrawerOpen(false); }, [location.pathname]);

  // Close on Escape + lock scroll while drawer is open.
  useEffect(() => {
    if (!drawerOpen) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setDrawerOpen(false); };
    window.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [drawerOpen]);

  const openCmdK = () => {
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "k", metaKey: true, bubbles: true }));
  };

  return (
    <header
      className={cn(
        "sticky top-0 z-50 bg-background/85 backdrop-blur-xl transition-colors",
        scrolled && "border-b border-border"
      )}
    >
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-[200] focus:rounded-md focus:bg-primary focus:px-4 focus:py-2 focus:text-primary-foreground focus:font-medium focus:shadow-lg focus:outline-none focus:ring-2 focus:ring-primary/50"
      >
        Skip to main content
      </a>
      <div className="mx-auto max-w-6xl px-4 sm:px-6">
        <div className="flex h-14 items-center justify-between gap-4">
          {/* Brand */}
          <Link to="/" className="flex items-center gap-2.5 shrink-0 group">
            <div className="h-7 w-7 rounded-md bg-primary/10 border border-primary/20 flex items-center justify-center transition-colors group-hover:bg-primary/15">
              <Shield size={14} className="text-primary" strokeWidth={2.25} />
            </div>
            <span className="font-sans-ui font-bold text-[15px] tracking-tight text-foreground">
              PrivaTools
            </span>
            <span className="hidden sm:inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium bg-secondary text-muted-foreground">
              {TOOL_TOTAL} tools
            </span>
          </Link>

          {/* Nav */}
          <nav aria-label="Primary" className="hidden md:flex items-center gap-1 flex-1 justify-center">
            {navLinks.map(link => {
              const active = location.pathname === link.href ||
                            (link.href !== "/" && location.pathname.startsWith(link.href));
              return (
                <Link
                  key={link.label}
                  to={link.href}
                  className={cn(
                    "relative inline-flex items-center gap-1.5 px-3 h-8 rounded-md text-sm font-medium transition-colors",
                    active
                      ? "text-foreground bg-secondary"
                      : "text-muted-foreground hover:text-foreground hover:bg-secondary/50"
                  )}
                >
                  {link.label}
                  {link.badge && (
                    <span className="px-1 py-px text-[8px] font-bold tracking-wider bg-primary text-primary-foreground rounded leading-none">
                      {link.badge}
                    </span>
                  )}
                </Link>
              );
            })}
          </nav>

          {/* Actions */}
          <div className="flex items-center gap-1 shrink-0">
            {/* Mobile hamburger — visible only when md nav is hidden */}
            <button
              onClick={() => setDrawerOpen(o => !o)}
              className="md:hidden inline-flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground hover:text-foreground hover:bg-secondary/50 transition-colors"
              aria-label={drawerOpen ? "Close menu" : "Open menu"}
              aria-expanded={drawerOpen}
            >
              {drawerOpen ? <X size={16} /> : <Menu size={16} />}
            </button>
            <button
              onClick={openCmdK}
              className="hidden sm:inline-flex items-center gap-2 h-8 px-2.5 rounded-md border border-border text-muted-foreground hover:text-foreground hover:bg-secondary/50 transition-colors text-sm"
              aria-label="Open command palette"
            >
              <Search size={13} />
              <span className="text-xs hidden lg:inline">Search tools</span>
              <kbd className="ml-1 hidden lg:inline-flex items-center gap-0.5 font-mono text-[10px] text-muted-foreground/85">
                <Command size={9} />K
              </kbd>
            </button>
            <button
              onClick={toggleTheme}
              className="inline-flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground hover:text-foreground hover:bg-secondary/50 transition-colors"
              title={theme === "dark" ? "Switch to light mode" : "Switch to dark mode"}
              aria-label={theme === "dark" ? "Switch to light mode" : "Switch to dark mode"}
            >
              {theme === "dark" ? <Sun size={15} /> : <Moon size={15} />}
            </button>
            <a
              href="https://github.com/taiyeba-dg/privatools"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground hover:text-foreground hover:bg-secondary/50 transition-colors"
              title="View on GitHub"
              aria-label="View PrivaTools on GitHub"
            >
              <Github size={15} />
            </a>
          </div>
        </div>

        {/* Mobile drawer — slide-down nav with all links */}
        {drawerOpen && (
          <>
            <button
              type="button"
              aria-label="Close menu"
              className="md:hidden fixed inset-0 top-14 z-[40] bg-background/60 backdrop-blur-sm cursor-default"
              onClick={() => setDrawerOpen(false)}
            />
            <nav
              role="navigation"
              aria-label="Mobile menu"
              className="md:hidden absolute left-0 right-0 top-full z-[41] bg-card border-b border-border animate-slide-down"
            >
              <div className="mx-auto max-w-6xl px-4 sm:px-6 py-3">
                <ul className="flex flex-col">
                  {navLinks.map(link => {
                    const active = location.pathname === link.href ||
                                   (link.href !== "/" && location.pathname.startsWith(link.href));
                    return (
                      <li key={link.label}>
                        <Link
                          to={link.href}
                          onClick={() => setDrawerOpen(false)}
                          className={cn(
                            "flex items-center justify-between px-3 h-11 rounded-lg text-[15px] font-medium transition-colors",
                            active ? "bg-secondary text-foreground" : "text-muted-foreground hover:bg-secondary/60 hover:text-foreground"
                          )}
                        >
                          <span className="flex items-center gap-2">
                            {link.label}
                            {link.badge && (
                              <span className="px-1.5 py-0.5 text-[9px] font-bold tracking-wider bg-accent text-accent-foreground rounded leading-none">
                                {link.badge}
                              </span>
                            )}
                          </span>
                        </Link>
                      </li>
                    );
                  })}
                </ul>
                <div className="mt-3 pt-3 border-t border-border flex items-center gap-2">
                  <button
                    onClick={() => { setDrawerOpen(false); openCmdK(); }}
                    className="flex-1 inline-flex items-center justify-center gap-2 h-10 rounded-lg border border-border text-[14px] font-medium text-foreground"
                  >
                    <Search size={14} /> Search tools
                  </button>
                  <a
                    href="https://github.com/taiyeba-dg/privatools"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center justify-center h-10 w-10 rounded-lg border border-border text-foreground"
                    aria-label="GitHub"
                  >
                    <Github size={15} />
                  </a>
                </div>
              </div>
            </nav>
          </>
        )}
      </div>
    </header>
  );
}
