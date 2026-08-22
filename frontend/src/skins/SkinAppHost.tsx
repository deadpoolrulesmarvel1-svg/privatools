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
