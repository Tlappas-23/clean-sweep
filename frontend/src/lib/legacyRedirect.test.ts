/**
 * Tests for public/redirect.js, the shim that keeps already-shared links alive.
 *
 * Routing moved into the URL fragment so that GitHub Pages, which has no
 * rewrite rules, stops answering deep links with a 404 status while rendering
 * them correctly. That changed every URL, and links in messages and browser
 * histories still point at the old shape. Landing those on the home page with
 * the round silently lost would be a worse bug than the one being fixed.
 *
 * The script is plain ES5 in `public/`, so it is read off disk and evaluated
 * here rather than imported: testing the file that actually ships beats
 * testing a copy of its logic that could drift from it.
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";

const SOURCE = readFileSync(resolve(__dirname, "../../public/redirect.js"), "utf8");

/**
 * Run the shim against one URL and report where it sent the browser.
 *
 * `document.currentScript.src` is how the script finds its own base, so the
 * fake stands in for the <script> tag rather than hard-coding a root.
 */
function runAt(href: string, scriptSrc: string): string | null {
  const url = new URL(href);
  const replace = vi.fn();
  const sandbox = {
    window: {
      location: {
        pathname: url.pathname,
        search: url.search,
        hash: url.hash,
        replace,
      },
    },
    document: { currentScript: { src: scriptSrc } },
  };
  new Function("window", "document", SOURCE)(sandbox.window, sandbox.document);
  return replace.mock.calls.length ? (replace.mock.calls[0][0] as string) : null;
}

const PAGES = "https://tlappas-23.github.io/clean-sweep/redirect.js";

describe("legacy path redirect", () => {
  it("translates a deep link into its hash equivalent", () => {
    expect(runAt("https://tlappas-23.github.io/clean-sweep/chain", PAGES)).toBe(
      "/clean-sweep/#/chain",
    );
  });

  it("keeps the game id, so a shared round is not lost", () => {
    // The whole reason the shim exists: this URL is somebody's actual game.
    expect(
      runAt("https://tlappas-23.github.io/clean-sweep/chain/abc123", PAGES),
    ).toBe("/clean-sweep/#/chain/abc123");
  });

  it("carries the query string, so a daily link stays a daily link", () => {
    expect(
      runAt("https://tlappas-23.github.io/clean-sweep/grid?seed=2026-09-08", PAGES),
    ).toBe("/clean-sweep/#/grid?seed=2026-09-08");
  });

  it("does nothing at the site root, where there is nothing to translate", () => {
    expect(runAt("https://tlappas-23.github.io/clean-sweep/", PAGES)).toBeNull();
  });

  it("does nothing for index.html, which is the same page by another name", () => {
    expect(runAt("https://tlappas-23.github.io/clean-sweep/index.html", PAGES)).toBeNull();
  });

  it("leaves a URL that is already a hash route alone", () => {
    // Otherwise the shim would fight the router on every navigation and the
    // app would redirect itself in a loop.
    expect(runAt("https://tlappas-23.github.io/clean-sweep/#/chain", PAGES)).toBeNull();
  });

  it("works at a site root, not just in a project subdirectory", () => {
    // Local dev and a custom domain both serve from "/", and the shim reads
    // its own src rather than assuming the Pages path.
    expect(runAt("http://localhost:5173/chain", "http://localhost:5173/redirect.js")).toBe(
      "/#/chain",
    );
  });

  it("stays quiet if it is served from somewhere it does not recognise", () => {
    // Defensive: a mismatch should mean "do nothing", never "rewrite to a
    // guess", because a wrong guess sends a player somewhere real.
    expect(runAt("https://example.com/elsewhere/chain", PAGES)).toBeNull();
  });
});
