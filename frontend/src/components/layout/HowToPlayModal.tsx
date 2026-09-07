// HowToPlayModal: the rules, one mode at a time.
//
// Opened from the footer on every page (src/components/layout/AppShell.tsx)
// and from the landing page, which passes the mode the player is currently
// looking at so the dialog opens on the right rules rather than on a default.
// State and mounting are owned by src/state/SiteDialogContext.tsx.
//
// The shape is a tab strip over four or five one-line steps, read from
// src/lib/modes.ts. The strip is a real ARIA tablist with roving tabindex —
// arrows move between modes, Tab leaves the strip — which is what a
// segmented control has to do to be usable without a mouse.

import { useId, type KeyboardEvent } from "react";
import { MODE_FALLBACK, MODE_IDS, MODE_NOTES, MODE_SCORING, MODE_STEPS, type ModeId } from "../../lib/modes";
import { Button } from "../ui/Button";
import { Icon } from "../ui/Icon";
import { Modal } from "../ui/Modal";

interface Props {
  open: boolean;
  mode: ModeId;
  onModeChange: (mode: ModeId) => void;
  onClose: () => void;
}

export function HowToPlayModal({ open, mode, onModeChange, onClose }: Props) {
  const baseId = useId();
  const tabId = (id: ModeId) => `${baseId}-tab-${id}`;
  const panelId = `${baseId}-panel`;

  /**
   * Arrow keys move selection; Home/End jump to the ends. The list wraps,
   * which is the expected behaviour for a tablist of this size.
   */
  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    const offset =
      event.key === "ArrowRight" ? 1 : event.key === "ArrowLeft" ? -1 : 0;
    let next: ModeId | null = null;
    if (offset !== 0) {
      const index = MODE_IDS.indexOf(mode);
      next = MODE_IDS[(index + offset + MODE_IDS.length) % MODE_IDS.length];
    } else if (event.key === "Home") {
      next = MODE_IDS[0];
    } else if (event.key === "End") {
      next = MODE_IDS[MODE_IDS.length - 1];
    }
    if (!next) return;
    event.preventDefault();
    onModeChange(next);
    // Selection and focus move together in a tablist. `getElementById` rather
    // than a scoped `querySelector` because React's generated ids contain
    // colons, which are not valid in a CSS selector without escaping.
    document.getElementById(tabId(next))?.focus();
  }

  const steps = MODE_STEPS[mode];
  const note = MODE_NOTES[mode];

  return (
    <Modal open={open} onClose={onClose} eyebrow="Clean Sweep" title="How to play">
      <div
        role="tablist"
        aria-label="Choose a mode"
        onKeyDown={onKeyDown}
        className="mb-6 flex rounded-full border border-line bg-ink p-1"
      >
        {MODE_IDS.map((id) => {
          const selected = id === mode;
          return (
            <button
              key={id}
              id={tabId(id)}
              type="button"
              role="tab"
              aria-selected={selected}
              aria-controls={panelId}
              // Roving tabindex: only the selected tab is in the Tab order,
              // so Tab moves past the whole strip in one press.
              tabIndex={selected ? 0 : -1}
              onClick={() => onModeChange(id)}
              className={[
                "flex-1 rounded-full px-3 py-2 text-[11px] uppercase tracking-[0.18em] transition-colors",
                "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent",
                selected
                  ? "bg-accent text-ink"
                  : "text-bone-dim hover:text-bone",
              ].join(" ")}
            >
              {MODE_FALLBACK[id].label}
            </button>
          );
        })}
      </div>

      <div id={panelId} role="tabpanel" aria-labelledby={tabId(mode)} tabIndex={-1}>
        <ol className="flex flex-col gap-4">
          {steps.map((step) => (
            <li key={step.text} className="flex gap-3">
              <Icon name={step.icon} className="mt-0.5 shrink-0 text-accent" />
              <span className="text-sm leading-relaxed text-bone-dim">{step.text}</span>
            </li>
          ))}
        </ol>

        <p className="mt-6 border-t border-line/70 pt-4 text-xs leading-relaxed text-bone-dim/80">
          <span className="text-accent/80">Scoring. </span>
          {MODE_SCORING[mode]}
        </p>
        {note && <p className="mt-2 text-xs leading-relaxed text-bone-dim/80">{note}</p>}
      </div>

      <Button className="mt-7 w-full" onClick={onClose}>
        Got it
      </Button>
    </Modal>
  );
}
