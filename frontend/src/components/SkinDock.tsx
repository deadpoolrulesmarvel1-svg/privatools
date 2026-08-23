import { useEffect, useRef, useState } from "react";
import { Check, Monitor, Moon, Palette, Sun, X } from "lucide-react";
import { useSkin } from "@/hooks/useSkin";
import { SKIN_LIST } from "@/lib/skins";
import { readThemeChoice, setThemeChoice, type ThemeChoice } from "@/lib/skinTheme";

/**
 * Floating theme picker for the ported design themes.
 *
 * Each imported design is a complete application that owns the whole screen and
 * has no concept of the others, so without this there is no way back out of one
 * except clearing localStorage. It is deliberately the smallest thing that can
 * work — a 34px puck in the corner — because everything around it is meant to
 * match the source design pixel for pixel.
 *
 * Its own styling is self-contained and does not read the skin's variables, so
 * it looks the same in all three and cannot be restyled by a design's CSS.
 */
/**
 * Carbon and Structured shipped with no light/dark control of their own, so
 * choosing light in those designs was impossible — not unsupported, just
 * unreachable. Putting it here covers every design at once, including any
 * added later, and cannot be restyled by a design's CSS.
 */
/**
 * How far to lift the dock so it clears a design's bottom bar.
 *
 * All three ported designs grow a fixed tab bar on narrow viewports, and the
 * dock sat on top of it — a 34px puck covering a navigation item, which is a
 * worse trade than it sounds because the bar is the only navigation at that
 * width. Measured rather than hardcoded: the three bars are different heights,
 * and one of them is not there at all on desktop.
 */
function useBottomBarClearance(): number {
    const [clearance, setClearance] = useState(0);

    useEffect(() => {
        const measure = () => {
            let tallest = 0;
            for (const el of Array.from(document.querySelectorAll<HTMLElement>("body *"))) {
                if (getComputedStyle(el).position !== "fixed") continue;
                const r = el.getBoundingClientRect();
                const pinnedToBottom = Math.abs(r.bottom - window.innerHeight) < 4;
                const fullWidth = r.width > window.innerWidth * 0.8;
                // Ignore the dock itself, and anything too small to be a bar.
                if (pinnedToBottom && fullWidth && r.height > 40 && r.height < 160) {
                    tallest = Math.max(tallest, r.height);
                }
            }
            setClearance(tallest ? Math.round(tallest) + 10 : 0);
        };
        measure();
        window.addEventListener("resize", measure);
        // The bars appear and disappear with route and width, so re-measure
        // when the tree changes rather than only on resize.
        const mo = new MutationObserver(measure);
        mo.observe(document.body, { childList: true, subtree: true });
        return () => { window.removeEventListener("resize", measure); mo.disconnect(); };
    }, []);

    return clearance;
}

const THEME_CHOICES: ReadonlyArray<{ id: ThemeChoice; label: string; Icon: typeof Sun }> = [
    { id: "system", label: "Auto", Icon: Monitor },
    { id: "light", label: "Light", Icon: Sun },
    { id: "dark", label: "Dark", Icon: Moon },
];

export function SkinDock() {
    const { skin, setSkin } = useSkin();
    const [open, setOpen] = useState(false);
    const [theme, setTheme] = useState<ThemeChoice>(() => readThemeChoice(skin));
    const bottomClearance = useBottomBarClearance();

    // The preference is per design, so re-read it when the design changes —
    // otherwise the row shows the previous skin's choice.
    useEffect(() => { setTheme(readThemeChoice(skin)); }, [skin]);
    const ref = useRef<HTMLDivElement>(null);
    const btnRef = useRef<HTMLButtonElement>(null);

    useEffect(() => {
        if (!open) return;
        const onDown = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
        const onKey = (e: KeyboardEvent) => {
            if (e.key === "Escape") { e.stopPropagation(); setOpen(false); btnRef.current?.focus(); }
        };
        document.addEventListener("mousedown", onDown);
        document.addEventListener("keydown", onKey, true);
        return () => {
            document.removeEventListener("mousedown", onDown);
            document.removeEventListener("keydown", onKey, true);
        };
    }, [open]);

    const active = SKIN_LIST.find((s) => s.id === skin) ?? SKIN_LIST[0];

    return (
        <div
            ref={ref}
            style={{
                position: "fixed", right: 14, bottom: 14 + bottomClearance, zIndex: 2147483000,
                fontFamily: "system-ui, -apple-system, sans-serif", colorScheme: "dark",
            }}
        >
            {open && (
                <div
                    role="menu"
                    aria-label="Appearance"
                    style={{
                        position: "absolute", right: 0, bottom: 42, width: 268,
                        background: "#12161a", color: "#e9eef0",
                        border: "1px solid rgba(255,255,255,.14)", borderRadius: 12,
                        padding: 6, boxShadow: "0 18px 50px -18px rgba(0,0,0,.85)",
                    }}
                >
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "4px 6px 6px" }}>
                        <span style={{ fontSize: 11, letterSpacing: ".08em", textTransform: "uppercase", opacity: .6 }}>
                            Appearance
                        </span>
                        <button
                            onClick={() => { setOpen(false); btnRef.current?.focus(); }}
                            aria-label="Close"
                            style={{ background: "none", border: "none", color: "inherit", cursor: "pointer", opacity: .6, padding: 2 }}
                        >
                            <X size={13} />
                        </button>
                    </div>
                    <div
                        role="group"
                        aria-label="Light or dark"
                        style={{ display: "flex", gap: 4, padding: "0 6px 8px" }}
                    >
                        {THEME_CHOICES.map(({ id, label, Icon }) => {
                            const on = theme === id;
                            return (
                                <button
                                    key={id}
                                    type="button"
                                    aria-pressed={on}
                                    onClick={() => { setThemeChoice(skin, id); setTheme(id); }}
                                    title={label}
                                    style={{
                                        flex: 1, display: "flex", alignItems: "center", justifyContent: "center",
                                        gap: 5, minHeight: 30, borderRadius: 7, cursor: "pointer",
                                        fontSize: 11, color: "inherit",
                                        background: on ? "rgba(255,255,255,.13)" : "transparent",
                                        border: "1px solid rgba(255,255,255,.10)",
                                    }}
                                >
                                    <Icon size={12} aria-hidden="true" />
                                    {label}
                                </button>
                            );
                        })}
                    </div>
                    <div style={{ padding: "0 6px 6px" }}>
                        <span style={{ fontSize: 11, letterSpacing: ".08em", textTransform: "uppercase", opacity: .6 }}>
                            Design
                        </span>
                    </div>
                    {SKIN_LIST.map((s) => {
                        const selected = s.id === skin;
                        return (
                            <button
                                key={s.id}
                                role="menuitemradio"
                                aria-checked={selected}
                                onClick={() => { setSkin(s.id); setOpen(false); }}
                                style={{
                                    display: "flex", gap: 9, width: "100%", textAlign: "left", cursor: "pointer",
                                    alignItems: "flex-start", padding: "7px 8px", borderRadius: 8,
                                    border: "none", color: "inherit",
                                    background: selected ? "rgba(255,255,255,.08)" : "transparent",
                                }}
                            >
                                <span aria-hidden="true" style={{ display: "flex", marginTop: 2 }}>
                                    <span style={{ width: 13, height: 13, borderRadius: 99, background: s.swatch[0] }} />
                                    <span style={{ width: 13, height: 13, borderRadius: 99, background: s.swatch[1], marginLeft: -5 }} />
                                </span>
                                <span style={{ minWidth: 0, flex: 1 }}>
                                    <span style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 12.5, fontWeight: 600 }}>
                                        {s.name}
                                        {selected && <Check size={11} aria-hidden="true" />}
                                    </span>
                                    <span style={{ display: "block", fontSize: 11, lineHeight: 1.35, opacity: .62, marginTop: 1 }}>
                                        {s.blurb}
                                    </span>
                                </span>
                            </button>
                        );
                    })}
                </div>
            )}

            <button
                ref={btnRef}
                type="button"
                onClick={() => setOpen((o) => !o)}
                aria-haspopup="menu"
                aria-expanded={open}
                aria-label={`Design theme: ${active.name}. Change theme`}
                title={`Theme: ${active.name}`}
                style={{
                    width: 34, height: 34, borderRadius: 99, cursor: "pointer",
                    display: "flex", alignItems: "center", justifyContent: "center",
                    background: "#12161a", color: "#e9eef0",
                    border: "1px solid rgba(255,255,255,.16)",
                    boxShadow: "0 6px 20px -8px rgba(0,0,0,.8)",
                }}
            >
                <Palette size={15} aria-hidden="true" />
            </button>
        </div>
    );
}
