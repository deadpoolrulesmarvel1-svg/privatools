import type { Config } from "tailwindcss";
import plugin from "tailwindcss/plugin";

export default {
  darkMode: ["class"],
  content: ["./pages/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}", "./app/**/*.{ts,tsx}", "./src/**/*.{ts,tsx}"],
  prefix: "",
  theme: {
    container: {
      center: true,
      padding: "2rem",
      screens: {
        "2xl": "1400px",
      },
    },
    extend: {
      fontFamily: {
        display: ["Bricolage Grotesque", "Outfit", "system-ui", "sans-serif"],
        heading: ["Bricolage Grotesque", "Outfit", "system-ui", "sans-serif"],
        serif:   ["Bricolage Grotesque", "Outfit", "system-ui", "sans-serif"],
        body:    ["Outfit", "system-ui", "sans-serif"],
        sans:    ["Outfit", "system-ui", "sans-serif"],
        mono:    ["DM Mono", "SF Mono", "Menlo", "monospace"],
      },
      colors: {
        border: "hsl(var(--border))",
        "border-strong": "hsl(var(--border-strong))",
        input: "hsl(var(--input))",
        ring: "hsl(var(--ring))",
        background: "hsl(var(--background))",
        foreground: "hsl(var(--foreground))",
        paper:    "hsl(var(--paper))",
        "paper-2": "hsl(var(--paper-2))",
        "paper-3": "hsl(var(--paper-3))",
        primary: {
          DEFAULT: "hsl(var(--primary))",
          foreground: "hsl(var(--primary-foreground))",
        },
        secondary: {
          DEFAULT: "hsl(var(--secondary))",
          foreground: "hsl(var(--secondary-foreground))",
        },
        destructive: {
          DEFAULT: "hsl(var(--destructive))",
          foreground: "hsl(var(--destructive-foreground))",
        },
        muted: {
          DEFAULT: "hsl(var(--muted))",
          foreground: "hsl(var(--muted-foreground))",
        },
        accent: {
          DEFAULT: "hsl(var(--accent))",
          foreground: "hsl(var(--accent-foreground))",
          soft: "hsl(var(--accent-soft))",
        },
        cat: {
          organize:  "hsl(var(--cat-organize))",
          edit:      "hsl(var(--cat-edit))",
          optimize:  "hsl(var(--cat-optimize))",
          security:  "hsl(var(--cat-security))",
          "to-pdf":  "hsl(var(--cat-to-pdf))",
          "from-pdf": "hsl(var(--cat-from-pdf))",
          advanced:  "hsl(var(--cat-advanced))",
          image:     "hsl(var(--cat-image))",
          video:     "hsl(var(--cat-video))",
          developer: "hsl(var(--cat-developer))",
          archive:   "hsl(var(--cat-archive))",
          document:  "hsl(var(--cat-document))",
        },
        success: {
          DEFAULT: "hsl(var(--success))",
          soft: "hsl(var(--success-soft))",
        },
        copper: {
          DEFAULT: "hsl(var(--copper))",
          soft: "hsl(var(--copper-soft))",
        },
        popover: {
          DEFAULT: "hsl(var(--popover))",
          foreground: "hsl(var(--popover-foreground))",
        },
        card: {
          DEFAULT: "hsl(var(--card))",
          foreground: "hsl(var(--card-foreground))",
        },
        "card-tint": "hsl(var(--card-tint))",
        sidebar: {
          DEFAULT: "hsl(var(--sidebar-background))",
          foreground: "hsl(var(--sidebar-foreground))",
          primary: "hsl(var(--sidebar-primary))",
          "primary-foreground": "hsl(var(--sidebar-primary-foreground))",
          accent: "hsl(var(--sidebar-accent))",
          "accent-foreground": "hsl(var(--sidebar-accent-foreground))",
          border: "hsl(var(--sidebar-border))",
          ring: "hsl(var(--sidebar-ring))",
        },
      },
      borderRadius: {
        // Properly graduated rather than three near-identical values: soft on
        // containers, tighter on the controls inside them.
        lg: "var(--radius)",                 /* 20px — cards, panels */
        md: "calc(var(--radius) - 0.375rem)", /* 14px — inputs, buttons */
        sm: "calc(var(--radius) - 0.625rem)", /* 10px — chips, small tags */
      },
      keyframes: {
        "accordion-down": {
          from: { height: "0" },
          to: { height: "var(--radix-accordion-content-height)" },
        },
        "accordion-up": {
          from: { height: "var(--radix-accordion-content-height)" },
          to: { height: "0" },
        },
        "fade-up": {
          from: { opacity: "0", transform: "translateY(16px)" },
          to: { opacity: "1", transform: "translateY(0)" },
        },
        "fade-in": {
          from: { opacity: "0" },
          to: { opacity: "1" },
        },
        "scale-in": {
          from: { opacity: "0", transform: "scale(0.96)" },
          to: { opacity: "1", transform: "scale(1)" },
        },
        "slide-down": {
          from: { opacity: "0", transform: "translateY(-8px)" },
          to: { opacity: "1", transform: "translateY(0)" },
        },
      },
      animation: {
        "fade-up": "fade-up 0.6s ease-out forwards",
        "fade-in": "fade-in 0.4s ease-out forwards",
        "scale-in": "scale-in 0.25s ease-out forwards",
        "slide-down": "slide-down 0.3s ease-out forwards",
        "slide-in-right": "slide-in-right 0.5s ease-out forwards",
        "slide-in-left": "slide-in-left 0.5s ease-out forwards",
        "pulse-border": "pulse-border 2.5s ease-in-out infinite",
        "shimmer": "shimmer 2s ease-in-out infinite",
      },
    },
  },
  plugins: [
    require("tailwindcss-animate"),
    plugin(({ addVariant }) => {
      addVariant("coarse", "@media (pointer: coarse)");
    }),
  ],
} satisfies Config;
