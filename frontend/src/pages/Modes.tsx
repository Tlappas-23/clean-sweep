// Modes: the game-mode menu, and the natural front door to the app.
//
// Route "/modes" (src/App.tsx). Three cards, one per mode, straight from
// `GET /api/modes`.
//
// The menu comes from the server rather than being a hardcoded list here for
// one reason, and it is the reason `ModeCard.available` exists: the two side
// modes read seed tables the core pipeline does not build, so a checkout that
// has only run `build_seed` has an Oscars game and nothing else. Only the
// server knows that. A card whose data is missing is therefore rendered
// visibly disabled, with the reason written on it — which is a far better
// answer than a 503 after a click.
//
// The daily-board shortcut under the grid card is the only piece of copy on
// this page the server does not supply: a seeded board is a client-side URL
// (`/grid?seed=YYYY-MM-DD`), so the menu is the right place to offer it.

import { Link } from "react-router";
import { api } from "../api";
import type { ModeCard } from "../api/types";
import { useAsync } from "../lib/useAsync";
import { todaySeed } from "../lib/format";
import { PageHeader } from "../components/ui/PageHeader";
import { PageLoader } from "../components/ui/Spinner";
import { ErrorBanner } from "../components/ui/ErrorBanner";
import { Chip } from "../components/ui/Chip";

export function ModesPage() {
  const { data, loading, error, reload } = useAsync(() => api.getModes(), []);
  const seed = todaySeed();

  return (
    <div className="flex flex-col gap-8">
      <PageHeader
        eyebrow="Three ways to play"
        title="Choose a mode"
        lede="One catalog, three games. Draft an awards ballot, recast a film from its shortlist, or fill a grid of co-stars against the clock."
      />

      {loading && <PageLoader label="Loading modes" />}
      {error && !loading && <ErrorBanner message={error} onRetry={reload} />}

      {data && (
        <ul className="grid gap-5 lg:grid-cols-3">
          {data.map((mode) => (
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
        <h2 className="text-2xl leading-tight text-ivory">{mode.label}</h2>
        {!mode.available && <Chip tone="loss">Not built</Chip>}
      </div>
      <p className="text-sm text-gold/90">{mode.tagline}</p>
      <p className="mt-1 text-sm leading-relaxed text-ivory-dim">{mode.description}</p>
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
        className="group flex h-full flex-col gap-2 rounded-xl border border-line bg-ink-2/70 p-6 transition-all duration-200 hover:-translate-y-0.5 hover:border-gold/60 hover:shadow-glow focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gold"
      >
        {body}
        <p className="mt-auto pt-5 text-xs uppercase tracking-[0.25em] text-gold">
          Play
          <span aria-hidden className="ml-2 inline-block transition-transform group-hover:translate-x-1">
            →
          </span>
        </p>
      </Link>

      {/* The grid is the one mode with a shared daily board worth linking to
          directly; everyone who starts it with today's date gets the same
          three-by-three. */}
      {mode.id === "grid" && (
        <p className="mt-2 text-center text-xs text-muted">
          or play{" "}
          <Link
            to={`/grid?seed=${dailySeed}`}
            className="text-gold hover:underline"
            title={`Everyone gets the same board on ${dailySeed}`}
          >
            today&rsquo;s daily board
          </Link>
        </p>
      )}
    </div>
  );
}
