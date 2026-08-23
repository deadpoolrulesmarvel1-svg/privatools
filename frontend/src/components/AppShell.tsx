/**
 * AppShell — picks the layout shell for the active skin.
 *
 * A skin is a complete theme: palette, type pairing and chrome. The palette
 * side is pure CSS (src/styles/skins.css, applied as `data-skin` on <html>),
 * but the three imported designs also differ structurally — a labelled rail, a
 * sectioned glass rail, a dense category rail — so each gets its own shell.
 *
 * Everything below the shell is shared. Route content, and all 112 tool UIs
 * inside it, render identically in every skin because they consume tokens
 * rather than colours. Only the chrome changes.
 */
import { useSkin } from "@/hooks/useSkin";
import { SkinAppHost } from "@/skins/SkinAppHost";
import { StandardShell } from "./shells/StandardShell";

export function AppShell({ children }: { children: React.ReactNode }) {
    const { skin } = useSkin();

    // An imported design is a whole application, not a re-skin: it brings its
    // own navigation, routing and page compositions. So it replaces the screen
    // rather than wrapping our routes.
    if (skin !== "signature") return <SkinAppHost />;

    return <StandardShell>{children}</StandardShell>;
}
