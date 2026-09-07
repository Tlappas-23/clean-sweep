// Play: the drafting screen. Route "/play/:gameId" (src/App.tsx).
//
// This page is pure orchestration — every piece of markup comes from
// src/components/play/*. Its only real jobs are:
//   1. make sure the game in the store matches the :gameId in the URL;
//   2. gate the candidate grid behind the slot-machine animation, so the pool
//      is revealed only once the reels have settled;
//   3. turn store errors into toasts and route to /results after pick six.
//
// The server is the source of truth for GameState: every action here goes
// through `useGame()`, which POSTs and then stores whatever comes back.

import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate, useParams, Link } from "react-router";
import { api } from "../api";
import type { SkipKind } from "../api/types";
import { useGame } from "../state/GameContext";
import { useToast } from "../state/ToastContext";
import { useAsync } from "../lib/useAsync";
import { CATEGORY_LABELS, MODE_LABELS } from "../lib/labels";
import { Button } from "../components/ui/Button";
import { ErrorBanner } from "../components/ui/ErrorBanner";
import { PageLoader } from "../components/ui/Spinner";
import { SlotMachine } from "../components/play/SlotMachine";
import { SpinBanner } from "../components/play/SpinBanner";
import { CandidateToolbar } from "../components/play/CandidateToolbar";
import { ContenderGrid } from "../components/play/ContenderGrid";
import { BallotSidebar } from "../components/play/BallotSidebar";

/** Used until /api/meta answers; the reel needs a range to build its strip. */
const DEFAULT_YEARS = { min: 1927, max: 2025 };

export function PlayPage() {
  const { gameId = "" } = useParams();
  const navigate = useNavigate();
  const { push } = useToast();
  const {
    game,
    pending,
    candidates,
    sort,
    query,
    selectedId,
    error,
    spinSerial,
    loadGame,
    spin,
    skip,
    pick,
    setSort,
    setQuery,
    select,
    clearError,
  } = useGame();

  // /api/meta only supplies the year reel's range here, so a failure is not
  // fatal — the reel falls back to the full 1927-2025 span.
  const meta = useAsync(() => api.getMeta(), []);
  const yearRange = meta.data?.years ?? DEFAULT_YEARS;

  const [loadFailed, setLoadFailed] = useState(false);

  // Hydrate from the URL. Landing here from Home the game is already in the
  // store (createGame put it there), so this only fires on a reload or a
  // shared link.
  const currentId = game?.id ?? null;
  useEffect(() => {
    if (!gameId || currentId === gameId) return;
    setLoadFailed(false);
    void loadGame(gameId).then((g) => setLoadFailed(g === null));
  }, [gameId, currentId, loadGame]);

  // Store errors are transient action failures (a 409 from a spent skip, say);
  // the banner below is reserved for "we could not load this game at all".
  useEffect(() => {
    if (!error) return;
    push(error, "error");
    clearError();
  }, [error, push, clearError]);

  // A finished ballot has nothing to draft — send it straight to the results.
  useEffect(() => {
    if (game?.id === gameId && game.status === "complete") {
      navigate(`/results/${gameId}`, { replace: true });
    }
  }, [game?.id, game?.status, gameId, navigate]);

  // The reels own the reveal: `revealedSerial` catches up to `spinSerial` when
  // SlotMachine reports that the current spin has settled. A ref keeps the
  // callback stable so SlotMachine's settle effect does not re-fire.
  const spinSerialRef = useRef(spinSerial);
  spinSerialRef.current = spinSerial;
  const [revealedSerial, setRevealedSerial] = useState(0);
  const handleSettled = useCallback(() => {
    setRevealedSerial(spinSerialRef.current);
  }, []);

  const handleSkip = useCallback((kind: SkipKind) => void skip(kind), [skip]);

  const handleLockIn = useCallback(async () => {
    if (!selectedId) return;
    const next = await pick(selectedId);
    // The sixth pick flips the game to "complete"; the redirect effect above
    // would catch it too, but doing it here avoids a frame of empty grid.
    if (next?.status === "complete") navigate(`/results/${next.id}`);
  }, [selectedId, pick, navigate]);

  if (loadFailed) {
    return (
      <div className="mx-auto max-w-xl py-16">
        <ErrorBanner
          message={error ?? "That game could not be loaded."}
          onRetry={() => {
            setLoadFailed(false);
            void loadGame(gameId).then((g) => setLoadFailed(g === null));
          }}
        />
        <div className="mt-6 text-center">
          <Link to="/">
            <Button variant="secondary">Start a new game</Button>
          </Link>
        </div>
      </div>
    );
  }

  if (!game || game.id !== gameId) return <PageLoader label="Loading game" />;

  const picking = game.status === "picking";
  const busy = pending === "spinning" || pending === "skipping" || pending === "picking";
  // Only show the pool once the reels have stopped on this spin.
  const revealed = picking && revealedSerial >= spinSerial;

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-wrap items-baseline justify-between gap-3">
        <div>
          <p className="text-[11px] uppercase tracking-[0.3em] text-gold">
            {MODE_LABELS[game.mode].label}
            {game.seed && <span className="ml-2 text-muted">daily · {game.seed}</span>}
          </p>
          <h1 className="mt-1 text-2xl sm:text-3xl">Draft your ballot</h1>
        </div>
        <p className="text-xs text-ivory-dim">
          {game.picks.length} of 6 locked · next up{" "}
          <span className="text-ivory">
            {CATEGORY_LABELS[game.category_order[Math.min(game.round - 1, 5)]]}
          </span>
        </p>
      </header>

      <SlotMachine
        spin={game.current_spin}
        upcomingCategory={game.category_order[Math.min(game.round - 1, 5)] ?? null}
        status={game.status}
        spinSerial={spinSerial}
        yearRange={yearRange}
        canSpin={game.status === "spinning" && !busy}
        spinning={pending === "spinning"}
        onSpin={() => void spin()}
        onSettled={handleSettled}
      />

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <div className="flex flex-col gap-5">
          {picking && <SpinBanner game={game} disabled={busy} onSkip={handleSkip} />}

          {revealed ? (
            <>
              <CandidateToolbar
                mode={game.mode}
                query={query}
                sort={sort}
                count={candidates.length}
                onQuery={setQuery}
                onSort={setSort}
              />
              <ContenderGrid
                mode={game.mode}
                candidates={candidates}
                loading={pending === "candidates"}
                selectedId={selectedId}
                locking={pending === "picking"}
                onSelect={select}
                onLockIn={() => void handleLockIn()}
              />
            </>
          ) : (
            <p className="rounded-xl border border-dashed border-line px-6 py-16 text-center text-sm text-ivory-dim">
              {picking
                ? "Dealing the pool…"
                : "Spin the reels to see which year and category you have to fill."}
            </p>
          )}
        </div>

        <BallotSidebar game={game} />
      </div>
    </div>
  );
}
