// Vite configuration for the Clean Sweep frontend.
//
// Sits at the root of `frontend/`. Wires up the React plugin, Tailwind v4
// (which needs no separate tailwind.config in v4: theme tokens live in
// src/index.css), the dev-server proxy that forwards `/api` and `/health`
// to the FastAPI backend, and the vitest test runner (jsdom environment).
/// <reference types="vitest/config" />
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

const BACKEND_URL = "http://localhost:8000";

// GitHub Pages serves a project site from a subdirectory, so the built asset
// URLs have to be prefixed with it. Only the Pages workflow sets this; dev,
// tests and a local `npm run build` all stay at the root, which is also what
// the backend serves the bundle under.
const BASE = process.env.PAGES_BASE ?? "/";

// Whether this build talks to the in-memory fixture adapter instead of a real
// backend. Read here as well as in src/api/index.ts because the answer decides
// whether ~177 kB of fixture catalogue is allowed into the bundle.
const IS_MOCK = process.env.VITE_API_MOCK === "true";

export default defineConfig({
  base: BASE,
  plugins: [react(), tailwindcss()],
  build: {
    rollupOptions: {
      treeshake: {
        /**
         * Let the fixture adapter be dropped from a production build.
         *
         * `src/api/index.ts` picks between the mock and the HTTP client on a
         * build-time constant, so in a real-backend build the mock branch is
         * unreachable. Rollup still kept the module, because it is 2,000
         * lines of top-level table building (`Object.fromEntries`, an IIFE
         * for the derived actor table) and it cannot prove those have no side
         * effects. So it shipped ~177 kB of fixture films to every phone that
         * would never look at them.
         *
         * They genuinely have none: the module defines data and functions and
         * touches nothing outside itself. Saying so here is an assertion
         * about this file, not a blanket setting, which is why it names the
         * two modules rather than turning side-effect detection off.
         *
         * In a mock build the same modules are the ones actually in use, so
         * the exclusion is conditional and they are left alone.
         */
        moduleSideEffects: (id) =>
          IS_MOCK || !/[\\/]src[\\/]api[\\/]mock(Catalog)?\.ts$/.test(id),
      },
    },
  },
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
