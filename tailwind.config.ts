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
        "app-bg": "#07110f",
        "app-surface": "#0f1c18",
        "app-elevated": "#14251f",
        "app-border": "#284039",
        "app-text": "#eef7f2",
        "app-muted": "#9fb3ab",
        "app-accent": "#5fc69d",
        "app-accent-soft": "#143b30",
        "app-success": "#65d6a4",
        "app-warning": "#f0c36a",
        "app-danger": "#f47f7f",
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
