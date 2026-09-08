// Tests for the two site-wide dialogs, reached the way a player reaches
// them: through the footer links AppShell puts on every route.
//
// Three things are pinned here.
//
//   1. How to Play really is per mode. The dialog covers three games, so the
//      tab strip has to swap the steps rather than concatenate them. The
//      failure mode worth catching is a modal that shows all fourteen steps
//      at once.
//
//   2. About carries the required attribution strings character for
//      character. TMDB and IMDb both specify the exact sentence, and a
//      well-meaning copy edit is the realistic way that breaks, so the
//      assertion compares against the constants the dialog itself renders.
//
//   3. The dialog behaves like a dialog: named, modal, dismissible three
//      ways, and it gives focus back to the link that opened it.

import { afterEach, describe, expect, it } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router";
import { MODE_STEPS } from "../../lib/modes";
import { ToastProvider } from "../../state/ToastContext";
import { AppShell } from "./AppShell";
import { IMDB_ATTRIBUTION, TMDB_ATTRIBUTION } from "./AboutModal";

/**
 * The shell wrapped around an arbitrary page, so the test proves the footer
 * offers both dialogs from a route that knows nothing about them.
 */
function renderShell() {
  render(
    <ToastProvider>
      <MemoryRouter initialEntries={["/browse"]}>
        <Routes>
          <Route element={<AppShell />}>
            <Route path="/browse" element={<p>a page</p>} />
          </Route>
        </Routes>
      </MemoryRouter>
    </ToastProvider>,
  );
}

/**
 * Click a footer link and return the dialog it opened.
 *
 * The explicit `focus()` stands in for the browser: jsdom's synthetic click
 * does not move focus to the button the way a real pointer press does, and
 * without it there would be nothing for the dialog to restore focus to.
 */
async function open(link: "How to play" | "About") {
  const trigger = screen.getByRole("button", { name: link });
  trigger.focus();
  fireEvent.click(trigger);
  return screen.findByRole("dialog");
}

/**
 * jsdom has no matchMedia; src/test/setup.ts installs a "no reduced motion"
 * stub and this swaps in one that answers a given verdict, so the dialog's
 * `prefers-reduced-motion` branch can be exercised.
 */
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

afterEach(() => {
  // The Modal locks body scroll while open; an unmounted dialog that left it
  // locked would leak into the next test.
  document.body.style.overflow = "";
  stubMatchMedia(false);
});

describe("How to Play", () => {
  it("opens from the footer as a named, modal dialog", async () => {
    renderShell();
    const dialog = await open("How to play");

    expect(dialog).toHaveAttribute("aria-modal", "true");
    expect(dialog).toHaveAccessibleName("How to play");
    // Focus is inside the dialog, not left behind on the page.
    expect(dialog.contains(document.activeElement)).toBe(true);
  });

  it("shows one mode's steps at a time, and swaps them with the tabs", async () => {
    renderShell();
    const dialog = await open("How to play");

    // It opens on the Oscars, the first mode.
    expect(
      within(dialog).getByRole("tab", { name: "The Oscars", selected: true }),
    ).toBeInTheDocument();
    for (const step of MODE_STEPS.oscars) {
      expect(within(dialog).getByText(step.text)).toBeInTheDocument();
    }
    // And only the Oscars: the other modes' steps are not on screen.
    expect(within(dialog).queryByText(MODE_STEPS.grid[0].text)).toBeNull();

    fireEvent.click(within(dialog).getByRole("tab", { name: "Six Degrees" }));

    for (const step of MODE_STEPS.grid) {
      expect(within(dialog).getByText(step.text)).toBeInTheDocument();
    }
    expect(within(dialog).queryByText(MODE_STEPS.oscars[0].text)).toBeNull();

    fireEvent.click(within(dialog).getByRole("tab", { name: "Recast" }));
    for (const step of MODE_STEPS.recast) {
      expect(within(dialog).getByText(step.text)).toBeInTheDocument();
    }
  });

  it("moves selection and focus with the arrow keys", async () => {
    renderShell();
    const dialog = await open("How to play");

    const strip = within(dialog).getByRole("tablist");
    fireEvent.keyDown(strip, { key: "ArrowRight" });

    const recast = within(dialog).getByRole("tab", { name: "Recast" });
    expect(recast).toHaveAttribute("aria-selected", "true");
    // A tablist that selects without moving focus strands the keyboard.
    expect(document.activeElement).toBe(recast);
  });

  it("closes on Escape and hands focus back to the footer link", async () => {
    renderShell();
    await open("How to play");

    fireEvent.keyDown(document, { key: "Escape" });

    expect(screen.queryByRole("dialog")).toBeNull();
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "How to play" }));
  });

  it("closes on a backdrop click and on the close button", async () => {
    renderShell();
    const dialog = await open("How to play");

    // The backdrop is the dialog's parent; a press on the panel itself must
    // not dismiss, which is what comparing target to currentTarget buys.
    fireEvent.mouseDown(dialog);
    expect(screen.queryByRole("dialog")).toBeInTheDocument();

    fireEvent.mouseDown(dialog.parentElement as HTMLElement);
    expect(screen.queryByRole("dialog")).toBeNull();

    const reopened = await open("How to play");
    fireEvent.click(within(reopened).getByRole("button", { name: "Close" }));
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("keeps Tab inside the panel", async () => {
    renderShell();
    const dialog = await open("How to play");

    const stops = within(dialog).getAllByRole("button");
    const first = stops[0];
    const last = stops[stops.length - 1];

    // Forwards off the end wraps to the top...
    last.focus();
    fireEvent.keyDown(document, { key: "Tab" });
    expect(document.activeElement).toBe(first);

    // ...and backwards off the top wraps to the bottom, so the page behind
    // the dialog is never reachable by keyboard while it is open.
    fireEvent.keyDown(document, { key: "Tab", shiftKey: true });
    expect(document.activeElement).toBe(last);
  });

  it("drops the entrance animation when the reader prefers reduced motion", async () => {
    stubMatchMedia(true);
    renderShell();
    const dialog = await open("How to play");

    // Belt and braces with the CSS guard in src/index.css: the element does
    // not even carry the animation class.
    expect(dialog.className).not.toContain("animate-rise");
  });
});

describe("About", () => {
  it("carries the disclaimer and the required attributions verbatim", async () => {
    renderShell();
    const dialog = await open("About");

    expect(dialog).toHaveAccessibleName("About");

    // The disclaimer: unofficial, and unaffiliated with the Academy.
    expect(within(dialog).getByText(/unofficial fan project/i)).toBeInTheDocument();
    expect(
      within(dialog).getByText(/Academy of Motion Picture Arts and Sciences/),
    ).toBeInTheDocument();
    expect(within(dialog).getByText(/identification and commentary only/)).toBeInTheDocument();

    // The two strings the providers word for us. `getByText` with a string
    // matcher is an exact, whole-node comparison, which is the point: a
    // reworded line does not match.
    expect(within(dialog).getByText(TMDB_ATTRIBUTION)).toBeInTheDocument();
    expect(within(dialog).getByText(IMDB_ATTRIBUTION)).toBeInTheDocument();
    expect(TMDB_ATTRIBUTION).toBe(
      "This product uses the TMDB API but is not endorsed or certified by TMDB.",
    );
    expect(IMDB_ATTRIBUTION).toBe(
      "Information courtesy of IMDb (https://www.imdb.com). Used with permission.",
    );

    // The two remaining sources, and the two standing caveats.
    expect(within(dialog).getByText(/OMDb API/)).toBeInTheDocument();
    expect(within(dialog).getByText(/DLu\/oscar_data/)).toBeInTheDocument();
    expect(within(dialog).getByText(/estimates are estimates/i)).toBeInTheDocument();
    expect(within(dialog).getByText(/non-commercial/i)).toBeInTheDocument();
  });
});
