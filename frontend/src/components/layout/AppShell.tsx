// AppShell: the persistent frame around every route — cinematic backdrop,
// top navigation, footer, and the toast stack. Pages render into <Outlet />.
import { NavLink, Outlet, Link } from "react-router";
import { IS_MOCK } from "../../api";
import { Toaster } from "../ui/Toaster";

const NAV = [
  { to: "/", label: "Home", end: true },
  { to: "/browse", label: "Browse" },
  { to: "/leaderboard", label: "Leaderboard" },
  { to: "/analytics", label: "Analytics" },
];

export function AppShell() {
  return (
    <div className="relative min-h-dvh">
      <div className="backdrop-cinema" aria-hidden />
      <header className="relative z-10 border-b border-line/60 bg-ink/70 backdrop-blur">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-6 px-4 py-3 sm:px-6">
          <Link to="/" className="flex items-baseline gap-2">
            <span className="font-display text-xl tracking-wide text-ivory">Clean Sweep</span>
            <span className="hidden text-[10px] uppercase tracking-[0.3em] text-gold sm:inline">30–0</span>
          </Link>
          <nav aria-label="Primary" className="flex items-center gap-1 text-sm">
            {NAV.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.end}
                className={({ isActive }) =>
                  `rounded-md px-3 py-1.5 transition-colors ${
                    isActive ? "text-gold" : "text-ivory-dim hover:text-ivory"
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

      <footer className="relative z-10 mt-16 border-t border-line/60 py-6 text-center text-xs text-muted">
        <p>
          An Oscar-ballot drafting game in the spirit of 82-0.
          {IS_MOCK && <span className="ml-2 text-gold/70">· mock data mode</span>}
        </p>
      </footer>
      <Toaster />
    </div>
  );
}
