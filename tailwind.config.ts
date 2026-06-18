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
      },
      boxShadow: {
        soft: "0 18px 50px rgba(30, 49, 42, 0.08)",
      },
    },
  },
  plugins: [],
};

export default config;
