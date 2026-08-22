import { useEffect } from "react";

/** Takes over from the static anchor in index.html, which exists only so the
 *  skip link works before React mounts. Both in the DOM at once would make a
 *  keyboard user Tab through the same affordance twice, so this retires it. */
export function SkipLink() {
    useEffect(() => { document.getElementById("prepaint-skip")?.remove(); }, []);
    return (
        <a
            href="#main-content"
            className="sr-only focus:not-sr-only focus:fixed focus:top-3 focus:left-3 focus:z-[200] focus:rounded-lg focus:bg-primary focus:px-4 focus:py-2 focus:text-primary-foreground focus:font-medium focus:shadow-lg"
        >
            Skip to main content
        </a>
    );
}
