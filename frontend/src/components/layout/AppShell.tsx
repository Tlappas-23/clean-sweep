// AppShell: the persistent frame around every route. Cinematic backdrop,
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
// starts any of the games in one click, which makes a separate "Modes"
// nav entry a second door to the same room. The /modes route still exists and
// still works. It is the fuller, side-by-side comparison of them, and
// the results screens link to it. It simply is not the front door any more.
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

        {IS_MOCK && <DemoNotice />}

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
 * The strip that says this build is not the real catalogue.
 *
 * The public demo is a static bundle on GitHub Pages with no backend behind
 * it, so it runs on the fixture data baked into `src/api/mock.ts`: a few
 * dozen films where the real thing has four thousand. Every rule is the same,
 * every score is computed the same way, but a player who is not told will
 * reasonably conclude the catalogue is thin rather than that they are looking
 * at a sample.
 *
 * So it says so, once, above the fold, on every route. It gives the numbers
 * rather than a vague "demo mode", because the gap is the whole point of the
 * notice. It is deliberately not dismissible: it is a standing fact about this
 * build, not an alert to acknowledge.
 */
function DemoNotice() {
  return (
    <div className="relative z-10 border-b border-accent/25 bg-accent/[0.07]">
      <p className="mx-auto flex max-w-7xl flex-wrap items-baseline justify-center gap-x-2 gap-y-1 px-4 py-2 text-center text-xs text-bone-dim sm:px-6">
        <span className="font-medium text-accent">Sample data.</span>
        <span>
          This demo runs entirely in your browser on a few dozen films. The full game plays
          4,180 films and 49,826 contenders from 1950 to 2025.
        </span>
        <a
          href="https://github.com/Tlappas-23/clean-sweep"
          target="_blank"
          rel="noreferrer"
          className="underline decoration-accent/40 underline-offset-2 transition-colors hover:text-accent"
        >
          Source and how to run it
        </a>
      </p>
    </div>
  );
}

/**
 * The quiet end of the page: two dialog links and one line of provenance.
 *
 * Split out from AppShell only because it needs `useSiteDialogs`, and the
 * provider it reads is mounted by AppShell itself, and a component cannot
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
        </p>
      </div>
    </footer>
  );
}
