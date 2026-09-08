// Browser entry point: mounts <App /> into #root (see index.html), and
// registers the service worker that makes the installed app open instantly.
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
import App from "./App";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

/*
 * Register the service worker (public/sw.js).
 *
 * Production only. In development Vite serves modules unbundled and a worker
 * caching them is a guaranteed way to spend an afternoon debugging a stale
 * file that no longer exists on disk.
 *
 * Registration waits for `load` so it never competes with the first paint for
 * bandwidth, and the whole thing is best-effort: a browser with workers
 * disabled, or a page served without a secure context, simply plays online
 * like any other website. Nothing above this line depends on it.
 */
if (import.meta.env.PROD && "serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    // Scope is the deployed base ("/clean-sweep/" on Pages, "/" elsewhere),
    // and a worker may only control URLs at or below its own path.
    const base = import.meta.env.BASE_URL;
    void navigator.serviceWorker.register(`${base}sw.js`, { scope: base }).catch(() => {
      // Not fatal, and not worth a console error in a player's face: the app
      // works without it, just without the instant open.
    });
  });
}
