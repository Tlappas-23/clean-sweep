// MaskedBoard: the board before it is dealt.
//
// The landing screen is the game, not a description of it, so what a visitor
// meets is the shape of a Six Degrees board with the six names still covered.
// It is a real 3x3 with real header tracks, drawn to the same grid template as
// GridBoard so pressing Start swaps one for the other without the layout
// jumping.
//
// Nothing here is fetched. No round exists yet, and creating one would start
// its three-minute clock against a player who has not agreed to play. That is
// the whole reason the names are placeholders rather than a real board with
// the text blurred: the alternative burns the round while somebody reads the
// rules.

interface Props {
  /** Dimmed and non-interactive while a board is being dealt. */
  busy?: boolean;
}

export function MaskedBoard({ busy = false }: Props) {
  return (
    <div
      // Presentational: it names nobody and answers nothing, so it is hidden
      // from assistive tech rather than announced as an empty nine-cell grid.
      aria-hidden
      className={`grid gap-1.5 transition-opacity duration-300 sm:gap-2 ${
        busy ? "opacity-40" : "opacity-100"
      }`}
      style={{
        // Identical to GridBoard, so the swap on Start is a reveal rather
        // than a reflow.
        gridTemplateColumns: "minmax(4.5rem, 1fr) repeat(3, minmax(0, 1.6fr))",
      }}
    >
      {/* Shorter than the live board's corner label. The header track is
          narrower on this screen, and "Name who connects them" wraps to four
          cramped lines in it; the full instruction is in the heading above
          anyway, so the corner only has to hold the column open. */}
      <div className="flex items-end justify-center pb-1 text-center text-[9px] uppercase leading-tight tracking-[0.2em] text-muted">
        Who
        <br />
        connects
      </div>

      {[0, 1, 2].map((i) => (
        <MaskedName key={`col-${i}`} orientation="column" index={i} />
      ))}

      {[0, 1, 2].map((row) => (
        <div key={`row-${row}`} className="contents">
          <MaskedName orientation="row" index={row + 3} />
          {[0, 1, 2].map((column) => (
            <div
              key={column}
              className="aspect-square rounded-lg border border-dashed border-line/70 bg-ink-2/40"
            />
          ))}
        </div>
      ))}
    </div>
  );
}

/**
 * A covered name.
 *
 * Two bars at the width a name and its casting-type label occupy, so the
 * header tracks are the height they will be once filled and the reveal does
 * not shove the board down the page. The stagger is by index rather than
 * random, so the shimmer reads as one object breathing rather than nine
 * things flickering.
 */
function MaskedName({ orientation, index }: { orientation: "row" | "column"; index: number }) {
  const isColumn = orientation === "column";
  return (
    <div
      className={[
        "flex flex-col gap-1.5 px-1",
        isColumn ? "items-center justify-end pb-1" : "items-start justify-center",
      ].join(" ")}
    >
      <span
        className="skeleton h-3 w-full max-w-[6.5rem] rounded"
        style={{ animationDelay: `${index * 120}ms` }}
      />
      <span
        className="skeleton h-2 w-2/3 max-w-[4.5rem] rounded"
        style={{ animationDelay: `${index * 120 + 60}ms` }}
      />
    </div>
  );
}
