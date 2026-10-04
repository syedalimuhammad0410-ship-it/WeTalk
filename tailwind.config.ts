import type { Config } from "tailwindcss";

const withVar = (name: string) => `rgb(var(--${name}) / <alpha-value>)`;

export default {
  darkMode: ["class", '[data-theme="dark"]'],
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        bg: withVar("bg"),
        surface: withVar("surface"),
        subtle: withVar("subtle"),
        border: withVar("border"),
        fg: withVar("fg"),
        muted: withVar("muted"),
        faint: withVar("faint"),
        accent: withVar("accent"),
        "accent-fg": withVar("accent-fg"),
        success: withVar("success"),
        warning: withVar("warning"),
        danger: withVar("danger"),
        info: withVar("info"),
        sidebar: withVar("sidebar"),
        "sidebar-fg": withVar("sidebar-fg"),
        "sidebar-muted": withVar("sidebar-muted"),
        "sidebar-border": withVar("sidebar-border"),
        "sidebar-active": withVar("sidebar-active"),
      },
      fontFamily: {
        sans: ["var(--font-sans)", "ui-sans-serif", "system-ui", "sans-serif"],
        mono: ["var(--font-mono)", "ui-monospace", "SFMono-Regular", "monospace"],
      },
      borderRadius: { xl: "0.875rem", "2xl": "1.125rem" },
      boxShadow: {
        card: "0 1px 2px rgb(0 0 0 / 0.04), 0 1px 1px rgb(0 0 0 / 0.02)",
        pop: "0 12px 32px -8px rgb(0 0 0 / 0.18), 0 2px 6px rgb(0 0 0 / 0.06)",
      },
      keyframes: {
        "fade-in": { from: { opacity: "0", transform: "translateY(4px)" }, to: { opacity: "1", transform: "none" } },
        shimmer: { "100%": { transform: "translateX(100%)" } },
      },
      animation: { "fade-in": "fade-in 180ms ease-out", shimmer: "shimmer 1.6s infinite" },
    },
  },
  plugins: [],
} satisfies Config;
