/**
 * Source of truth for the three imported design themes.
 *
 * Values are transcribed verbatim from each Claude Design project's
 * `PrivaTools.dc.html`:
 *   aurora     — Obsidian Aurora        :root / [data-theme="light"] blocks
 *   carbon     — Carbon Glass           the `PAL` object (line ~2324)
 *   structured — Structured Privacy OS  :root / [data-theme="light"] blocks
 *
 * `build-skins.mjs` composites the translucent values over each theme's own
 * ground and emits HSL triplets, because the app's Tailwind wiring is
 * `hsl(var(--token))` and needs solid channels to apply alpha itself.
 *
 * Regenerate after editing:  node scripts/build-skins.mjs
 */

/** Twelve tool-family hues, shared across skins so a category keeps its
 *  identity when you switch theme. Only saturation/lightness are retuned
 *  per skin, to sit correctly on that skin's ground. */
export const CAT_HUES = {
  organize: 210, edit: 265, optimize: 175, security: 350,
  "to-pdf": 150, "from-pdf": 32, advanced: 240, image: 320,
  video: 12, developer: 190, archive: 45, document: 95,
};

export const SKINS = {
  daylight: {
    label: "Daylight",
    fonts: {
      display: "'Bricolage Grotesque', 'Manrope', system-ui, sans-serif",
      sans: "'Manrope', system-ui, -apple-system, sans-serif",
      mono: "'IBM Plex Mono', ui-monospace, SFMono-Regular, Menlo, monospace",
    },
    radius: "0.85rem",
    cat: { s: 52, l: { dark: 64, light: 40 } },
    dark: {
      ground: "#0F1113",
      core: {
        background: "#0F1113", foreground: "#EDEFF1",
        paper: "#171A1D", "paper-2": "#1D2124", "paper-3": "#23272B",
        card: "#171A1D", "card-foreground": "#EDEFF1", "card-tint": "#14171A",
        popover: "#1D2124", "popover-foreground": "#EDEFF1",
        primary: "#38D392", "primary-foreground": "#0C1410",
        secondary: "#23272B", "secondary-foreground": "#EDEFF1",
        muted: "#1D2124", "muted-foreground": "#A6ACB2",
        accent: "#D9A63F", "accent-bright": "#E3B34E", "accent-foreground": "#1A1408",
        copper: "#E0736B", success: "#38D392", destructive: "#E0736B",
        "destructive-foreground": "#0F1113",
        ring: "#38D392",
      },
      alpha: {
        border: ["rgba(230,238,240,.10)"], "border-strong": ["rgba(230,238,240,.22)"],
        input: ["rgba(230,238,240,.12)"],
        "accent-soft": ["rgba(217,166,63,.14)"], "copper-soft": ["rgba(224,115,107,.12)"],
        "success-soft": ["rgba(56,211,146,.13)"],
      },
      raw: {
        rail: "#14171A", scrim: "rgba(0,0,0,.7)",
        "hero-bg": "radial-gradient(120% 140% at 12% 0%, #171E22 0%, #0F1113 62%)",
        "panel-glass": "rgba(23,26,29,.85)",
        edge: "rgba(56,211,146,.32)", "edge-soft": "rgba(56,211,146,.18)",
        "edge-hot": "rgba(56,211,146,.55)",
        halo: "rgba(56,211,146,.12)", "halo-2": "rgba(224,115,107,.08)",
        sheen: "rgba(255,255,255,.15)", "grain-o": "0", "glass-blur": "12px",
        "glass-a": "rgba(56,211,146,.07)", "primary-glow": "rgba(56,211,146,.2)",
        "shadow-panel": "0 24px 56px -20px rgba(0,0,0,.7)",
      },
    },
    light: {
      ground: "#FAFAF8",
      core: {
        background: "#FAFAF8", foreground: "#15191B",
        paper: "#FFFFFF", "paper-2": "#F4F5F3", "paper-3": "#ECEEEA",
        card: "#FFFFFF", "card-foreground": "#15191B", "card-tint": "#F4F5F3",
        popover: "#FFFFFF", "popover-foreground": "#15191B",
        primary: "#0C7E56", "primary-foreground": "#FFFFFF",
        secondary: "#EDEFEC", "secondary-foreground": "#15191B",
        muted: "#F4F5F3", "muted-foreground": "#566066",
        accent: "#8F6200", "accent-bright": "#D9A63F", "accent-foreground": "#FFFFFF",
        copper: "#B4443C", success: "#0C7E56", destructive: "#B4443C",
        "destructive-foreground": "#FFFFFF",
        ring: "#0C7E56",
      },
      alpha: {
        border: ["rgba(21,25,27,.10)"], "border-strong": ["rgba(21,25,27,.22)"],
        input: ["rgba(21,25,27,.12)"],
        "accent-soft": ["rgba(143,98,0,.13)"], "copper-soft": ["rgba(180,68,60,.10)"],
        "success-soft": ["rgba(12,126,86,.12)"],
      },
      raw: {
        rail: "#F4F5F3", scrim: "rgba(10,12,13,.5)",
        "hero-bg": "radial-gradient(120% 140% at 12% 0%, #FFFFFF 0%, #FAFAF8 62%)",
        "panel-glass": "rgba(255,255,255,.85)",
        edge: "rgba(12,126,86,.3)", "edge-soft": "rgba(12,126,86,.16)",
        "edge-hot": "rgba(12,126,86,.5)",
        halo: "rgba(12,126,86,.10)", "halo-2": "rgba(180,68,60,.07)",
        sheen: "rgba(255,255,255,.6)", "grain-o": "0", "glass-blur": "10px",
        "glass-a": "rgba(12,126,86,.06)", "primary-glow": "rgba(12,126,86,.18)",
        "shadow-panel": "0 28px 64px -24px rgba(16,20,22,.2)",
      },
    },
  },
};
