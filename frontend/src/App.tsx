// Application root: providers + router.
//
// Route map (docs/ARCHITECTURE.md, frontend section):
//   /                 Home        hero + the three modes, one click each
//   /modes            Modes       the game-mode menu, side by side (GET /api/modes)
//   /grid, /grid/:id  Grid        Six Degrees: board, clock, reveal
//   /recast, /recast/:id          Recast: film, cast list, shortlist, reveal
//   /play/:gameId     Play        slot machine, candidate grid, ballot
//   /results/:gameId  Results     season record, ceremonies, reveals
//   /leaderboard      Leaderboard daily vs all-time table
//   /analytics        Analytics   archetype scatter, prestige ranker, validation
//   /browse           Browse      unmasked catalog by year + category
import { Suspense, lazy } from "react";
import { BrowserRouter, Route, Routes } from "react-router";
import { GameProvider } from "./state/GameContext";
import { ToastProvider } from "./state/ToastContext";
import { AppShell } from "./components/layout/AppShell";
import { HomePage } from "./pages/Home";
import { PlayPage } from "./pages/Play";
import { ResultsPage } from "./pages/Results";
import { LeaderboardPage } from "./pages/Leaderboard";
import { BrowsePage } from "./pages/Browse";
// The mode menu and Six Degrees (docs/API.md, "Game modes").
import { ModesPage } from "./pages/Modes";
import { GridPage } from "./pages/Grid";
// Recast, the other side mode (docs/API.md, "Recast").
import { RecastPage } from "./pages/Recast";
import { NotFoundPage } from "./pages/NotFound";
import { PageLoader } from "./components/ui/Spinner";

// Analytics is the only route that pulls in Recharts, and Recharts is roughly
// two thirds of the bundle. Loading it lazily keeps the charting library out
// of the entry chunk so the game itself starts fast; the Suspense fallback is
// the same loader the data-fetching pages already use.
const AnalyticsPage = lazy(() =>
  import("./pages/Analytics").then((m) => ({ default: m.AnalyticsPage })),
);

/**
 * Where the app is mounted, for the router.
 *
 * Vite hands the build's `base` back as `BASE_URL` — "/" everywhere except a
 * GitHub Pages build, which is served from a project subdirectory. The router
 * wants that without its trailing slash, so "/clean-sweep/" becomes
 * "/clean-sweep" and "/" becomes "".
 */
const ROUTER_BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

export default function App() {
  return (
    <BrowserRouter basename={ROUTER_BASE}>
      <ToastProvider>
        <GameProvider>
          <Routes>
            <Route element={<AppShell />}>
              <Route path="/" element={<HomePage />} />
              <Route path="/play/:gameId?" element={<PlayPage />} />
              <Route path="/results/:gameId" element={<ResultsPage />} />
              <Route path="/leaderboard" element={<LeaderboardPage />} />
              <Route
                path="/analytics"
                element={
                  <Suspense fallback={<PageLoader />}>
                    <AnalyticsPage />
                  </Suspense>
                }
              />
              <Route path="/browse" element={<BrowsePage />} />
              <Route path="/modes" element={<ModesPage />} />
              {/* One route for both grid paths: "/grid" creates a board and
                  redirects to "/grid/:id", and matching them here means the
                  page — and its clock — survives that hop instead of being
                  torn down and rebuilt mid-request. */}
              <Route path="/grid/:gameId?" element={<GridPage />} />
              {/* Recast pairs its two paths for the same reason: "/recast"
                  starts a round and redirects to "/recast/:id", and matching
                  both here keeps the page — and the round it is holding —
                  alive across that hop. */}
              <Route path="/recast/:gameId?" element={<RecastPage />} />
              <Route path="*" element={<NotFoundPage />} />
            </Route>
          </Routes>
        </GameProvider>
      </ToastProvider>
    </BrowserRouter>
  );
}
