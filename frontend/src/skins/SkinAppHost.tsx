import { Suspense, lazy, useEffect, useState } from "react";
import DaylightApp from "./extensions/daylight";
import { hashForPath } from "./pathRoutes";

/**
 * Mounts Daylight — the site's design.
 *
 * Daylight is a complete application: its own navigation, its own routing, its
 * own page compositions. It began as one of four selectable skins and is now
 * the only one, so it is imported eagerly — it *is* the first paint, and a
 * lazy chunk here would put a blank frame in front of every visitor.
 */

// The workspace banners the house shell used to carry. Backend-down and
// unfinished-batch are product states, not house-design states, so they live
// on whatever design owns the screen.
const BackendStatusBanner = lazy(() =>
    import("@/components/BackendStatusBanner").then((m) => ({ default: m.BackendStatusBanner })));
const BatchResumeBanner = lazy(() =>
    import("@/components/BatchResumeBanner").then((m) => ({ default: m.BatchResumeBanner })));

/** Whether Daylight is currently showing the batch surface (hash router). */
function useOnBatch(): boolean {
    const [on, setOn] = useState(() => /^#\/batch(\/|\?|$)/.test(window.location.hash));
    useEffect(() => {
        const read = () => setOn(/^#\/batch(\/|\?|$)/.test(window.location.hash));
        window.addEventListener("hashchange", read);
        return () => window.removeEventListener("hashchange", read);
    }, []);
    return on;
}

export function SkinAppHost() {
    const onBatch = useOnBatch();

    // Retire the pre-hydration brand painted by index.html — Daylight renders
    // its own header, and leaving both shows a second, offset logo.
    useEffect(() => { document.documentElement.classList.add("app-ready"); }, []);

    // The skip link in index.html has to point at Daylight's main element.
    // It targets `#main-content` (a default that predates Daylight), so
    // retarget it once the design has mounted. Poll on a timer rather than
    // rAF: a tab opened in the background gets no animation frames at all,
    // and the link has to be correct by the time that tab is fronted.
    useEffect(() => {
        let tries = 0;
        let timer = 0;
        const settle = () => {
            const prepaint = document.getElementById("prepaint-skip");
            if (!prepaint) return;
            const main = document.querySelector("main[id]");
            if (main) { prepaint.setAttribute("href", `#${main.id}`); return; }
            if (++tries < 40) timer = window.setTimeout(settle, 50);
        };
        settle();
        return () => window.clearTimeout(timer);
    }, []);

    // The mounted house pages (Pipeline, Batch, Status, My Stuff, the tool
    // components, the banners) link by path — <a href="/batch">, router
    // <Link>s. Daylight navigates by hash, and only load/popstate go through
    // the withPathRoutes bridge, so an unintercepted click would change the
    // URL without changing the screen (router links) or trigger a full
    // reload (plain anchors). Capture-phase, so it runs before react-router's
    // own handler, which respects defaultPrevented.
    const onClickCapture = (e: React.MouseEvent) => {
        if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
        const a = (e.target as HTMLElement).closest?.("a");
        if (!a) return;
        const target = a.getAttribute("target");
        if (target && target !== "_self") return;
        const href = a.getAttribute("href") || "";
        if (!href.startsWith("/") || href.startsWith("//")) return;
        const path = href.split("?")[0].split("#")[0];
        const hash = path === "/" ? "#/" : hashForPath(path);
        if (!hash) return; // no mapping — let the browser navigate; the bridge handles it on load
        e.preventDefault();
        if (window.location.hash !== hash) window.location.hash = hash;
        else window.scrollTo(0, 0);
    };

    return (
        <div onClickCapture={onClickCapture}>
            <Suspense fallback={null}>
                <BackendStatusBanner />
                {!onBatch && <BatchResumeBanner />}
            </Suspense>
            <DaylightApp />
        </div>
    );
}
