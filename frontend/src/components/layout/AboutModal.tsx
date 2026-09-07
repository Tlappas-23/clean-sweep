// AboutModal: what this is, what it is not, and where the data came from.
//
// Opened from the footer on every page (src/components/layout/AppShell.tsx);
// state and mounting are owned by src/state/SiteDialogContext.tsx.
//
// This dialog is the project's only legal surface, so two rules govern it:
//
//   1. The disclaimer has to be unambiguous. Clean Sweep trades entirely on
//      real awards records and real film credits, and nothing about it may
//      imply that the Academy or any other awards body had a hand in it.
//
//   2. The attribution lines are quoted, not paraphrased. TMDB and IMDb both
//      specify the exact sentence a consumer must display, and the strings
//      below are those sentences verbatim — no smart quotes, no linkified
//      URL splitting the text node, no "and" joining them into a list. If you
//      are tempted to reword one, don't; src/components/layout/SiteDialogs.test.tsx
//      asserts both of them character for character.

import { Button } from "../ui/Button";
import { Modal } from "../ui/Modal";

/**
 * Required attribution strings, exactly as their providers word them.
 *
 * Exported so the test can assert against the same constants the dialog
 * renders, which means a reworded line fails the suite rather than quietly
 * shipping.
 */
export const TMDB_ATTRIBUTION =
  "This product uses the TMDB API but is not endorsed or certified by TMDB.";

export const IMDB_ATTRIBUTION =
  "Information courtesy of IMDb (https://www.imdb.com). Used with permission.";

interface Props {
  open: boolean;
  onClose: () => void;
}

export function AboutModal({ open, onClose }: Props) {
  return (
    <Modal open={open} onClose={onClose} eyebrow="Clean Sweep" title="About">
      <div className="flex flex-col gap-4 text-sm leading-relaxed text-bone-dim">
        <p>
          Clean Sweep is an unofficial fan project, built out of an interest in how film awards
          actually shake out. It is not affiliated with, authorised by or endorsed by the Academy
          of Motion Picture Arts and Sciences, or by any other film awards organisation. Film
          titles, the names of cast and crew, and awards records appear here for identification and
          commentary only.
        </p>

        <section>
          <h3 className="mb-2 text-[10px] uppercase tracking-[0.35em] text-accent/80">Data</h3>
          <ul className="flex flex-col gap-2 text-xs leading-relaxed text-bone-dim/80">
            {/* Verbatim, per the TMDB terms of use. */}
            <li>{TMDB_ATTRIBUTION}</li>
            {/* Verbatim, per the IMDb non-commercial licensing terms. The URL
                stays plain text: linking it would split the required sentence
                across elements. */}
            <li>{IMDB_ATTRIBUTION}</li>
            <li>
              Rotten Tomatoes and Metascore figures are retrieved through the OMDb API.
            </li>
            <li>
              Awards records come from the public DLu/oscar_data dataset.
            </li>
          </ul>
        </section>

        <p className="text-xs leading-relaxed text-bone-dim/80">
          Box-office figures shown as estimates are estimates: where no measured worldwide gross
          exists, the figure is inferred from comparable films and is marked wherever it appears.
          Estimates are never scored.
        </p>

        <p className="text-xs leading-relaxed text-bone-dim/80">
          This is a personal, non-commercial project. Nothing on it is for sale, and no advertising
          runs against it.
        </p>
      </div>

      <Button className="mt-7 w-full" onClick={onClose}>
        Close
      </Button>
    </Modal>
  );
}
