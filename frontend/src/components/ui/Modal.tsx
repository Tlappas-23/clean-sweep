// Modal: the one dialog primitive for the app.
//
// Lives in src/components/ui alongside Button and Chip because it is a shape,
// not a screen: the How to Play and About surfaces (src/components/layout)
// supply the content, this file supplies the behaviour every dialog owes a
// keyboard and a screen reader.
//
// What it guarantees:
//   * `role="dialog"` + `aria-modal="true"`, named by its own <h2>;
//   * three ways out: the corner button, a click on the backdrop, Escape;
//   * focus moves into the panel on open, is trapped inside it while open,
//     and is handed back to whatever opened the dialog on close;
//   * the page behind it cannot scroll;
//   * `prefers-reduced-motion` suppresses the entrance animation (the CSS
//     guard in src/index.css already neutralises it, but the class is dropped
//     here as well so the element never even carries an animation).
//
// It renders through a portal into <body> so a dialog is never clipped by an
// ancestor's `overflow` and never inherits a stacking context from the page
// that opened it.

import { useCallback, useEffect, useId, useRef, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { useReducedMotion } from "../../lib/useReducedMotion";

interface Props {
  open: boolean;
  onClose: () => void;
  /** Small letterspaced line above the title. Decorative. */
  eyebrow?: string;
  /** Names the dialog: rendered as the <h2> and referenced by aria-labelledby. */
  title: string;
  children: ReactNode;
}

/**
 * Everything inside `root` that can take focus, in document order.
 *
 * `:not([disabled])` and the negative-tabindex filter matter because the
 * dialogs contain disabled buttons (an unbuilt mode) and roving-tabindex tab
 * strips, both of which would otherwise become dead stops in the Tab cycle.
 */
const FOCUSABLE =
  'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

function focusableWithin(root: HTMLElement | null): HTMLElement[] {
  if (!root) return [];
  return Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE));
}

export function Modal({ open, onClose, eyebrow, title, children }: Props) {
  const panelRef = useRef<HTMLDivElement>(null);
  const reduced = useReducedMotion();
  const titleId = useId();

  // `onClose` is usually an inline arrow from the caller, so it changes on
  // every render. Holding it in a ref keeps the effect below keyed on `open`
  // alone. Otherwise the listener would be torn down and reinstalled (and
  // focus restored) on every parent render.
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  const close = useCallback(() => closeRef.current(), []);

  useEffect(() => {
    if (!open) return;

    // Remember who opened us so focus can go back there on close. This is the
    // footer link, and losing it would dump the user at the top of the page.
    const opener = document.activeElement as HTMLElement | null;
    // Focus the panel itself rather than its first control: a screen reader
    // then announces the dialog and its title before the player is dropped
    // on a button, and a plain Tab still steps to the first control because
    // the panel precedes its children in document order.
    panelRef.current?.focus();

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        close();
        return;
      }
      if (event.key !== "Tab") return;

      // Focus trap: wrap at both ends of the panel's own tab order.
      const items = focusableWithin(panelRef.current);
      if (items.length === 0) {
        event.preventDefault();
        panelRef.current?.focus();
        return;
      }
      const first = items[0];
      const last = items[items.length - 1];
      const active = document.activeElement;
      const outside = !panelRef.current?.contains(active);
      // Focus sits on the panel itself the moment the dialog opens. Going
      // backwards from there has to wrap to the last control; going forwards
      // needs no help, since the browser's own next stop is already `first`.
      if (event.shiftKey && (active === first || active === panelRef.current || outside)) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && (active === last || outside)) {
        event.preventDefault();
        first.focus();
      }
    }

    document.addEventListener("keydown", onKeyDown, true);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    return () => {
      document.removeEventListener("keydown", onKeyDown, true);
      document.body.style.overflow = previousOverflow;
      opener?.focus?.();
    };
  }, [open, close]);

  if (!open) return null;

  return createPortal(
    // The backdrop is the click target for "dismiss": comparing target to
    // currentTarget means a click that started inside the panel (a drag
    // across text that ends on the backdrop) does not close the dialog.
    <div
      className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto bg-ink/80 p-4 backdrop-blur-sm"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) close();
      }}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        className={[
          "relative w-full max-w-lg rounded-2xl border border-line bg-ink-2 p-6 shadow-[0_30px_80px_rgba(0,0,0,0.7)]",
          "outline-none sm:p-8",
          reduced ? "" : "animate-rise",
        ].join(" ")}
      >
        <button
          type="button"
          onClick={close}
          aria-label="Close"
          className="absolute right-4 top-4 rounded-md p-1 text-lg leading-none text-muted transition-colors hover:text-bone focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
        >
          <span aria-hidden>×</span>
        </button>

        <header className="mb-5 pr-8">
          {eyebrow && (
            <p className="mb-1 text-[10px] uppercase tracking-[0.35em] text-accent/80">{eyebrow}</p>
          )}
          <h2 id={titleId} className="text-2xl leading-tight text-bone">
            {title}
          </h2>
        </header>

        {children}
      </div>
    </div>,
    document.body,
  );
}
