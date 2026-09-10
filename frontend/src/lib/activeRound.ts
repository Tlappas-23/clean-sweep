// Which board you are on, and which daily you have already spent.
//
// Two rules the game needs and the server cannot enforce.
//
// **A live round locks the front door.** The clock starts when a board is
// dealt and runs whether or not you are looking at it, so a Start button that
// deals a *new* board is a way to restart the clock by pressing Home. Once a
// round is live, the front door resumes it instead of offering another.
//
// **Today's daily is one attempt.** It is the same three by three for
// everybody, so a second go at it is a different game from the one everyone
// else played. A fresh random board is always available instead.
//
// Why this lives in the browser
// -----------------------------
// There are no accounts, so the server has no idea who is asking; rate
// limiting keys on an address, which is not a person. Enforcing "one daily
// each" needs an identity, and asking somebody to sign up to a film quiz is a
// worse trade than a rule they could clear their site data to dodge. It is
// stated here rather than implied: this is a guard rail, not a lock, and it
// is per browser, like the personal best.
//
// Every read and write is wrapped. A private window or a browser set to block
// site data can throw on access, and a storage error must never stop somebody
// playing.

const KEY = "clean-sweep:round:v1";

export interface RoundRecord {
  id: string;
  /** The daily's date, or null for a random board. */
  seed: string | null;
  /**
   * When the clock runs out, as epoch milliseconds.
   *
   * Stored rather than recomputed so the front door can tell a live round
   * from a spent one without asking the server. The server stays the
   * authority on what a round *is*; this only decides what to offer.
   */
  endsAt: number;
  /** Handed in, filled, or timed out. Set when the client sees "complete". */
  finished: boolean;
}

interface Store {
  /** The most recent round, live or not. */
  last?: RoundRecord;
  /** Daily attempts by seed, so today's can be found without a scan. */
  dailies?: Record<string, RoundRecord>;
}

function read(): Store {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as Store) : {};
  } catch {
    return {};
  }
}

function write(store: Store): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(store));
  } catch {
    // Nothing to do: the player keeps playing, the rule just stops applying.
  }
}

/**
 * Record a board the player is on, or update one they have finished.
 *
 * Called from the grid store on every server response, so a round is recorded
 * however it was reached: the front door, a pasted link, or a reload.
 */
export function remember(round: {
  id: string;
  seed: string | null;
  secondsRemaining: number;
  finished: boolean;
}): void {
  const store = read();
  const record: RoundRecord = {
    id: round.id,
    seed: round.seed,
    endsAt: Date.now() + round.secondsRemaining * 1000,
    finished: round.finished,
  };

  // A finished round keeps the deadline it had rather than taking `now`,
  // otherwise handing in early would look like a round that ran its full
  // length. Only the flag moves.
  const previous = store.last?.id === round.id ? store.last : undefined;
  store.last = previous ? { ...previous, finished: round.finished } : record;

  if (round.seed) {
    store.dailies = { ...store.dailies, [round.seed]: store.last };
  }
  write(store);
}

/**
 * The round still in play, or null.
 *
 * Live means not finished and not past its deadline. The deadline check is
 * what stops a round abandoned yesterday from locking the front door forever.
 */
export function liveRound(now: number = Date.now()): RoundRecord | null {
  const last = read().last;
  if (!last || last.finished || now >= last.endsAt) return null;
  return last;
}

/**
 * The attempt at a given daily, or null if it has not been started.
 *
 * Any attempt counts, finished or not. Starting the daily and walking away is
 * still the one go at it: the clock ran, and offering a second board under
 * the same date would make the shared board mean nothing.
 */
export function dailyAttempt(seed: string): RoundRecord | null {
  return read().dailies?.[seed] ?? null;
}

/** Drop everything. Used by the tests, and by nothing else. */
export function forget(): void {
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* nothing to clear */
  }
}
