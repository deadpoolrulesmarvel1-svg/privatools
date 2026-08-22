/**
 * AppShell — site layout.
 *
 *   ┌──────────────────────────────────────────────┐
 *   │ brand · search · actions                     │  56px  sticky
 *   │ All tools · PDF · Image · Video · Developer  │  44px  sticky
 *   ├──────────────────────────────────────────────┤
 *   │                                              │
 *   │  route content, max-w-1200, document scroll  │
 *   │                                              │
 *   ├──────────────────────────────────────────────┤
 *   │ categorised tool index · legal               │
 *   └──────────────────────────────────────────────┘
 *
 * Two structural changes from the workshop layout this replaces:
 *
 * 1. No 280px left rail. A 219-item tree is a filing cabinet, not navigation,
 *    and it took a fifth of the viewport on every tool page. Categories moved
 *    into a 44px bar; the tree survives as the mobile drawer, where a drawer is
 *    the right shape for it.
 *
 * 2. Document scroll instead of `h-screen overflow-hidden` with an inner
 *    scroller. The app-shell pattern is for dashboards. Nearly all traffic here
 *    lands on one of 219 pages straight from search, and those pages want
 *    native scrolling, scroll restoration, and a footer the page can actually
 *    reach.
 */
import { Suspense, lazy, useEffect, useRef, useState } from "react";
import { useLocation } from "react-router-dom";
import { Lock, X } from "lucide-react";
import { MobileNav } from "./MobileNav";
import { SiteHeader } from "./SiteHeader";
import { SiteFooter } from "./SiteFooter";

const Sidebar = lazy(() => import("./Sidebar").then(m => ({ default: m.Sidebar })));

export function AppShell({ children }: { children: React.ReactNode }) {
  const location = useLocation();
  const [mobileOpen, setMobileOpen] = useState(false);
  // Remember which element opened the drawer so focus can return there —
  // WCAG 2.4.3 (focus order).
  const drawerTriggerRef = useRef<HTMLButtonElement | null>(null);
  const drawerCloseBtnRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => { setMobileOpen(false); }, [location.pathname]);

  // Retire the pre-hydration brand in index.html once the real header exists.
  // It is position:fixed and cannot track a centred max-width container, so
  // leaving it up renders a second, offset logo.
  useEffect(() => {
    document.documentElement.classList.add("app-ready");
  }, []);

  const wasOpenRef = useRef(false);
  useEffect(() => {
    if (mobileOpen) {
      wasOpenRef.current = true;
      requestAnimationFrame(() => drawerCloseBtnRef.current?.focus());
    } else if (wasOpenRef.current && drawerTriggerRef.current) {
      drawerTriggerRef.current.focus();
      wasOpenRef.current = false;
    }
  }, [mobileOpen]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && mobileOpen) setMobileOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [mobileOpen]);

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
    // ShortcutsHelp listens for a bare `?` — synthesized without a modifier so
    // it bypasses the in-input guard.
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "?", bubbles: true }));
  };

  return (
    <div className="min-h-dvh flex flex-col bg-background text-foreground">
      {/* Mirrors the static anchor in index.html so the pre-hydration and
          hydrated skip links resolve to the same target. */}
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:fixed focus:top-3 focus:left-3 focus:z-[200] focus:rounded-lg focus:bg-primary focus:px-4 focus:py-2 focus:text-primary-foreground focus:font-medium focus:shadow-lg"
      >
        Skip to main content
      </a>

      <SiteHeader
        onOpenSearch={openCmdK}
        onOpenShortcuts={openShortcuts}
        mobileOpen={mobileOpen}
        onToggleMobile={() => setMobileOpen(o => !o)}
        mobileTriggerRef={drawerTriggerRef}
      />

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
            className="lg:hidden fixed top-0 bottom-0 left-0 z-50 w-80 max-w-[85vw] flex flex-col border-r border-border animate-slide-in-left shadow-2xl bg-background"
          >
            <div className="flex items-center justify-between px-4 h-14 border-b border-border">
              <span className="inline-flex items-center gap-2 text-[13px] font-medium text-muted-foreground">
                <Lock size={13} className="text-foreground" /> All tools
              </span>
              <button
                ref={drawerCloseBtnRef}
                onClick={() => setMobileOpen(false)}
                className="inline-flex h-9 w-9 coarse:h-11 coarse:w-11 items-center justify-center rounded-lg text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors"
                aria-label="Close menu"
              >
                <X size={17} />
              </button>
            </div>
            <Suspense fallback={<div className="flex-1" />}>
              <Sidebar collapsed={false} onNavigate={() => setMobileOpen(false)} />
            </Suspense>
          </aside>
        </>
      )}

      <main id="main-content" className="flex-1 focus:outline-none pb-16 lg:pb-0" tabIndex={-1}>
        <div key={location.pathname} className="workspace-enter">
          {children}
        </div>
      </main>

      <SiteFooter />
      <MobileNav />
    </div>
  );
}
