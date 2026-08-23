import { useShellChrome } from "./useShellChrome";
import { SkipLink } from "./SkipLink";
import { ShellDrawer } from "./ShellDrawer";
import { SiteHeader } from "../SiteHeader";
import { SiteFooter } from "../SiteFooter";
import { MobileNav } from "../MobileNav";

/**
 * Signature shell — the house layout.
 *
 *   ┌──────────────────────────────────────────────┐
 *   │ brand · search · actions                     │  56px  sticky
 *   │ All tools · PDF · Image · Video · Developer  │  44px  sticky
 *   ├──────────────────────────────────────────────┤
 *   │  route content, max-w-1200, document scroll  │
 *   ├──────────────────────────────────────────────┤
 *   │ categorised tool index · legal               │
 *   └──────────────────────────────────────────────┘
 *
 * No 280px left rail: a 219-item tree is a filing cabinet, not navigation, and
 * it took a fifth of the viewport on every tool page. Categories live in a 44px
 * bar; the tree survives as the mobile drawer, where a drawer is the right
 * shape for it.
 *
 * Document scroll rather than `h-screen overflow-hidden` with an inner
 * scroller — nearly all traffic lands on one of 219 pages straight from search,
 * and those pages want native scrolling, scroll restoration, and a footer the
 * page can actually reach.
 */
export function StandardShell({ children }: { children: React.ReactNode }) {
    const c = useShellChrome();

    return (
        <div className="min-h-dvh flex flex-col bg-background text-foreground">
            <SkipLink />

            <SiteHeader
                onOpenSearch={c.openCmdK}
                onOpenShortcuts={c.openShortcuts}
                mobileOpen={c.mobileOpen}
                onToggleMobile={c.toggleMobile}
                mobileTriggerRef={c.drawerTriggerRef}
            />

            <ShellDrawer open={c.mobileOpen} onClose={() => c.setMobileOpen(false)} closeRef={c.drawerCloseBtnRef} />

            <main id="main-content" className="flex-1 focus:outline-none pb-16 lg:pb-0" tabIndex={-1}>
                <div key={c.location.pathname} className="workspace-enter">
                    {children}
                </div>
            </main>

            <SiteFooter />
            <MobileNav />
        </div>
    );
}
