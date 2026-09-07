// SlotMachine: the two-reel year / category machine at the top of Play.
//
// Each <Reel> is a vertical strip of items repeated several times. When a new
// spin arrives (`spinSerial` changes) the strip is remounted at offset 0 and
// then animated to the target item several laps down, using the `reel`
// keyframes in src/index.css (~1.2s). With prefers-reduced-motion the strip
// jumps straight to the target. `onSettled` fires when the animation ends so
// the page can reveal the candidate grid only after the reels stop.

import { useEffect, useMemo, useRef, useState } from "react";
import type { Category, Spin } from "../../api/types";
import { CATEGORY_LABELS, CATEGORY_ORDER, decadeOf } from "../../lib/labels";
import { useReducedMotion } from "../../lib/useReducedMotion";
import { Button } from "../ui/Button";

const ITEM_HEIGHT = 64; // px, must match the h-16 below
const LAPS = 3; // full passes before settling
const DURATION_MS = 1200;

interface ReelProps {
  items: string[];
  targetIndex: number | null;
  /** Bumped per spin so the reel restarts even if the target is the same. */
  serial: number;
  caption: string;
  reduced: boolean;
  onEnd?: () => void;
  wide?: boolean;
}

function Reel({ items, targetIndex, serial, caption, reduced, onEnd, wide }: ReelProps) {
  // Repeat the strip so we can scroll a few laps before landing.
  const strip = useMemo(() => Array.from({ length: LAPS + 1 }, () => items).flat(), [items]);
  const target = targetIndex === null ? null : LAPS * items.length + targetIndex;
  const offset = target === null ? 0 : -target * ITEM_HEIGHT;

  return (
    <div className={`flex flex-col items-center gap-2 ${wide ? "w-full sm:w-72" : "w-40"}`}>
      <div className="relative h-16 w-full overflow-hidden rounded-lg border border-gold/40 bg-ink shadow-[inset_0_0_30px_rgba(0,0,0,0.9)]">
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
          {strip.map((item, i) => (
            <div
              key={i}
              className="flex h-16 items-center justify-center whitespace-nowrap px-2 font-display text-2xl text-ivory"
              aria-hidden={i !== target}
            >
              {item}
            </div>
          ))}
        </div>
      </div>
      <span className="text-[10px] uppercase tracking-[0.25em] text-muted">{caption}</span>
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
  /** Called when the reels finish animating for the current spin. */
  onSettled: () => void;
}

export function SlotMachine({ spin, upcomingCategory, status, spinSerial, yearRange, canSpin, spinning, onSpin, onSettled }: Props) {
  const reduced = useReducedMotion();

  const years = useMemo(() => {
    const out: string[] = [];
    for (let y = yearRange.min; y <= yearRange.max; y++) out.push(String(y));
    return out;
  }, [yearRange.min, yearRange.max]);
  const categories = useMemo(() => CATEGORY_ORDER.map((c) => CATEGORY_LABELS[c]), []);

  const yearIndex = spin ? Math.max(0, years.indexOf(String(spin.year))) : null;
  const categoryIndex = spin ? CATEGORY_ORDER.indexOf(spin.category) : null;

  // Settle when both reels have finished. With reduced motion there is no
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

  const onReelEnd = () => {
    ended.current += 1;
    if (ended.current >= 2) setSettledSerial(spinSerial);
  };

  return (
    <section
      aria-label="Slot machine"
      className="rounded-2xl border border-line bg-gradient-to-b from-ink-3 to-ink-2 p-5 shadow-2xl sm:p-7"
    >
      <div className="flex flex-col items-center gap-6 sm:flex-row sm:justify-center sm:gap-10">
        <Reel
          items={years}
          targetIndex={yearIndex}
          serial={spinSerial}
          caption={spin ? decadeOf(spin.year) : "Year"}
          reduced={reduced}
          onEnd={onReelEnd}
        />
        <Reel
          items={categories}
          targetIndex={categoryIndex}
          serial={spinSerial}
          caption="Category"
          reduced={reduced}
          onEnd={onReelEnd}
          wide
        />
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
