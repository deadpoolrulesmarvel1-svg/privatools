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
  aurora: {
    label: "Obsidian Aurora",
    fonts: {
      display: "'Sora', 'Outfit', system-ui, sans-serif",
      sans: "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
      mono: "ui-monospace, SFMono-Regular, Menlo, monospace",
    },
    radius: "1rem",
    cat: { s: 74, l: { dark: 62, light: 42 } },
    dark: {
      ground: "#03090D",
      core: {
        background: "#03090D", foreground: "#EAF4F0",
        paper: "#0A1720", "paper-2": "#0E2029", "paper-3": "#132B34",
        card: "#0A1720", "card-foreground": "#EAF4F0", "card-tint": "#07141B",
        popover: "#0E2029", "popover-foreground": "#EAF4F0",
        primary: "#22D899", "primary-foreground": "#03090D",
        secondary: "#132B34", "secondary-foreground": "#EAF4F0",
        muted: "#0E2029", "muted-foreground": "#AAC1BC",
        accent: "#F2B138", "accent-bright": "#F2B138", "accent-foreground": "#03090D",
        copper: "#FF6B62", success: "#22D899", destructive: "#FF6B62",
        "destructive-foreground": "#03090D",
        ring: "#22D899",
      },
      alpha: {
        border: ["rgba(150,220,205,.13)"], "border-strong": ["rgba(150,220,205,.26)"],
        input: ["rgba(150,220,205,.13)"],
        "accent-soft": ["rgba(242,177,56,.13)"], "copper-soft": ["rgba(255,107,98,.13)"],
        "success-soft": ["rgba(34,216,153,.13)"],
      },
      raw: {
        rail: "#07141B", scrim: "rgba(2,6,9,.74)",
        "hero-bg": "radial-gradient(120% 140% at 12% 0%, #0A1E24 0%, #03090D 62%)",
        "panel-glass": "rgba(10,23,32,.72)",
        edge: "rgba(34,216,153,.32)", "edge-soft": "rgba(34,216,153,.18)",
        "edge-hot": "rgba(34,216,153,.55)",
        halo: "rgba(34,216,153,.14)", "halo-2": "rgba(117,104,244,.10)",
        sheen: "rgba(255,255,255,.28)", "grain-o": ".35", "glass-blur": "14px",
        "glass-a": "rgba(34,216,153,.08)", "primary-glow": "rgba(34,216,153,.22)",
        "shadow-panel": "0 20px 55px -24px rgba(0,0,0,.85)",
      },
    },
    light: {
      ground: "#F5F8F6",
      core: {
        background: "#F5F8F6", foreground: "#0A1A1F",
        paper: "#FFFFFF", "paper-2": "#F4F8F6", "paper-3": "#E9F1ED",
        card: "#FFFFFF", "card-foreground": "#0A1A1F", "card-tint": "#EAF3EF",
        popover: "#FFFFFF", "popover-foreground": "#0A1A1F",
        // 4.26:1 with white in the source; darkened to clear AA on filled buttons.
        primary: "#0A875B", "primary-foreground": "#FFFFFF",
        secondary: "#E9F1ED", "secondary-foreground": "#0A1A1F",
        muted: "#F4F8F6", "muted-foreground": "#47605C",
        accent: "#8A5D00", "accent-bright": "#F2B138", "accent-foreground": "#FFFFFF",
        copper: "#BF3A30", success: "#0B6E4B", destructive: "#BF3A30",
        "destructive-foreground": "#FFFFFF",
        ring: "#0B8C5F",
      },
      alpha: {
        border: ["rgba(9,40,45,.12)"], "border-strong": ["rgba(9,40,45,.24)"],
        input: ["rgba(9,40,45,.12)"],
        "accent-soft": ["rgba(242,177,56,.16)"], "copper-soft": ["rgba(191,58,48,.10)"],
        "success-soft": ["rgba(11,140,95,.10)"],
      },
      raw: {
        rail: "#EAF3EF", scrim: "rgba(9,26,31,.42)",
        "hero-bg": "radial-gradient(120% 140% at 12% 0%, #FFFFFF 0%, #EAF3EF 68%)",
        "panel-glass": "rgba(255,255,255,.78)",
        edge: "rgba(11,140,95,.30)", "edge-soft": "rgba(11,140,95,.16)",
        "edge-hot": "rgba(11,140,95,.5)",
        halo: "rgba(11,140,95,.10)", "halo-2": "rgba(117,104,244,.08)",
        sheen: "rgba(255,255,255,.75)", "grain-o": ".18", "glass-blur": "14px",
        "glass-a": "rgba(11,140,95,.07)", "primary-glow": "rgba(11,140,95,.16)",
        "shadow-panel": "0 18px 40px -26px rgba(9,40,45,.35)",
      },
    },
  },

  carbon: {
    label: "Carbon Glass",
    fonts: {
      display: "'Manrope', 'Helvetica Neue', Helvetica, Arial, sans-serif",
      sans: "'Manrope', 'Helvetica Neue', Helvetica, Arial, sans-serif",
      mono: "'IBM Plex Mono', ui-monospace, monospace",
    },
    radius: "0.875rem",
    cat: { s: 70, l: { dark: 64, light: 40 } },
    dark: {
      ground: "#04080B",
      core: {
        background: "#04080B", foreground: "#E8F1F2",
        paper: "#0B141A", "paper-2": "#0D171D", "paper-3": "#071016",
        card: "#0B141A", "card-foreground": "#E8F1F2", "card-tint": "#071016",
        popover: "#0D171D", "popover-foreground": "#E8F1F2",
        primary: "#4FE1DE", "primary-foreground": "#04191B",
        secondary: "#0D171D", "secondary-foreground": "#E8F1F2",
        muted: "#071016", "muted-foreground": "#9FB3B8",
        accent: "#F0B45E", "accent-bright": "#F0B45E", "accent-foreground": "#04191B",
        copper: "#FF7A6B", success: "#26C8BA", destructive: "#FF7A6B",
        "destructive-foreground": "#04191B",
        ring: "#4FE1DE",
      },
      alpha: {
        border: ["rgba(255,255,255,.085)"], "border-strong": ["rgba(255,255,255,.15)"],
        input: ["rgba(255,255,255,.085)"],
        "accent-soft": ["rgba(240,180,94,.13)"], "copper-soft": ["rgba(255,122,107,.13)"],
        "success-soft": ["rgba(38,200,186,.14)"],
      },
      raw: {
        rail: "#060D12", scrim: "rgba(2,6,9,.72)",
        "hero-bg": "linear-gradient(120deg,#071016 0%,#04080B 58%,#0A1A20 100%)",
        "panel-glass": "rgba(13,23,29,.62)",
        edge: "rgba(79,225,222,.32)", "edge-soft": "rgba(79,225,222,.2)",
        "edge-hot": "rgba(79,225,222,.55)",
        halo: "rgba(79,225,222,.13)", "halo-2": "rgba(146,124,255,.08)",
        sheen: "rgba(255,255,255,.3)", "grain-o": ".05", "glass-blur": "18px",
        "glass-a": "rgba(79,225,222,.13)", "primary-glow": "rgba(79,225,222,.22)",
        "shadow-panel": "0 24px 60px -28px rgba(0,0,0,.9)",
        lav: "#927CFF", "lav-bg": "rgba(146,124,255,.14)",
      },
    },
    light: {
      ground: "#F5F3EE",
      core: {
        background: "#F5F3EE", foreground: "#172024",
        paper: "#FCFDFB", "paper-2": "#FBFCFA", "paper-3": "#E9EFEE",
        card: "#FCFDFB", "card-foreground": "#172024", "card-tint": "#FBFCFA",
        popover: "#FCFDFB", "popover-foreground": "#172024",
        // Source aqua #0F9C97 was 3.37:1 with white. Darkened to 4.5:1 — sits
        // between the design's own `aqua` fill and its `aquaTxt` (#0B7C79).
        primary: "#0C847F", "primary-foreground": "#FFFFFF",
        secondary: "#E9EFEE", "secondary-foreground": "#172024",
        muted: "#E9EFEE", "muted-foreground": "#4E5F65",
        accent: "#996410", "accent-bright": "#D9922B", "accent-foreground": "#FFFFFF", // 4.46 -> 4.53:1

        copper: "#BE3F35", success: "#0F8A80", destructive: "#BE3F35",
        "destructive-foreground": "#FFFFFF",
        ring: "#0F9C97",
      },
      alpha: {
        border: ["rgba(23,32,36,.11)"], "border-strong": ["rgba(23,32,36,.19)"],
        input: ["rgba(23,32,36,.11)"],
        "accent-soft": ["rgba(154,101,16,.11)"], "copper-soft": ["rgba(190,63,53,.10)"],
        "success-soft": ["rgba(15,138,128,.12)"],
      },
      raw: {
        rail: "#FBFCFA", scrim: "rgba(23,32,36,.4)",
        "hero-bg": "linear-gradient(120deg,#FBFCFA 0%,#EFF3F1 52%,#E4EDEB 100%)",
        "panel-glass": "rgba(233,239,238,.58)",
        edge: "rgba(15,156,151,.34)", "edge-soft": "rgba(15,156,151,.22)",
        "edge-hot": "rgba(15,156,151,.5)",
        halo: "rgba(38,200,186,.12)", "halo-2": "rgba(146,124,255,.08)",
        sheen: "rgba(255,255,255,.75)", "grain-o": ".035", "glass-blur": "18px",
        "glass-a": "rgba(15,156,151,.11)", "primary-glow": "rgba(15,156,151,.18)",
        "shadow-panel": "0 20px 44px -30px rgba(23,32,36,.4)",
        lav: "#5B47C4", "lav-bg": "rgba(91,71,196,.11)",
      },
    },
  },

  structured: {
    label: "Structured Privacy OS",
    fonts: {
      display: "'Geist', 'Outfit', system-ui, sans-serif",
      sans: "'Geist', 'Outfit', system-ui, sans-serif",
      mono: "'Geist Mono', ui-monospace, monospace",
    },
    radius: "0.5rem",
    cat: { s: 66, l: { dark: 60, light: 40 } },
    dark: {
      ground: "#031019",
      core: {
        background: "#031019", foreground: "#E9F4F1",
        paper: "#0A2229", "paper-2": "#0C2A32", "paper-3": "#0E3138",
        card: "#0A2229", "card-foreground": "#E9F4F1", "card-tint": "#061923",
        popover: "#0C2A32", "popover-foreground": "#E9F4F1",
        primary: "#20D497", "primary-foreground": "#031019",
        secondary: "#0E3138", "secondary-foreground": "#E9F4F1",
        muted: "#061923", "muted-foreground": "#9BB4B2",
        accent: "#F2B44C", "accent-bright": "#F2B44C", "accent-foreground": "#031019",
        copper: "#F2685C", success: "#20D497", destructive: "#F2685C",
        "destructive-foreground": "#031019",
        ring: "#20D497",
      },
      alpha: {
        border: ["rgba(160,220,215,.13)"], "border-strong": ["rgba(160,220,215,.24)"],
        input: ["rgba(160,220,215,.13)"],
        "accent-soft": ["rgba(242,180,76,.12)"], "copper-soft": ["rgba(242,104,92,.12)"],
        "success-soft": ["rgba(32,212,151,.11)"],
      },
      raw: {
        rail: "#061923", scrim: "rgba(3,16,25,.76)",
        "hero-bg": "linear-gradient(180deg,#061923 0%,#031019 100%)",
        "panel-glass": "#0A2229",
        edge: "rgba(32,212,151,.34)", "edge-soft": "rgba(32,212,151,.18)",
        "edge-hot": "rgba(32,212,151,.55)",
        halo: "rgba(32,212,151,.10)", "halo-2": "rgba(90,150,247,.08)",
        sheen: "rgba(255,255,255,.2)", "grain-o": "0", "glass-blur": "0px",
        "glass-a": "rgba(32,212,151,.10)", "primary-glow": "transparent",
        "shadow-panel": "0 1px 2px rgba(0,0,0,.45)",
        blue: "#5A96F7", "blue-bg": "rgba(90,150,247,.12)",
      },
    },
    light: {
      ground: "#F7FAF8",
      core: {
        background: "#F7FAF8", foreground: "#14211F",
        paper: "#FFFFFF", "paper-2": "#F3F7F5", "paper-3": "#EAF2EE",
        card: "#FFFFFF", "card-foreground": "#14211F", "card-tint": "#EDF5F1",
        popover: "#FFFFFF", "popover-foreground": "#14211F",
        // 4.09:1 with white in the source; darkened to clear AA on filled buttons.
        primary: "#0A8760", "primary-foreground": "#FFFFFF",
        secondary: "#EAF2EE", "secondary-foreground": "#14211F",
        muted: "#F3F7F5", "muted-foreground": "#4D6360",
        accent: "#96620F", "accent-bright": "#D8952A", "accent-foreground": "#FFFFFF",
        copper: "#BE4438", success: "#0B8F66", destructive: "#BE4438",
        "destructive-foreground": "#FFFFFF",
        ring: "#0B8F66",
      },
      alpha: {
        border: ["rgba(16,54,50,.13)"], "border-strong": ["rgba(16,54,50,.22)"],
        input: ["rgba(16,54,50,.13)"],
        "accent-soft": ["rgba(150,98,15,.09)"], "copper-soft": ["rgba(190,68,56,.09)"],
        "success-soft": ["rgba(11,143,102,.08)"],
      },
      raw: {
        rail: "#EDF5F1", scrim: "rgba(20,33,31,.44)",
        "hero-bg": "linear-gradient(180deg,#EDF5F1 0%,#F7FAF8 100%)",
        "panel-glass": "#FFFFFF",
        edge: "rgba(11,143,102,.30)", "edge-soft": "rgba(11,143,102,.16)",
        "edge-hot": "rgba(11,143,102,.5)",
        halo: "rgba(11,143,102,.08)", "halo-2": "rgba(47,99,199,.06)",
        sheen: "rgba(255,255,255,.8)", "grain-o": "0", "glass-blur": "0px",
        "glass-a": "rgba(11,143,102,.08)", "primary-glow": "transparent",
        "shadow-panel": "0 1px 2px rgba(16,54,50,.07)",
        blue: "#2F63C7", "blue-bg": "rgba(47,99,199,.09)",
      },
    },
  },
};
