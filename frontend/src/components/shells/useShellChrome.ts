import { useEffect, useRef, useState } from "react";
import { useLocation } from "react-router-dom";

/**
 * Behaviour shared by every shell: mobile drawer state, focus return, Escape
 * handling, scroll lock, and the global keyboard openers.
 *
 * Skins differ in chrome, not in how a drawer behaves — keeping this here means
 * the accessibility work (focus trap entry/exit, Escape order, scroll lock) is
 * written once and cannot drift between the four shells.
 */
export function useShellChrome() {
    const location = useLocation();
    const [mobileOpen, setMobileOpen] = useState(false);

    // Remember which control opened the drawer so focus can return there —
    // WCAG 2.4.3 (focus order).
    const drawerTriggerRef = useRef<HTMLButtonElement | null>(null);
    const drawerCloseBtnRef = useRef<HTMLButtonElement | null>(null);
    const wasOpenRef = useRef(false);

    useEffect(() => { setMobileOpen(false); }, [location.pathname]);

    // Retire the pre-hydration brand in index.html once real chrome exists.
    useEffect(() => { document.documentElement.classList.add("app-ready"); }, []);

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
        if (!mobileOpen) return;
        document.body.style.overflow = "hidden";
        return () => { document.body.style.overflow = ""; };
    }, [mobileOpen]);

    const openCmdK = () => {
        window.dispatchEvent(new KeyboardEvent("keydown", { key: "k", metaKey: true, bubbles: true }));
    };
    const openShortcuts = () => {
        // ShortcutsHelp listens for a bare `?`, synthesized without a modifier
        // so it bypasses the in-input guard.
        window.dispatchEvent(new KeyboardEvent("keydown", { key: "?", bubbles: true }));
    };

    return {
        location,
        mobileOpen,
        setMobileOpen,
        toggleMobile: () => setMobileOpen((o) => !o),
        drawerTriggerRef,
        drawerCloseBtnRef,
        openCmdK,
        openShortcuts,
    };
}
