// Modes: the game-mode menu, and the natural front door to the app.
//
// Route "/modes" (src/App.tsx). One card per mode, straight from
// `GET /api/modes`.
//
// The menu comes from the server rather than being a hardcoded list here for
// one reason, and it is the reason `ModeCard.available` exists: the two side
// modes read seed tables the core pipeline does not build, so a checkout that
// has only run `build_seed` has an Oscars game and nothing else. Only the
// server knows that. A card whose data is missing is therefore rendered
// visibly disabled, with the reason written on it. That is a far better
// answer than a 503 after a click.
//
// The daily-board shortcut under the grid card is the only piece of copy on
// this page the server does not supply: a seeded board is a client-side URL
// (`/grid?seed=YYYY-MM-DD`), so the menu is the right place to offer it.

import { Link } from "react-router";
import { api } from "../api";
import type { ModeCard } from "../api/types";
import { useAsync } from "../lib/useAsync";
import { MODE_IDS, type ModeId } from "../lib/modes";
import { todaySeed } from "../lib/format";
import { PageHeader } from "../components/ui/PageHeader";
import { PageLoader } from "../components/ui/Spinner";
import { ErrorBanner } from "../components/ui/ErrorBanner";
import { Chip } from "../components/ui/Chip";

export function ModesPage() {
  const { data, loading, error, reload } = useAsync(() => api.getModes(), []);

  // Filtered through MODE_IDS rather than rendered as it arrives. The server
  // describes everything it can do, which includes Recast; the client decides
  // what it offers, which does not. Ordered by MODE_IDS too, so this page and
  // the header menu list the games in the same order.
  const modes = (data ?? [])
    .filter((mode) => (MODE_IDS as readonly string[]).includes(mode.id))
    .sort((a, b) => MODE_IDS.indexOf(a.id as ModeId) - MODE_IDS.indexOf(b.id as ModeId));
  const seed = todaySeed();

  return (
    <div className="flex flex-col gap-8">
      <PageHeader
        eyebrow="Three ways to play"
        title="Choose a mode"
        lede="One catalogue, three games. Find the actor who links two others, draft an eight-slot awards ballot, or get from one film to another through their casts."
      />

      {loading && <PageLoader label="Loading modes" />}
      {error && !loading && <ErrorBanner message={error} onRetry={reload} />}

      {data && (
        // Two across rather than three: four cards in threes leave one alone
        // on a second row, and these carry a paragraph each, so two columns
        // also keep the measure readable.
        <ul className="grid gap-5 sm:grid-cols-2">
          {modes.map((mode) => (
            <li key={mode.id} className="h-full">
              <ModeTile mode={mode} dailySeed={seed} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/**
 * What each mode's daily deals, for the link under its card.
 *
 * Only the modes with one appear. The Oscars deals a daily too, but starting
 * it takes a request rather than a route, so its link lives on the landing
 * page beside the button that makes that request.
 */
const DAILY_NOUN: Partial<Record<ModeCard["id"], string>> = {
  grid: "board",
  chain: "pair",
};

/**
 * One mode card.
 *
 * An available mode is a link across the whole tile; an unavailable one is a
 * plain block with no destination at all, so there is nothing to click and
 * nothing to focus. `aria-disabled` plus the note below the description say
 * the same thing to a screen reader that the muted treatment says to the eye.
 */
function ModeTile({ mode, dailySeed }: { mode: ModeCard; dailySeed: string }) {
  const body = (
    <>
      <div className="flex items-start justify-between gap-3">
        <h2 className="text-2xl leading-tight text-bone">{mode.label}</h2>
        {!mode.available && <Chip tone="loss">Not built</Chip>}
      </div>
      <p className="text-sm text-accent/90">{mode.tagline}</p>
      <p className="mt-1 text-sm leading-relaxed text-bone-dim">{mode.description}</p>
    </>
  );

  if (!mode.available) {
    return (
      <div
        aria-disabled="true"
        className="flex h-full flex-col gap-2 rounded-xl border border-dashed border-line bg-ink-2/40 p-6 opacity-60"
      >
        {body}
        <p className="mt-auto pt-4 text-xs text-muted">
          This mode needs its data built. Run the seed step for it and the card turns on.
        </p>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      <Link
        to={mode.path}
        className="group flex h-full flex-col gap-2 rounded-xl border border-line bg-ink-2/70 p-6 transition-all duration-200 hover:-translate-y-0.5 hover:border-accent/60 hover:shadow-glow focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
      >
        {body}
        <p className="mt-auto pt-5 text-xs uppercase tracking-[0.25em] text-accent">
          Play
          <span aria-hidden className="ml-2 inline-block transition-transform group-hover:translate-x-1">
            →
          </span>
        </p>
      </Link>

      {/* The two graph modes deal something shared that is worth linking to
          directly: everyone who starts either with today's date gets the same
          board, or the same pair of films. What that is differs, so the noun
          is per mode rather than one hedge that fits neither. */}
      {DAILY_NOUN[mode.id] && (
        <p className="mt-2 text-center text-xs text-muted">
          or play{" "}
          <Link
            to={`${mode.path}?seed=${dailySeed}`}
            className="text-accent hover:underline"
            title={`Everyone gets the same ${DAILY_NOUN[mode.id]} on ${dailySeed}`}
          >
            today&rsquo;s daily {DAILY_NOUN[mode.id]}
          </Link>
        </p>
      )}
    </div>
  );
}
