// Smoke test for the whole app (src/App.tsx) against the mock adapter.
//
// Everything else in the suite tests a unit; this one boots the real router,
// the real providers and the real pages the way `VITE_API_MOCK=true npm run
// dev` does, and walks from the lobby into a game. It is the cheapest way to
// catch the mistakes that only appear once the pieces are assembled: a missing
// provider, a route that throws on mount, a page that renders nothing.
//
// VITE_API_MOCK has to be stubbed *before* src/api/index.ts is evaluated,
// which is why App is imported dynamically inside the test.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

describe("App (mock adapter)", () => {
  /** React and the router report real problems through console.error. */
  let consoleError: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    // BrowserRouter reads the real jsdom URL, which the previous test left
    // pointing at a game — every test starts at the lobby.
    window.history.pushState({}, "", "/");
    vi.resetModules();
    vi.stubEnv("VITE_API_MOCK", "true");
    consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    consoleError.mockRestore();
    stubMatchMedia(false);
  });

  it("renders the lobby and starts a classic game", async () => {
    const { default: App } = await import("./App");
    render(<App />);

    // Home: hero plus the three ways in.
    expect(screen.getByRole("heading", { name: "Clean Sweep", level: 1 })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "How to play" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Play Cinephile" })).toBeInTheDocument();

    // Starting a game POSTs to the mock and routes to /play/:gameId.
    fireEvent.click(screen.getByRole("button", { name: "Play Classic" }));

    await waitFor(() => {
      expect(screen.getByRole("heading", { name: "Draft your ballot" })).toBeInTheDocument();
    });

    // Play: the machine is up, the ballot is empty, nothing has been drafted.
    expect(screen.getByRole("region", { name: "Slot machine" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /spin/i })).toBeEnabled();
    expect(screen.getByText("0 of 6 locked")).toBeInTheDocument();

    // No React errors, no thrown renders. Act warnings are ignored: the mock's
    // artificial latency means a response can land after the assertions.
    expect(realErrors(consoleError)).toEqual([]);
  });

  it("plays six rounds through to the results page", async () => {
    // Reduced motion makes the reels settle on the next tick instead of
    // waiting on an `animationend` event jsdom will never fire.
    stubMatchMedia(true);

    const { default: App } = await import("./App");
    render(<App />);

    fireEvent.click(screen.getByRole("button", { name: "Play Classic" }));
    await screen.findByRole("heading", { name: "Draft your ballot" });

    for (let round = 1; round <= 6; round++) {
      fireEvent.click(screen.getByRole("button", { name: /spin/i }));

      // Cards are `aria-pressed="false"` until one is highlighted.
      const cards = await waitFor(() => {
        const found = screen.getAllByRole("button", { pressed: false });
        expect(found.length).toBeGreaterThan(0);
        return found;
      });
      fireEvent.click(cards[0]);

      fireEvent.click(await screen.findByRole("button", { name: "Lock in" }));

      if (round < 6) {
        await waitFor(() =>
          expect(screen.getByText(`${round} of 6 locked`)).toBeInTheDocument(),
        );
      }
    }

    // The sixth pick completes the ballot and routes to /results/:gameId.
    await screen.findByRole("heading", { name: "The season" });
    expect(screen.getByRole("heading", { name: "Your ballot, unmasked" })).toBeInTheDocument();
    // A record, a full 30-stop season and six unmasked picks. (The record
    // itself is matched by its eyebrow: the nav bar also reads "30–0".)
    expect(screen.getByText(/^(Final record|A perfect season)$/)).toBeInTheDocument();
    expect(screen.getAllByText(/vs \d+ needed$/)).toHaveLength(30);
    expect(screen.getAllByText(/^(Won the Oscar|Nominated|Not nominated)$/)).toHaveLength(6);

    expect(realErrors(consoleError)).toEqual([]);
  }, 20_000);

  it("renders the three read-only pages from the nav", async () => {
    const { default: App } = await import("./App");
    render(<App />);

    // Browse: the unmasked catalog for the default year.
    fireEvent.click(screen.getByRole("link", { name: "Browse" }));
    await screen.findByRole("heading", { name: /^The pool, \d{4}$/ });
    await screen.findByRole("heading", { name: /^Best Picture/ });
    // The catalog is unmasked, so the Academy badges are on the cards.
    expect(screen.getAllByText("Winner").length).toBeGreaterThan(0);

    // Leaderboard: nothing submitted in a fresh mock, so the empty state.
    fireEvent.click(screen.getByRole("link", { name: "Leaderboard" }));
    await screen.findByRole("heading", { name: "Today's challenge" });
    expect(
      await screen.findByText("No one has finished today's daily yet"),
    ).toBeInTheDocument();

    // Analytics: both model summaries resolve in the mock.
    fireEvent.click(screen.getByRole("link", { name: "Analytics" }));
    await screen.findByRole("heading", { name: "Model analytics" });
    await screen.findByRole("heading", { name: "Archetypes" });
    expect(await screen.findByText("ROC-AUC")).toBeInTheDocument();

    expect(realErrors(consoleError)).toEqual([]);
  });
});

/**
 * console.error calls that represent an actual problem. React's "not wrapped
 * in act" warning is expected here: the mock adapter answers on a timer, so a
 * response can land between assertions.
 */
function realErrors(spy: ReturnType<typeof vi.spyOn>): string[] {
  return spy.mock.calls
    .map((call) => String(call[0]))
    .filter((message) => !message.includes("not wrapped in act"));
}

/** jsdom has no matchMedia; src/test/setup.ts installs a stub and this
 *  swaps in one that answers a given `prefers-reduced-motion` verdict. */
function stubMatchMedia(matches: boolean) {
  window.matchMedia = (query: string): MediaQueryList =>
    ({
      matches,
      media: query,
      onchange: null,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      dispatchEvent: () => false,
    }) as MediaQueryList;
}
