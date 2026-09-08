// Personal best: the number a player is actually chasing.
//
// The game's result is a ballot score out of 800. On its own that is a fact;
// what makes it a game is having something to beat, so the previous best is
// kept and the results screen says by how much it was passed.
//
// Stored per browser, not per account, because there are no accounts. That
// has an honest limit worth naming: a best set on a phone is not the same
// best as one set on a laptop, and clearing site data clears it. The
// alternative is asking people to sign up to a film quiz, which is a worse
// trade. The shared leaderboard is where cross-device comparison lives.
//
// Every read and write is wrapped: a private window, a browser set to block
// site data, or an embedded webview can throw on access rather than returning
// null, and a thrown storage error must never stop a player seeing their
// score.

/** One entry per mode, so Cinephile's harder ballots keep their own best. */
const KEY = "clean-sweep:best:v1";

export interface Best {
  score: number;
  wins: number;
  /** ISO date, so the screen can say when it was set. */
  at: string;
}

type Table = Record<string, Best>;

function read(): Table {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as Table) : {};
  } catch {
    return {};
  }
}

/** The best for a mode, or null if this is the first game. */
export function bestFor(mode: string): Best | null {
  return read()[mode] ?? null;
}

/**
 * Record a finished game and say what it did to the record.
 *
 * Returns the previous best (so the screen can show what was beaten) and
 * whether this one passed it. Called once per completed game; calling it
 * again with the same score is harmless, since a score only replaces a strictly
 * larger one.
 */
export function recordScore(
  mode: string,
  score: number,
  wins: number,
): { previous: Best | null; beaten: boolean; first: boolean } {
  const table = read();
  const previous = table[mode] ?? null;
  const first = previous === null;
  const beaten = previous !== null && score > previous.score;

  if (first || score > previous.score) {
    try {
      table[mode] = { score, wins, at: new Date().toISOString() };
      localStorage.setItem(KEY, JSON.stringify(table));
    } catch {
      // Nothing to do and nothing worth saying: the player still sees the
      // score they just got, they just will not see it remembered.
    }
  }
  return { previous, beaten, first };
}
