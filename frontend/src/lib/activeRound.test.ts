/**
 * Tests for the round guard rails (src/lib/activeRound.ts).
 *
 * Two rules, both of which exist because the clock is real: it starts when a
 * board is dealt and runs whether or not anybody is watching.
 *
 * A Start button that deals a *new* board is therefore a way to restart the
 * clock by pressing Home, and a second go at the shared daily is a different
 * game from the one everybody else played. Neither can be enforced on the
 * server, which has no idea who is asking, so both are pinned here.
 */

import { beforeEach, describe, expect, it } from "vitest";
import { dailyAttempt, forget, liveRound, remember } from "./activeRound";

const MINUTE = 60_000;

beforeEach(() => {
  forget();
});

describe("a live round", () => {
  it("is reported while its clock is still running", () => {
    remember({ id: "b1", seed: null, secondsRemaining: 180, finished: false });

    const live = liveRound();
    expect(live?.id).toBe("b1");
  });

  it("is not reported once it has been handed in", () => {
    // Handing in early ends the round even though the clock had time left.
    remember({ id: "b1", seed: null, secondsRemaining: 180, finished: false });
    remember({ id: "b1", seed: null, secondsRemaining: 90, finished: true });

    expect(liveRound()).toBeNull();
  });

  it("is not reported once its clock has run out", () => {
    // The check that stops a board abandoned yesterday locking the front door
    // forever: an unfinished round is only live until its deadline.
    remember({ id: "b1", seed: null, secondsRemaining: 180, finished: false });

    expect(liveRound(Date.now() + 4 * MINUTE)).toBeNull();
  });

  it("keeps the deadline it was given when it is finished early", () => {
    // Otherwise handing in at ninety seconds would record a round that ran
    // its full length, and the next update would look like a fresh start.
    remember({ id: "b1", seed: null, secondsRemaining: 180, finished: false });
    const before = liveRound()?.endsAt;

    remember({ id: "b1", seed: null, secondsRemaining: 5, finished: true });
    expect(dailyAttempt("nope")).toBeNull();
    // The record is gone from `liveRound` but its deadline was not rewritten.
    remember({ id: "b1", seed: null, secondsRemaining: 5, finished: false });
    expect(liveRound()?.endsAt).toBe(before);
  });

  it("is replaced when a different board is started", () => {
    remember({ id: "old", seed: null, secondsRemaining: 180, finished: false });
    remember({ id: "new", seed: null, secondsRemaining: 180, finished: false });

    expect(liveRound()?.id).toBe("new");
  });
});

describe("today's daily", () => {
  it("counts as spent the moment it is started", () => {
    // Any attempt counts. Starting it and walking away is still the one go:
    // the clock ran, and a second board under the same date would make the
    // shared board mean nothing.
    expect(dailyAttempt("2026-09-10")).toBeNull();

    remember({ id: "d1", seed: "2026-09-10", secondsRemaining: 180, finished: false });

    expect(dailyAttempt("2026-09-10")?.id).toBe("d1");
  });

  it("stays spent after it finishes", () => {
    remember({ id: "d1", seed: "2026-09-10", secondsRemaining: 180, finished: false });
    remember({ id: "d1", seed: "2026-09-10", secondsRemaining: 0, finished: true });

    expect(dailyAttempt("2026-09-10")?.id).toBe("d1");
  });

  it("does not spend a different day", () => {
    remember({ id: "d1", seed: "2026-09-10", secondsRemaining: 180, finished: false });

    expect(dailyAttempt("2026-09-11")).toBeNull();
  });

  it("is not spent by a random board", () => {
    remember({ id: "r1", seed: null, secondsRemaining: 180, finished: false });

    expect(dailyAttempt("2026-09-10")).toBeNull();
  });

  it("keeps both records: a spent daily and a live random board", () => {
    // The state after somebody plays the daily and starts a random one. The
    // front door has to offer neither a daily nor a Start, but a Resume.
    remember({ id: "d1", seed: "2026-09-10", secondsRemaining: 0, finished: true });
    remember({ id: "r1", seed: null, secondsRemaining: 180, finished: false });

    expect(dailyAttempt("2026-09-10")?.id).toBe("d1");
    expect(liveRound()?.id).toBe("r1");
  });
});

describe("storage that refuses to work", () => {
  it("degrades to offering a fresh board rather than throwing", () => {
    // A private window or a browser blocking site data can throw on access,
    // and a storage error must never stop somebody playing. The rule stops
    // applying; the game does not stop.
    const original = Object.getOwnPropertyDescriptor(window, "localStorage");
    Object.defineProperty(window, "localStorage", {
      configurable: true,
      get() {
        throw new DOMException("denied", "SecurityError");
      },
    });

    expect(() => remember({ id: "x", seed: null, secondsRemaining: 180, finished: false })).not.toThrow();
    expect(liveRound()).toBeNull();
    expect(dailyAttempt("2026-09-10")).toBeNull();

    if (original) Object.defineProperty(window, "localStorage", original);
  });
});
