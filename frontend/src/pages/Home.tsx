// Home: the front door. Route "/" (src/App.tsx).
//
// One job, deliberately: say what Clean Sweep is in a line, and start any of
// the three games in a single click. Everything that used to sit under the
// hero (the eight ballot slots, the metric glossary, the deficiency rule)
// moved into the How to Play dialog (src/components/layout/HowToPlayModal.tsx),
// because a landing page that has to be scrolled to be understood has already
// lost the player it was written for.
//
// Two decisions worth recording:
//
//   * Home absorbed the mode menu. It serves the same `GET /api/modes` the
//     /modes page does, so the server stays the single authority on which
//     modes have their seed data built. /modes still exists as the fuller
//     side-by-side comparison and the results screens still link to it; it is
//     just no longer the way in, which is why it left the nav bar
//     (src/components/layout/AppShell.tsx).
//
//   * Starting a game goes through the game store (`useGame().createGame`)
//     rather than the API client, so the new GameState is already in context
//     when we navigate to /play/:gameId, so the Play page renders instantly
//     instead of re-fetching it. The two side modes create their own round on
//     mount, so for those the tile just navigates.

import { useEffect, useState, type ReactNode } from "react";
import { Link, useNavigate } from "react-router";
import { api } from "../api";
import type { Mode, ModeCard } from "../api/types";
import { useGame } from "../state/GameContext";
import { useSiteDialogs } from "../state/SiteDialogContext";
import { useToast } from "../state/ToastContext";
import { useAsync } from "../lib/useAsync";
import { todaySeed } from "../lib/format";
import { MODE_FALLBACK, MODE_IDS, type ModeId } from "../lib/modes";
import { Button } from "../components/ui/Button";
import { Chip } from "../components/ui/Chip";
import { ErrorBanner } from "../components/ui/ErrorBanner";
import { Icon, type IconName } from "../components/ui/Icon";

/** Which start action is waiting on the server, so only that button spins. */
type StartKey = `${ModeId}:${"play" | "alt" | "daily"}`;

/** The glyph and the ordinal each tile is marked with. */
const TILE_ICON: Record<ModeId, IconName> = {
  oscars: "trophy",
  recast: "cast",
  grid: "grid",
};
const NUMERALS = ["I", "II", "III"];

export function HomePage() {
  const navigate = useNavigate();
  const { createGame, error, clearError } = useGame();
  const { push } = useToast();
  const { openHowToPlay } = useSiteDialogs();
  const [starting, setStarting] = useState<StartKey | null>(null);

  // The menu is server-owned: only the backend knows whether a mode's seed
  // tables exist. `MODE_FALLBACK` is what the page paints on the first frame
  // and if the request never lands, so the front door is never a spinner.
  const { data, error: menuError, reload } = useAsync(() => api.getModes(), []);
  const cards: ModeCard[] = data ?? MODE_IDS.map((id) => MODE_FALLBACK[id]);

  const seed = todaySeed();

  // The game store keeps the last error; surface it as a toast (the `detail`
  // string from the API) and clear it so it cannot fire twice.
  useEffect(() => {
    if (!error) return;
    push(error, "error");
    clearError();
  }, [error, push, clearError]);

  /** Oscars only: POST a game, then hand off to the Play screen. */
  async function startOscars(key: StartKey, mode: Mode, gameSeed?: string) {
    setStarting(key);
    const game = await createGame(mode, gameSeed);
    setStarting(null);
    if (game) navigate(`/play/${game.id}`);
  }

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col items-center">
      {/* ---- Hero ------------------------------------------------------ */}
      <section className="flex flex-col items-center pt-6 text-center sm:pt-16">
        <Monogram />
        <p className="mt-5 text-[10px] uppercase tracking-[0.45em] text-accent/90 sm:text-[11px]">
          Three film games, one catalogue
        </p>
        <h1 className="text-silvered animate-glow mt-3 text-5xl leading-[1.05] sm:text-7xl">
          Clean Sweep
        </h1>
        <div className="rule-accent mt-6 w-24" aria-hidden />
        <p className="mt-6 max-w-xl text-balance text-base leading-relaxed text-bone-dim">
          Draft an eight-slot awards ballot, recast a film from its shortlist, or name the actor
          who connects two others.
        </p>
      </section>

      {/* A failed menu is worth saying out loud. The tiles below are still
          rendered from the fallback copy, so the page is usable meanwhile. */}
      {menuError && (
        <div className="mt-10 w-full max-w-2xl">
          <ErrorBanner message={menuError} onRetry={reload} />
        </div>
      )}

      {/* ---- The three modes ------------------------------------------- */}
      {/* Three across only from `md`: at the `sm` breakpoint the tiles
          are narrow enough that the row of quiet links under each one wraps. */}
      <ul className="mt-12 grid w-full gap-4 sm:mt-16 md:grid-cols-3">
        {cards.map((card, index) => (
          <li key={card.id} className="h-full">
            <ModeTile
              card={card}
              numeral={NUMERALS[index] ?? String(index + 1)}
              onRules={() => openHowToPlay(card.id)}
              primary={
                // Two notes on the primary action. It is outlined rather than
                // filled: three slabs of accent would fight the wordmark for the
                // eye, and the three modes are peers, so none of them gets to
                // be the page's one loud object. And three buttons reading
                // "Play" would be three identical stops for a screen reader,
                // so each carries its mode in its accessible name while the
                // tile carries it visually.
                card.id === "oscars" ? (
                  <Button
                    variant="secondary"
                    className="w-full"
                    aria-label={`Play ${card.label}`}
                    onClick={() => void startOscars("oscars:play", "classic")}
                    loading={starting === "oscars:play"}
                    disabled={starting !== null}
                  >
                    Play
                  </Button>
                ) : (
                  // The side modes create their round on mount, so the tile
                  // only has to put the browser on the route. A button rather
                  // than a link, because pressing it starts a game rather
                  // than opening a document.
                  <Button
                    variant="secondary"
                    className="w-full"
                    aria-label={`Play ${card.label}`}
                    onClick={() => navigate(card.path)}
                  >
                    Play
                  </Button>
                )
              }
              secondary={
                card.id === "oscars" ? (
                  <>
                    <QuietAction
                      onClick={() => void startOscars("oscars:alt", "cinephile")}
                      busy={starting === "oscars:alt"}
                      disabled={starting !== null}
                      ariaLabel="Play The Oscars in cinephile mode"
                      title="Hard mode: no numbers on the cards, just title, year, person and role"
                    >
                      Cinephile
                    </QuietAction>
                    <QuietAction
                      onClick={() => void startOscars("oscars:daily", "classic", seed)}
                      busy={starting === "oscars:daily"}
                      disabled={starting !== null}
                      ariaLabel={`Play today's daily: ${card.label}`}
                      title={`Everyone gets the same deal on ${seed}`}
                    >
                      Daily
                    </QuietAction>
                  </>
                ) : (
                  <QuietAction
                    onClick={() => navigate(`${card.path}?seed=${seed}`)}
                    ariaLabel={`Play today's daily: ${card.label}`}
                    title={`Everyone gets the same ${
                      card.id === "grid" ? "board" : "film"
                    } on ${seed}`}
                  >
                    Daily
                  </QuietAction>
                )
              }
            />
          </li>
        ))}
      </ul>

      <p className="mt-8 max-w-xl text-center text-xs leading-relaxed text-muted">
        A daily is dealt from today&rsquo;s date, <span className="tabular-nums">{seed}</span>, and
        is the same for every player.{" "}
        <Link to="/leaderboard" className="text-accent/90 underline-offset-4 hover:underline">
          Today&rsquo;s board
        </Link>
      </p>
    </div>
  );
}

/**
 * One mode tile: glyph, ordinal, name, one line, and the ways in.
 *
 * `primary` is the single-click start; `secondary` is the quiet row beneath
 * it, which the tile joins to its own "Rules" link so all the small print
 * sits on one line.
 *
 * An unavailable mode, meaning the server says its seed tables were never
 * built, is rendered as a dead end rather than a control that would 503: the tile
 * dims, carries a "Not built" chip, and states the reason. Its only live
 * control is the rules link, which costs nothing to read.
 */
function ModeTile({
  card,
  numeral,
  onRules,
  primary,
  secondary,
}: {
  card: ModeCard;
  numeral: string;
  onRules: () => void;
  primary: ReactNode;
  secondary: ReactNode;
}) {
  return (
    <div
      aria-disabled={card.available ? undefined : "true"}
      className={[
        "group flex h-full flex-col rounded-xl border bg-ink-2/60 p-5 transition-all duration-200",
        card.available
          ? "border-line hover:-translate-y-0.5 hover:border-accent/50 hover:shadow-glow"
          : "border-dashed border-line opacity-60",
      ].join(" ")}
    >
      <div className="flex items-start justify-between">
        <Icon
          name={TILE_ICON[card.id]}
          size={24}
          className="text-accent/70 transition-colors group-hover:text-accent"
        />
        <span aria-hidden className="font-display text-base leading-none tracking-[0.15em] text-accent/55">
          {numeral}
        </span>
      </div>

      <h2 className="mt-5 text-xl leading-tight text-bone">{card.label}</h2>
      <p className="mt-1.5 text-sm leading-relaxed text-bone-dim">{card.tagline}</p>

      {/* `mt-auto` pins the actions to the bottom edge, so three tiles with
          taglines of different lengths still line their buttons up. */}
      <div className="mt-auto flex flex-col items-stretch gap-3 pt-6">
        {card.available ? (
          primary
        ) : (
          <>
            <Chip tone="loss" className="self-start">
              Not built
            </Chip>
            <p className="text-xs leading-relaxed text-muted">
              This mode needs its data built. Run the seed step for it and the tile turns on.
            </p>
          </>
        )}
        {/* The rules link is offered whether or not the mode is built: it is
            the cheapest way to find out whether one is worth waiting for. */}
        <div className="flex flex-wrap items-center justify-center gap-x-3 gap-y-1">
          {card.available && secondary}
          <QuietAction
            onClick={onRules}
            ariaLabel={`How to play ${card.label}`}
            title={`How to play ${card.label}`}
          >
            Rules
          </QuietAction>
        </div>
      </div>
    </div>
  );
}

/**
 * The small underlined text button used under a tile's primary action.
 *
 * A real <button> rather than a styled link: every one of these starts
 * something. `busy` marks the one the player pressed while its request is in
 * flight, so the tile shows which of its two secondary actions is running.
 *
 * `ariaLabel` is separate from `title` on purpose: the tooltip explains what
 * the action does ("Everyone gets the same deal on 2026-09-07"), which is far
 * too long to be an accessible name. The name says which mode the word
 * "Daily" belongs to, since three tiles each offer one.
 */
function QuietAction({
  onClick,
  title,
  ariaLabel,
  busy = false,
  disabled = false,
  children,
}: {
  onClick: () => void;
  title?: string;
  ariaLabel?: string;
  busy?: boolean;
  disabled?: boolean;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      aria-label={ariaLabel}
      disabled={disabled}
      className="text-[11px] uppercase tracking-[0.2em] text-muted underline decoration-line underline-offset-4 transition-colors hover:text-accent hover:decoration-accent/50 disabled:opacity-40 disabled:hover:text-muted focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-accent"
    >
      {children}
      {busy && <span className="ml-1 text-accent">…</span>}
    </button>
  );
}

/**
 * The wordmark device above the hero: a frame of film with the initials in
 * it. Inline SVG rather than an asset so it inherits `currentColor` and needs
 * no second network request on the one page where first paint matters most.
 */
function Monogram() {
  const holes = [8, 18, 28, 38, 48];
  return (
    <svg
      aria-hidden
      focusable="false"
      viewBox="0 0 56 44"
      width="56"
      height="44"
      className="text-accent"
    >
      <rect
        x="0.7"
        y="0.7"
        width="54.6"
        height="42.6"
        rx="5"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.1"
        opacity="0.55"
      />
      <g fill="currentColor" opacity="0.4">
        {holes.map((x) => (
          <rect key={`t${x}`} x={x - 2} y="4.5" width="4" height="3" rx="1" />
        ))}
        {holes.map((x) => (
          <rect key={`b${x}`} x={x - 2} y="36.5" width="4" height="3" rx="1" />
        ))}
      </g>
      <text
        x="28"
        y="28"
        textAnchor="middle"
        fontFamily="var(--font-display)"
        fontSize="17"
        letterSpacing="1.5"
        fill="currentColor"
      >
        CS
      </text>
    </svg>
  );
}
