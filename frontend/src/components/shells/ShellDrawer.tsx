import { Suspense, lazy } from "react";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";

const Sidebar = lazy(() => import("../Sidebar").then((m) => ({ default: m.Sidebar })));

/**
 * Mobile navigation drawer. Shared by every shell — a drawer is the right
 * shape for a 219-item tree at any skin, and duplicating the focus/scrim
 * handling per shell is how that behaviour drifts.
 */
export function ShellDrawer({
    open, onClose, closeRef, className,
}: {
    open: boolean;
    onClose: () => void;
    closeRef: React.Ref<HTMLButtonElement>;
    className?: string;
}) {
    if (!open) return null;
    return (
        <>
            <button
                type="button"
                aria-label="Close menu"
                tabIndex={-1}
                className="lg:hidden fixed inset-0 z-40 bg-[var(--scrim)] backdrop-blur-sm"
                onClick={onClose}
            />
            <aside
                id="mobile-nav-drawer"
                aria-label="Mobile navigation"
                className={cn(
                    "lg:hidden fixed top-0 bottom-0 left-0 z-50 w-80 max-w-[85vw] flex flex-col",
                    "border-r border-border bg-background animate-slide-in-left shadow-2xl",
                    className,
                )}
            >
                <div className="flex items-center justify-between px-4 h-14 border-b border-border">
                    <span className="text-[13px] font-medium text-muted-foreground">All tools</span>
                    <button
                        ref={closeRef}
                        onClick={onClose}
                        className="inline-flex h-9 w-9 coarse:h-11 coarse:w-11 items-center justify-center rounded-lg text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors"
                        aria-label="Close menu"
                    >
                        <X size={17} />
                    </button>
                </div>
                <Suspense fallback={<div className="flex-1" />}>
                    <Sidebar collapsed={false} onNavigate={onClose} />
                </Suspense>
            </aside>
        </>
    );
}
