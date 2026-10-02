/**
 * The skip link in index.html targets `#main-content`, a default that predates
 * Daylight. Once the design has mounted, point it at the app's own <main> and
 * move focus there on activation: a fragment is a page route in this app, so
 * following the href would navigate to a page that does not exist.
 *
 * Polls on a timer rather than rAF: a tab opened in the background gets no
 * animation frames at all, and the link has to be right by the time the tab is
 * fronted. Returns the cleanup.
 */
export function retargetSkipLink(doc: Document = document): () => void {
    let tries = 0;
    let timer = 0;
    let skipLink: HTMLElement | null = null;
    const skip = (event: MouseEvent) => {
        const main = doc.querySelector<HTMLElement>("main[id]");
        if (!main) return;
        event.preventDefault();
        main.focus({ preventScroll: true });
        main.scrollIntoView({ block: "start", behavior: "instant" });
    };
    const settle = () => {
        const prepaint = doc.getElementById("prepaint-skip");
        if (!prepaint) return;
        const main = doc.querySelector("main[id]");
        if (main) {
            prepaint.setAttribute("href", `#${main.id}`);
            skipLink = prepaint;
            prepaint.addEventListener("click", skip);
            return;
        }
        if (++tries < 40) timer = window.setTimeout(settle, 50);
    };
    settle();
    return () => {
        window.clearTimeout(timer);
        skipLink?.removeEventListener("click", skip);
    };
}
