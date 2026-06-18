/**
 * AppShell — persistent workshop layout.
 *
 *   ┌──────────────────────────────────────────────────┐
 *   │ Topbar (40px, very thin) — brand · ⌘K · theme    │
 *   ├──────────┬──────────────────────────────────────┬┤
 *   │          │                                      ││
 *   │ Sidebar  │           Workspace                  ││
 *   │ 280px    │           (the route renders here)   ││
 *   │ tree     │                                      ││
 *   │          │                                      ││
 *   │          │                                      ││
 *   ├──────────┴──────────────────────────────────────┤│
 *   │ StatusBar (28px) — § · MIT · PRIVATE · ⌘K       │
 *   └──────────────────────────────────────────────────┘
 *
 * The sidebar is the navigation — top bar is brand and quick actions
 * only. The route renders inside the workspace, scrolling independently
 * of the chrome.
 */
import { Suspense, lazy, useEffect, useRef, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { Sun, Moon, Github, Search, Command, Menu, X, Lock, ChevronsLeft, ChevronsRight, Keyboard } from "lucide-react";
import { useTheme } from "@/hooks/useTheme";
import { cn } from "@/lib/utils";
import { MobileNav } from "./MobileNav";

const SIDEBAR_STATE_KEY = "privatools_sidebar_collapsed";
const Sidebar = lazy(() => import("./Sidebar").then(m => ({ default: m.Sidebar })));
const StatusBar = lazy(() => import("./StatusBar").then(m => ({ default: m.StatusBar })));

export function AppShell({ children }: { children: React.ReactNode }) {
  const { theme, toggleTheme } = useTheme();
  const location = useLocation();
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => {
    try { return localStorage.getItem(SIDEBAR_STATE_KEY) === "1"; } catch { return false; }
  });
  const [mobileOpen, setMobileOpen] = useState(false);
  // Remember which element triggered the mobile drawer so we can restore focus
  // when it closes — WCAG 2.4.3 (focus order).
  const drawerTriggerRef = useRef<HTMLButtonElement | null>(null);
  const drawerCloseBtnRef = useRef<HTMLButtonElement | null>(null);

  const setCollapsed = (v: boolean) => {
    setSidebarCollapsed(v);
    try { localStorage.setItem(SIDEBAR_STATE_KEY, v ? "1" : "0"); } catch {}
  };

  // Close mobile drawer on route change
  useEffect(() => {
    setMobileOpen(false);
  }, [location.pathname]);

  // Mobile drawer focus management — when the drawer opens, move focus to the
  // close button (a known landmark inside the drawer). When it closes, restore
  // focus to the trigger. Without this, keyboard users land at the start of
  // the document each time they open/close the menu.
  const wasOpenRef = useRef(false);
  useEffect(() => {
    if (mobileOpen) {
      wasOpenRef.current = true;
      // Use rAF so the drawer mounts before we focus.
      requestAnimationFrame(() => drawerCloseBtnRef.current?.focus());
    } else if (wasOpenRef.current && drawerTriggerRef.current) {
      // Only restore focus when the drawer was *previously* open — avoid
      // hijacking initial focus on first paint.
      drawerTriggerRef.current.focus();
      wasOpenRef.current = false;
    }
  }, [mobileOpen]);

  // Cmd+B toggles sidebar (Linear/VSCode convention)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "b" && !e.shiftKey) {
        e.preventDefault();
        setCollapsed(!sidebarCollapsed);
      }
      if (e.key === "Escape" && mobileOpen) setMobileOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [sidebarCollapsed, mobileOpen]);

  // Lock body scroll when mobile drawer open
  useEffect(() => {
    if (mobileOpen) {
      document.body.style.overflow = "hidden";
      return () => { document.body.style.overflow = ""; };
    }
  }, [mobileOpen]);

  const openCmdK = () => {
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "k", metaKey: true, bubbles: true }));
  };
  const openShortcuts = () => {
    // Dispatch `?` press — ShortcutsHelp listens for it. We synthesize
    // a non-modifier keydown so it bypasses the in-input guard.
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "?", bubbles: true }));
  };

  return (
    <div className="h-screen w-screen flex flex-col bg-background text-foreground overflow-hidden">
      {/* Skip link — matches the static `<a href="#main-content">` in index.html so
         both the pre-hydration anchor and this hydrated one resolve to the same target. */}
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-[200] focus:rounded-md focus:bg-primary focus:px-4 focus:py-2 focus:text-primary-foreground focus:font-medium focus:shadow-lg"
      >
        Skip to main content
      </a>

      {/* Topbar — slim, app-like */}
      <header className="relative z-30 flex-shrink-0 h-11 border-b border-border bg-paper/90 backdrop-blur-xl flex items-center pl-2 pr-3 gap-2">
        {/* Mobile menu */}
        <button
          ref={drawerTriggerRef}
          onClick={() => setMobileOpen(o => !o)}
          className="lg:hidden inline-flex h-8 w-8 coarse:h-11 coarse:w-11 items-center justify-center rounded-md text-muted-foreground hover:text-foreground hover:bg-secondary/60 transition-colors"
          aria-label={mobileOpen ? "Close menu" : "Open menu"}
          aria-expanded={mobileOpen}
          aria-controls="mobile-nav-drawer"
        >
          {mobileOpen ? <X size={16} /> : <Menu size={16} />}
        </button>

        {/* Brand */}
        <Link to="/" className="flex items-baseline gap-2 px-2 group" aria-label="PrivaTools — home">
          <span className="font-display font-bold text-foreground tracking-[-0.03em] text-[19px] leading-none">
            Priva<span className="italic text-accent">tools</span>
          </span>
        </Link>

        {/* Topbar workshop dateline (hidden on small screens) */}
        <span className="hidden md:inline-flex items-center gap-2 ml-3 font-mono text-[10px] tracking-[0.12em] uppercase text-muted-foreground/85">
          <span className="text-accent">§</span>
          A workshop for private file work
        </span>

        {/* Centered ⌘K search button — primary nav input */}
        <div className="flex-1 flex items-center justify-center">
          <button
            onClick={openCmdK}
            className="group hidden sm:inline-flex items-center gap-2.5 h-7 px-2.5 pr-2 rounded-md border border-border bg-card/60 hover:bg-card hover:border-border-strong text-[13px] text-muted-foreground transition-colors min-w-[280px]"
            aria-label="Open command palette"
          >
            <Search size={12} />
            <span className="flex-1 text-left">Search tools, paste a file…</span>
            <kbd className="inline-flex items-center gap-0.5 font-mono text-[10px] text-muted-foreground/85 px-1.5 py-0.5 rounded bg-secondary/80">
              <Command size={9} />K
            </kbd>
          </button>
          {/* Mobile compact search */}
          <button
            onClick={openCmdK}
            className="sm:hidden inline-flex h-8 w-8 coarse:h-11 coarse:w-11 items-center justify-center rounded-md text-muted-foreground hover:text-foreground hover:bg-secondary/60 transition-colors"
            aria-label="Open command palette"
          >
            <Search size={15} />
          </button>
        </div>

        {/* Right actions */}
        <div className="flex items-center gap-0.5">
          <button
            onClick={openShortcuts}
            className="hidden md:inline-flex h-8 w-8 coarse:h-11 coarse:w-11 items-center justify-center rounded-md text-muted-foreground hover:text-foreground hover:bg-secondary/60 transition-colors"
            title="Keyboard shortcuts (?)"
            aria-label="Open keyboard shortcuts"
          >
            <Keyboard size={15} />
          </button>
          <button
            onClick={toggleTheme}
            className="inline-flex h-8 w-8 coarse:h-11 coarse:w-11 items-center justify-center rounded-md text-muted-foreground hover:text-foreground hover:bg-secondary/60 transition-colors"
            title={theme === "dark" ? "Switch to light mode" : "Switch to dark mode"}
            aria-label={theme === "dark" ? "Switch to light mode" : "Switch to dark mode"}
          >
            {theme === "dark" ? <Sun size={15} /> : <Moon size={15} />}
          </button>
          <a
            href="https://github.com/deadpoolrulesmarvel1-svg/privatools"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex h-8 w-8 coarse:h-11 coarse:w-11 items-center justify-center rounded-md text-muted-foreground hover:text-foreground hover:bg-secondary/60 transition-colors"
            title="View on GitHub"
            aria-label="View PrivaTools on GitHub"
          >
            <Github size={15} />
          </a>
        </div>
      </header>

      {/* Body — sidebar + workspace */}
      <div className="flex-1 flex min-h-0 relative">
        {/* Desktop sidebar — landmark wraps the inner <nav> which carries its own
           aria-label; we leave only the inner nav labeled to avoid a duplicate
           landmark in the a11y tree. */}
        <aside
          className={cn(
            "hidden lg:flex flex-col flex-shrink-0 border-r border-border bg-paper-2/40 transition-[width] duration-200 ease-out",
            sidebarCollapsed ? "w-12" : "w-72"
          )}
        >
          <Suspense fallback={<div className="flex-1" />}>
            <Sidebar collapsed={sidebarCollapsed} />
          </Suspense>
          <div className="border-t border-border px-2 py-2 flex items-center justify-between">
            <span className={cn("inline-flex items-center gap-1.5 font-mono text-[10px] tracking-[0.08em] uppercase text-muted-foreground/85 px-2", sidebarCollapsed && "hidden")}>
              <Lock size={10} className="text-accent" /> Private
            </span>
            <button
              onClick={() => setCollapsed(!sidebarCollapsed)}
              className="inline-flex h-7 w-7 coarse:h-11 coarse:w-11 items-center justify-center rounded text-muted-foreground hover:text-foreground hover:bg-secondary/60 transition-colors"
              title={sidebarCollapsed ? "Expand sidebar (⌘B)" : "Collapse sidebar (⌘B)"}
              aria-label={sidebarCollapsed ? "Expand sidebar" : "Collapse sidebar"}
              aria-expanded={!sidebarCollapsed}
            >
              {sidebarCollapsed ? <ChevronsRight size={14} /> : <ChevronsLeft size={14} />}
            </button>
          </div>
        </aside>

        {/* Mobile drawer */}
        {mobileOpen && (
          <>
            <button
              type="button"
              aria-label="Close menu"
              tabIndex={-1}
              className="lg:hidden fixed inset-0 z-40 bg-foreground/40 backdrop-blur-sm"
              onClick={() => setMobileOpen(false)}
            />
            <aside
              id="mobile-nav-drawer"
              aria-label="Mobile navigation"
              className="lg:hidden fixed top-11 bottom-0 left-0 z-50 w-72 max-w-[82vw] flex flex-col border-r border-border animate-slide-in-left shadow-2xl"
              style={{ background: "hsl(var(--background))" }}
            >
              {/* Slim drawer header — close affordance + § brand line */}
              <div className="flex items-center justify-between px-3 py-2 border-b border-border">
                <span className="inline-flex items-center gap-1.5 font-mono text-[10px] tracking-[0.12em] uppercase text-muted-foreground/85">
                  <Lock size={10} className="text-accent" /> Menu
                </span>
                <button
                  ref={drawerCloseBtnRef}
                  onClick={() => setMobileOpen(false)}
                  className="inline-flex h-7 w-7 coarse:h-11 coarse:w-11 items-center justify-center rounded text-muted-foreground hover:text-foreground hover:bg-secondary/60 transition-colors"
                  aria-label="Close menu"
                >
                  <X size={14} />
                </button>
              </div>
              <Suspense fallback={<div className="flex-1" />}>
                <Sidebar collapsed={false} onNavigate={() => setMobileOpen(false)} />
              </Suspense>
            </aside>
          </>
        )}

        {/* Workspace — keyed by pathname so each route fades-up.
           id="main-content" so the static skip-link in index.html and the React-side
           skip-link both target a single landmark. tabIndex=-1 lets the link move
           focus here on activation. */}
        <main
          id="main-content"
          className="flex-1 min-w-0 overflow-y-auto overflow-x-hidden pb-20 lg:pb-0 focus:outline-none"
          tabIndex={-1}
        >
          <div key={location.pathname} className="workspace-enter min-h-full">
            {children}
          </div>
        </main>
      </div>

      <MobileNav />

      {/* Status bar */}
      <Suspense fallback={null}>
        <StatusBar />
      </Suspense>
    </div>
  );
}
