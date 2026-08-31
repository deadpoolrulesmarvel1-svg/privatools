import { useEffect } from "react";
import DaylightApp from "./extensions/daylight";

/**
 * Mounts Daylight — the site's design.
 *
 * Daylight is a complete application: its own navigation, its own routing, its
 * own page compositions. It began as one of four selectable skins and is now
 * the only one, so it is imported eagerly — it *is* the first paint, and a
 * lazy chunk here would put a blank frame in front of every visitor.
 */
export function SkinAppHost() {
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

    return <DaylightApp />;
}
