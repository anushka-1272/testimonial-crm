import type { Config } from "tailwindcss";
import defaultTheme from "tailwindcss/defaultTheme";

const config: Config = {
  darkMode: "class",
  content: [
    "./pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        background: "var(--color-bg)",
        elevated: "var(--color-bg-elevated)",
        foreground: "var(--color-fg)",
        muted: "var(--color-fg-muted)",
        border: "var(--color-border)",
        "border-subtle": "var(--color-border-subtle)",
      },
      boxShadow: {
        card: "0 4px 16px var(--color-card-shadow)",
        segment: "0 2px 8px var(--color-segment-shadow)",
      },
      fontFamily: {
        sans: ["var(--font-inter)", ...defaultTheme.fontFamily.sans],
      },
    },
  },
  plugins: [],
};

export default config;
