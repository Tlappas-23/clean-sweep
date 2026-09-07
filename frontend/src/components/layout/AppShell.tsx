// AppShell: the persistent frame around every route — cinematic backdrop,
// top navigation, footer, and the toast stack. Pages render into <Outlet />.
//
// It also mounts <SiteDialogProvider>, which owns the How to Play and About
// dialogs. They live at this level for two reasons: the footer offers them on
// every route, and the landing page opens the rules for whichever mode the
// player is looking at, so a page below the shell has to be able to reach
// them (src/state/SiteDialogContext.tsx).

import { NavLink, Outlet, Link } from "react-router";
import { IS_MOCK } from "../../api";
import { SiteDialogProvider, useSiteDialogs } from "../../state/SiteDialogContext";
import { Toaster } from "../ui/Toaster";

// Home absorbed the mode menu: it now serves `GET /api/modes` itself and
// starts any of the three games in one click, which makes a separate "Modes"
// nav entry a second door to the same room. The /modes route still exists and
// still works — it is the fuller, side-by-side comparison of the three, and
// the results screens link to it — it simply is not the front door any more.
const NAV = [
  { to: "/", label: "Home", end: true },
  { to: "/browse", label: "Browse" },
  { to: "/leaderboard", label: "Leaderboard" },
  { to: "/analytics", label: "Analytics" },
];

export function AppShell() {
  return (
    <SiteDialogProvider>
      <div className="relative min-h-dvh">
        <div className="backdrop-cinema" aria-hidden />
        <header className="relative z-10 border-b border-line/60 bg-ink/70 backdrop-blur">
          <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-x-6 gap-y-2 px-4 py-3 sm:px-6">
            <Link to="/" className="flex items-baseline gap-2">
              <span className="font-display text-xl tracking-wide text-bone">Clean Sweep</span>
              <span className="hidden text-[10px] uppercase tracking-[0.3em] text-accent sm:inline">
                30–0
              </span>
            </Link>
            <nav aria-label="Primary" className="flex flex-wrap items-center gap-1 text-sm">
              {NAV.map((item) => (
                <NavLink
                  key={item.to}
                  to={item.to}
                  end={item.end}
                  className={({ isActive }) =>
                    `rounded-md px-3 py-1.5 transition-colors ${
                      isActive ? "text-accent" : "text-bone-dim hover:text-bone"
                    }`
                  }
                >
                  {item.label}
                </NavLink>
              ))}
            </nav>
          </div>
        </header>

        <main className="relative z-10 mx-auto w-full max-w-7xl px-4 py-8 sm:px-6">
          <Outlet />
        </main>

        <SiteFooter />
        <Toaster />
      </div>
    </SiteDialogProvider>
  );
}

/**
 * The quiet end of the page: two dialog links and one line of provenance.
 *
 * Split out from AppShell only because it needs `useSiteDialogs`, and the
 * provider it reads is mounted by AppShell itself — a component cannot
 * consume a context it renders.
 */
function SiteFooter() {
  const { openHowToPlay, openAbout } = useSiteDialogs();

  const linkClass =
    "text-[10px] uppercase tracking-[0.3em] text-muted underline decoration-line underline-offset-[6px] transition-colors hover:text-accent hover:decoration-accent/60 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-accent";

  return (
    <footer className="relative z-10 mt-20 border-t border-line/60 py-8">
      <div className="mx-auto flex max-w-7xl flex-col items-center gap-4 px-4">
        <nav aria-label="About this site" className="flex items-center gap-4">
          <button type="button" onClick={() => openHowToPlay()} className={linkClass}>
            How to play
          </button>
          <span aria-hidden className="text-line">
            ·
          </span>
          <button type="button" onClick={openAbout} className={linkClass}>
            About
          </button>
        </nav>
        <p className="text-xs text-muted">
          An unofficial fan project. Not affiliated with any awards organisation.
          {IS_MOCK && <span className="ml-2 text-accent/70">· mock data mode</span>}
        </p>
      </div>
    </footer>
  );
}
