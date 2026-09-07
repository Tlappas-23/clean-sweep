// Vitest setup file, loaded once before every test file.
//
// Referenced by `test.setupFiles` in vite.config.ts. Two jobs:
//   1. register the jest-dom matchers (`toBeInTheDocument`, `toHaveTextContent`)
//      on vitest's `expect`;
//   2. unmount React trees between tests. Testing Library normally hooks its
//      own cleanup onto a global `afterEach`, but this project runs vitest with
//      `globals: false`, so the hook is wired up explicitly here.

import { afterEach } from "vitest";
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
