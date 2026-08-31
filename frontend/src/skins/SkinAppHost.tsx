import { Suspense, lazy, useEffect } from "react";
import { useSkin } from "@/hooks/useSkin";
import { isSkinId, type SkinId } from "@/lib/skins";
import { SkinDock } from "@/components/SkinDock";

/**
 * Renders a ported design theme in place of the app's own routes.
 *
 * The three imported designs are complete applications — their own navigation,
 * their own routing, their own page compositions — so a skin is not a re-skin
 * of our shell but a swap of the whole surface. Each is code-split; only the
 * active one is ever fetched.
 */
/**
 * Each entry loads that skin's *extension* where one exists — a subclass of the
 * generated component that adds the surfaces the imported design never had
 * (accounts, API keys, and the rest of the feature manifest). Skins without an
 * extension yet fall back to the generated component directly.
 */
const APPS: Record<Exclude<SkinId, "signature">, React.LazyExoticComponent<React.ComponentType>> = {
    daylight: lazy(() => import("./extensions/daylight")),
    aurora: lazy(() => import("./extensions/aurora")),
    carbon: lazy(() => import("./extensions/carbon")),
    structured: lazy(() => import("./extensions/structured")),
};

export function SkinAppHost() {
    const { skin, setSkin } = useSkin();

    // Retire the pre-hydration brand painted by index.html. Our own shells do
    // this from useShellChrome, which never runs when a ported design owns the
    // screen — leaving a second, offset logo over the design's own.
    useEffect(() => { document.documentElement.classList.add("app-ready"); }, []);

    // The skip link in index.html targets `#main-content`, which is the
    // StandardShell's id. None of the ported designs use it — Aurora and
    // Carbon call their main `#main`, Structured `#routeMain` — so in skin
    // mode the link resolved to nothing and pressing it did exactly nothing.
    // Aurora and Carbon also ship their own skip anchor, which put two of
    // them in the tab order.
    //
    // The designs render behind Suspense, so the main element does not exist
    // when this effect first runs. Poll on a timer rather than rAF: a tab
    // opened in the background gets no animation frames at all, and the skip
    // link has to be correct by the time that tab is brought forward.
    useEffect(() => {
        if (skin === "signature") return;
        let tries = 0;
        let timer = 0;
        const settle = () => {
            const prepaint = document.getElementById("prepaint-skip");
            if (!prepaint) return;
            const own = [...document.querySelectorAll<HTMLAnchorElement>('a[href^="#"]')]
                .find((a) => a !== prepaint && /skip to/i.test(a.textContent ?? ""));
            if (own) { prepaint.remove(); return; }      // the design brought its own
            const main = document.querySelector("main[id]");
            if (main) { prepaint.setAttribute("href", `#${main.id}`); return; }
            if (++tries < 40) timer = window.setTimeout(settle, 50);
        };
        settle();
        return () => window.clearTimeout(timer);
    }, [skin]);

    // ?skin=<id> makes a theme directly linkable, which is the only way to
    // reach one without clicking through the dock.
    useEffect(() => {
        const wanted = new URLSearchParams(window.location.search).get("skin");
        if (isSkinId(wanted) && wanted !== skin) setSkin(wanted);
    }, [skin, setSkin]);

    if (skin === "signature") return null;
    const App = APPS[skin];
    if (!App) return null;
    return (
        <>
            <Suspense fallback={<div style={{ minHeight: "100dvh", background: "var(--bg0, var(--pt-bg, #04080B))" }} />}>
                <App />
            </Suspense>
            <SkinDock />
        </>
    );
}
