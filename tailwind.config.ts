import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        ink: "#13201c",
        muted: "#5d6b66",
        line: "#dde6e1",
        canvas: "#f7faf8",
        accent: "#176b57",
        "accent-soft": "#e4f3ec",
        warning: "#9a5b15",
        danger: "#9f2f2f",
        "app-bg": "#090b10",
        "app-surface": "#111821",
        "app-elevated": "#182231",
        "app-border": "#2a3545",
        "app-text": "#f1f5f9",
        "app-muted": "#a8b3c2",
        "app-accent": "#93c5fd",
        "app-accent-soft": "#17253a",
        "app-accent-hover": "#bfdbfe",
        "app-success": "#86efac",
        "app-success-soft": "#12301f",
        "app-warning": "#fbbf24",
        "app-warning-soft": "#3a2d12",
        "app-danger": "#fca5a5",
        "app-danger-soft": "#3a171a",
      },
      boxShadow: {
        soft: "0 18px 50px rgba(30, 49, 42, 0.08)",
        "app-soft": "0 18px 50px rgba(0, 0, 0, 0.28)",
      },
    },
  },
  plugins: [],
};

export default config;
