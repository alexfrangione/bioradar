import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        bg: {
          page: "#08090a",
          app: "#0d1117",
          elev: "#161b22",
          elev2: "#1c2128",
          elev3: "#22272e",
        },
        border: {
          DEFAULT: "#30363d",
          subtle: "#21262d",
        },
        text: {
          DEFAULT: "#e6edf3",
          dim: "#8b949e",
          dimmer: "#6e7681",
        },
        accent: {
          green: "#3fb950",
          red: "#f85149",
          amber: "#d29922",
          blue: "#58a6ff",
          purple: "#bc8cff",
        },
      },
      fontFamily: {
        sans: ["Inter", "system-ui", "sans-serif"],
        mono: ["JetBrains Mono", "Consolas", "monospace"],
      },
    },
  },
  plugins: [],
};

export default config;
