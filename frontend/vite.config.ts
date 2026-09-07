// Vite configuration for the Clean Sweep frontend.
//
// Sits at the root of `frontend/`. Wires up the React plugin, Tailwind v4
// (which needs no separate tailwind.config in v4 — theme tokens live in
// src/index.css), the dev-server proxy that forwards `/api` and `/health`
// to the FastAPI backend, and the vitest test runner (jsdom environment).
/// <reference types="vitest/config" />
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

const BACKEND_URL = "http://localhost:8000";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 5173,
    // The backend owns everything under /api plus the /health probe. Proxying
    // keeps the browser on a single origin so no CORS setup is needed in dev.
    proxy: {
      "/api": { target: BACKEND_URL, changeOrigin: true },
      "/health": { target: BACKEND_URL, changeOrigin: true },
    },
  },
  test: {
    environment: "jsdom",
    globals: false,
    setupFiles: ["./src/test/setup.ts"],
    include: ["src/**/*.test.{ts,tsx}"],
    css: false,
  },
});
