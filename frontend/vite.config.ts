import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// The dev server proxies /api and /health to the FastAPI backend on :8000,
// so the frontend can call same-origin paths in development.
// `base` defaults to "/" (local dev, and Netlify which serves at the domain
// root). Set VITE_BASE to deploy under a subpath, e.g. VITE_BASE=/ai-scribe/
// for a GitHub Pages project site. VITE_DEMO=1 makes the app use bundled demo
// data instead of a backend.
export default defineConfig({
  base: process.env.VITE_BASE || "/",
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      "/api": "http://localhost:8000",
      "/health": "http://localhost:8000",
    },
  },
});
