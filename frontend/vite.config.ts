import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// The dev server proxies /api and /health to the FastAPI backend on :8000,
// so the frontend can call same-origin paths in development.
// `base` is set for the GitHub Pages project subpath (/ai-scribe/) in the
// production build only; local dev stays at "/". The deploy workflow sets
// VITE_DEMO=1 so the app uses the bundled demo data instead of a backend.
export default defineConfig({
  base: process.env.VITE_DEMO === "1" ? "/ai-scribe/" : "/",
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      "/api": "http://localhost:8000",
      "/health": "http://localhost:8000",
    },
  },
});
