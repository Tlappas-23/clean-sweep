// Vitest setup file, loaded once before every test file.
//
// Referenced by `test.setupFiles` in vite.config.ts. Three jobs:
//   1. register the jest-dom matchers (`toBeInTheDocument`, `toHaveTextContent`)
//      on vitest's `expect`;
//   2. unmount React trees between tests. Testing Library normally hooks its
//      own cleanup onto a global `afterEach`, but this project runs vitest with
//      `globals: false`, so the hook is wired up explicitly here;
//   3. give the tests a working `localStorage`, which the environment here
//      does not. See the block at the foot of this file: without it, every
//      storage-backed feature silently does nothing under test.

import { afterEach, beforeEach } from "vitest";
import { cleanup } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";

afterEach(() => {
  cleanup();
});

// jsdom implements neither of these, and both are read on mount by real
// components: `matchMedia` by useReducedMotion (SlotMachine, Results) and
// `scrollTo` by the Results page. Stub them to their "no reduced motion,
// no scrolling" defaults rather than guarding the app code for tests.
if (typeof window.matchMedia !== "function") {
  window.matchMedia = (query: string): MediaQueryList =>
    ({
      matches: false,
      media: query,
      onchange: null,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      dispatchEvent: () => false,
    }) as MediaQueryList;
}

window.scrollTo = () => {};

/*
 * A real `localStorage`.
 *
 * The environment supplies `window.localStorage` as a bare object with no
 * `setItem` on it, so every write in the app was throwing, being swallowed by
 * the try/catch that exists for private windows, and doing nothing. The
 * consequence was quiet and bad: the personal best and the round guard rails
 * are both storage-backed, and a test could exercise them, pass, and prove
 * nothing at all.
 *
 * The implementation is deliberately small and strict about types. Real
 * `Storage` coerces every value to a string, and code that round-trips JSON
 * only works because of it; a Map-backed fake that skipped the coercion would
 * let a bug through that production would not.
 *
 * Cleared before each test, so one test's state cannot decide another's
 * result.
 */
function createStorage(): Storage {
  let entries = new Map<string, string>();
  return {
    get length() {
      return entries.size;
    },
    key: (index: number) => [...entries.keys()][index] ?? null,
    getItem: (key: string) => entries.get(String(key)) ?? null,
    setItem: (key: string, value: string) => void entries.set(String(key), String(value)),
    removeItem: (key: string) => void entries.delete(String(key)),
    clear: () => void (entries = new Map()),
  } as Storage;
}

if (typeof window.localStorage?.setItem !== "function") {
  Object.defineProperty(window, "localStorage", {
    configurable: true,
    writable: true,
    value: createStorage(),
  });
}

beforeEach(() => {
  try {
    window.localStorage.clear();
  } catch {
    // A test that deliberately breaks storage restores it itself.
  }
});
