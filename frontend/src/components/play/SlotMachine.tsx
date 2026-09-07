// SlotMachine: the reels at the top of Play — three year reels and a category
// reel.
//
// A round deals three years at once (docs/GAME_DESIGN.md §2), so the machine
// spins one reel per dealt year and each of them doubles as the control that
// chooses which year's pool the grid below is showing. A fourth control, "All
// years", pools every year on the board; it disappears once a reroll has cut
// the board down to a single year.
//
// Each <Reel> is a vertical strip of items ending on the one it lands on. When
// a new spin arrives (`spinSerial` changes) the strip is remounted at offset 0
// and then animated down to that last item, using the `reel` keyframes in
// src/index.css (~1.2s). With prefers-reduced-motion the strip jumps straight
// there. `onSettled` fires when every reel has stopped so the page can reveal
// the candidate grid only after the machine settles.
//
// The strips are built rather than enumerated: a year reel showing all 99
// eligible years four times over would be ~400 nodes *per reel*, and there are
// four reels. `buildStrip` keeps a few laps of sampled ticks and then lands on
// the real value, which looks identical in motion at a tenth of the DOM.

import { useEffect, useMemo, useRef, useState } from "react";
import type { Category, Spin } from "../../api/types";
import { CATEGORY_LABELS, CATEGORY_ORDER } from "../../lib/labels";
import { useReducedMotion } from "../../lib/useReducedMotion";
import { Button } from "../ui/Button";

const ITEM_HEIGHT = 64; // px, must match the h-16 below
const LAPS = 3; // full passes before settling
const DURATION_MS = 1200;
/** Items that whizz past in one lap of a reel. */
const TICKS_PER_LAP = 12;

interface Strip {
  items: string[];
  /** Index of the landing item, or null while the reel is parked. */
  target: number | null;
}

/**
 * `LAPS` laps of evenly-sampled `ticks`, then the value actually landed on.
 *
 * Sampling is safe because the passing items are pure motion — only the last
 * one is ever read, and it is the real value.
 */
function buildStrip(ticks: string[], landing: string | null): Strip {
  const step = Math.max(1, Math.ceil(ticks.length / TICKS_PER_LAP));
  const sampled = ticks.filter((_, i) => i % step === 0);
  if (landing === null) return { items: sampled, target: null };
  const items = [...Array.from({ length: LAPS }, () => sampled).flat(), landing];
  return { items, target: items.length - 1 };
}

interface ReelProps {
  strip: Strip;
  /** Bumped per spin so the reel restarts even if the target is the same. */
  serial: number;
  reduced: boolean;
  onEnd?: () => void;
  /** Gold ring: this reel's year is the one the grid is showing. */
  active?: boolean;
}

/** The drum itself. Selection chrome and captions belong to the callers. */
function Reel({ strip, serial, reduced, onEnd, active = false }: ReelProps) {
  const { items, target } = strip;
  const offset = target === null ? 0 : -target * ITEM_HEIGHT;

  return (
    <div
      className={`relative h-16 w-full overflow-hidden rounded-lg border bg-ink shadow-[inset_0_0_30px_rgba(0,0,0,0.9)] ${
        active ? "border-gold shadow-glow" : "border-gold/40"
      }`}
    >
      {/* Top / bottom shading to sell the drum shape. */}
      <div className="pointer-events-none absolute inset-x-0 top-0 z-10 h-4 bg-gradient-to-b from-ink to-transparent" />
      <div className="pointer-events-none absolute inset-x-0 bottom-0 z-10 h-4 bg-gradient-to-t from-ink to-transparent" />
      <div className="pointer-events-none absolute inset-y-0 left-0 z-10 w-0.5 bg-gold/50" />
      <div
        key={serial}
        className={target === null ? "" : reduced ? "" : "animate-reel"}
        style={
          {
            "--reel-target": `${offset}px`,
            transform: reduced || target === null ? `translateY(${offset}px)` : undefined,
            animationDuration: reduced ? "0ms" : `${DURATION_MS}ms`,
          } as React.CSSProperties
        }
        onAnimationEnd={onEnd}
      >
        {items.map((item, i) => (
          <div
            key={i}
            className={`flex h-16 items-center justify-center whitespace-nowrap px-2 font-display text-2xl ${
              active ? "text-gilded" : "text-ivory"
            }`}
            aria-hidden={i !== target}
          >
            {item}
          </div>
        ))}
      </div>
    </div>
  );
}

interface Props {
  spin: Spin | null;
  /** Category the next spin will land on, shown while idle. */
  upcomingCategory: Category | null;
  status: "spinning" | "picking" | "complete";
  spinSerial: number;
  yearRange: { min: number; max: number };
  canSpin: boolean;
  spinning: boolean;
  onSpin: () => void;
  /** Which year the grid is showing; `null` is the "all years" view. */
  viewYear: number | null;
  onViewYear: (year: number | null) => void;
  /** Called when the reels finish animating for the current spin. */
  onSettled: () => void;
}

export function SlotMachine({
  spin,
  upcomingCategory,
  status,
  spinSerial,
  yearRange,
  canSpin,
  spinning,
  onSpin,
  viewYear,
  onViewYear,
  onSettled,
}: Props) {
  const reduced = useReducedMotion();

  const years = useMemo(() => {
    const out: string[] = [];
    for (let y = yearRange.min; y <= yearRange.max; y++) out.push(String(y));
    return out;
  }, [yearRange.min, yearRange.max]);
  const categories = useMemo(() => CATEGORY_ORDER.map((c) => CATEGORY_LABELS[c]), []);

  // One parked strip shared by every idle reel, and the category strip.
  const idleYearStrip = useMemo(() => buildStrip(years, null), [years]);
  const categoryStrip = useMemo(
    () => buildStrip(categories, spin ? CATEGORY_LABELS[spin.category] : null),
    [categories, spin],
  );

  // While idle there is no board, but the machine still has to show *some*
  // reels: three blanks parked at offset 0, which is also what the next spin
  // will fill.
  const options = spin?.year_options ?? [];
  const reelCount = options.length > 0 ? options.length : 3;
  const multipleYears = options.length > 1;

  // Settle when every reel has finished. With reduced motion there is no
  // animationend event, so settle on the next tick instead.
  const ended = useRef(0);
  const [settledSerial, setSettledSerial] = useState(0);
  useEffect(() => {
    ended.current = 0;
    if (!spin) return;
    if (reduced) {
      const t = setTimeout(() => setSettledSerial(spinSerial), 0);
      return () => clearTimeout(t);
    }
    // Safety net in case animationend never fires (e.g. tab hidden).
    const t = setTimeout(() => setSettledSerial(spinSerial), DURATION_MS + 200);
    return () => clearTimeout(t);
  }, [spin, spinSerial, reduced]);

  useEffect(() => {
    if (settledSerial === spinSerial && spin) onSettled();
  }, [settledSerial, spinSerial, spin, onSettled]);

  // One category reel plus one reel per dealt year.
  const reelsToSettle = reelCount + 1;
  const onReelEnd = () => {
    ended.current += 1;
    if (ended.current >= reelsToSettle) setSettledSerial(spinSerial);
  };

  return (
    <section
      aria-label="Slot machine"
      className="rounded-2xl border border-line bg-gradient-to-b from-ink-3 to-ink-2 p-5 shadow-2xl sm:p-7"
    >
      <div className="flex flex-col gap-6 lg:flex-row lg:items-start lg:justify-center lg:gap-10">
        {/* ---- The years on the board ------------------------------- */}
        <div
          className="flex flex-col gap-2"
          role={spin && multipleYears ? "radiogroup" : undefined}
          aria-label={spin && multipleYears ? "Year to draft from" : undefined}
        >
          <div className="grid grid-cols-3 gap-2 sm:gap-3">
            {Array.from({ length: reelCount }, (_, i) => {
              const option = options[i] ?? null;
              const active = option !== null && option.year === viewYear;
              const label = option
                ? `${option.year}, ${option.decade}`
                : "Empty year reel";

              // Idle (no board yet): a plain, inert drum.
              if (!option || !spin) {
                return (
                  <div key={i} className="flex w-24 flex-col items-center gap-1.5 sm:w-28">
                    <Reel
                      strip={idleYearStrip}
                      serial={spinSerial}
                      reduced={reduced}
                      onEnd={onReelEnd}
                    />
                    <span className="text-[10px] uppercase tracking-[0.25em] text-muted">Year</span>
                  </div>
                );
              }

              const drum = (
                <>
                  <Reel
                    strip={buildStrip(years, String(option.year))}
                    serial={spinSerial}
                    reduced={reduced}
                    onEnd={onReelEnd}
                    active={active}
                  />
                  <span
                    className={`text-[10px] uppercase tracking-[0.25em] ${active ? "text-gold" : "text-muted"}`}
                  >
                    {option.decade}
                  </span>
                </>
              );

              // A board of one (after a reroll) has nothing to choose between,
              // so the drum is inert rather than a control that does nothing.
              if (!multipleYears) {
                return (
                  <div
                    key={i}
                    className="flex w-24 flex-col items-center gap-1.5 sm:w-28"
                    aria-label={label}
                  >
                    {drum}
                  </div>
                );
              }

              // Dealt: the drum is the control that selects the year. Radio
              // semantics (rather than a pressed button) say "one of these",
              // and keep the reels out of the grid's button roster.
              return (
                <button
                  key={i}
                  type="button"
                  role="radio"
                  aria-checked={active}
                  aria-label={label}
                  onClick={() => onViewYear(option.year)}
                  className="flex w-24 flex-col items-center gap-1.5 rounded-lg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gold sm:w-28"
                >
                  {drum}
                </button>
              );
            })}
          </div>

          {spin && multipleYears && (
            <button
              type="button"
              role="radio"
              aria-checked={viewYear === null}
              onClick={() => onViewYear(null)}
              className={`rounded-md border px-3 py-1.5 text-xs tracking-wide transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gold ${
                viewYear === null
                  ? "border-gold bg-gold/10 text-gold"
                  : "border-line text-ivory-dim hover:border-gold/50 hover:text-ivory"
              }`}
            >
              All years
            </button>
          )}

          {spin && !multipleYears && (
            <p className="text-center text-[10px] uppercase tracking-[0.2em] text-gold">
              {spin.locked ? "Locked to this year" : "One year on the board"}
            </p>
          )}
        </div>

        {/* ---- The category ----------------------------------------- */}
        <div className="flex w-full flex-col items-center gap-1.5 sm:w-72">
          <Reel
            strip={categoryStrip}
            serial={spinSerial}
            reduced={reduced}
            onEnd={onReelEnd}
          />
          <span className="text-[10px] uppercase tracking-[0.25em] text-muted">Category</span>
        </div>

        {/* ---- The lever -------------------------------------------- */}
        <div className="flex flex-col items-center gap-2">
          <Button
            size="lg"
            onClick={onSpin}
            disabled={!canSpin}
            loading={spinning}
            className="min-w-36"
            aria-label={status === "spinning" ? "Spin the reels" : "Reels are locked until you pick"}
          >
            {status === "spinning" ? "Spin" : "Locked"}
          </Button>
          {status === "spinning" && upcomingCategory && (
            <span className="text-[10px] uppercase tracking-[0.2em] text-muted">
              Next: {CATEGORY_LABELS[upcomingCategory]}
            </span>
          )}
        </div>
      </div>
    </section>
  );
}
