// `SiteDialogProvider` + `useSiteDialogs`: the two site-wide dialogs, How to
// Play and About.
//
// They are shell furniture rather than page state, and the footer opens them
// from every route (src/components/layout/AppShell.tsx), so one provider
// mounts both once, near the root, instead of each page carrying its own copy
// and its own boolean.
//
// The one piece of state worth explaining is `howToPlayMode`. The rules
// dialog is per-mode, and it remembers which mode it was last showing, so a
// player who opens it from the landing page sees the mode they were looking
// at rather than always landing on the Oscars. `openHowToPlay(mode)` sets it;
// `openHowToPlay()` leaves it where it was.

import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";
import { MODE_IDS, type ModeId } from "../lib/modes";
import { AboutModal } from "../components/layout/AboutModal";
import { HowToPlayModal } from "../components/layout/HowToPlayModal";

export interface SiteDialogStore {
  /** Open the rules, optionally jumping straight to a mode's tab. */
  openHowToPlay(mode?: ModeId): void;
  openAbout(): void;
}

const SiteDialogContext = createContext<SiteDialogStore | null>(null);

/** Only one of the two can be open at a time, so this is one slot, not two. */
type OpenDialog = "how-to-play" | "about" | null;

export function SiteDialogProvider({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState<OpenDialog>(null);
  const [howToPlayMode, setHowToPlayMode] = useState<ModeId>(MODE_IDS[0]);

  const close = useCallback(() => setOpen(null), []);

  const store = useMemo<SiteDialogStore>(
    () => ({
      openHowToPlay(mode) {
        if (mode) setHowToPlayMode(mode);
        setOpen("how-to-play");
      },
      openAbout() {
        setOpen("about");
      },
    }),
    [],
  );

  return (
    <SiteDialogContext.Provider value={store}>
      {children}
      <HowToPlayModal
        open={open === "how-to-play"}
        mode={howToPlayMode}
        onModeChange={setHowToPlayMode}
        onClose={close}
      />
      <AboutModal open={open === "about"} onClose={close} />
    </SiteDialogContext.Provider>
  );
}

// eslint-disable-next-line react-refresh/only-export-components -- hook + provider belong together
export function useSiteDialogs(): SiteDialogStore {
  const store = useContext(SiteDialogContext);
  if (!store) throw new Error("useSiteDialogs must be used inside <SiteDialogProvider>");
  return store;
}
