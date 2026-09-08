// Application root: providers + router.
//
// Route map (docs/ARCHITECTURE.md, frontend section):
//   /                 Home        hero + the mode tiles, one click each
//   /modes            Modes       the game-mode menu, side by side (GET /api/modes)
//   /grid, /grid/:id  Grid        Six Degrees: board, clock, reveal
//   /chain, /chain/:id            The Chain: film to film, stopwatch, reveal
//   /recast, /recast/:id          Recast: film, cast list, shortlist, reveal
//   /play/:gameId     Play        slot machine, candidate grid, ballot
//   /results/:gameId  Results     season record, ceremonies, reveals
//   /leaderboard      Leaderboard daily vs all-time table
//   /analytics        Analytics   archetype scatter, prestige ranker, validation
//   /browse           Browse      unmasked catalog by year + category
import { Suspense, lazy } from "react";
import { HashRouter, Route, Routes } from "react-router";
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
// The Chain, the third side mode (docs/API.md, "The Chain").
import { ChainPage } from "./pages/Chain";
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

/*
 * Why HashRouter and not BrowserRouter
 * ------------------------------------
 * The site is on GitHub Pages, which serves static files and offers no
 * rewrites. With path routing, a deep link like /clean-sweep/chain is a file
 * that does not exist: Pages falls back to 404.html, and because that file is
 * a copy of index.html the app renders correctly while the response carries a
 * 404 status. It works and it is wrong, which is the worst combination. A
 * crawler, a link checker, a preview card fetcher or anything else that reads
 * the status rather than the body sees a broken page.
 *
 * A hash keeps the whole route on the client. The server is only ever asked
 * for /clean-sweep/, which exists, so every URL is a 200 and no fallback file
 * is doing load-bearing work.
 *
 * The cost, stated plainly: URLs gain a "#". /clean-sweep/chain becomes
 * /clean-sweep/#/chain. Links already shared in the old shape still work, but
 * only because public/redirect.js translates them; see that file.
 *
 * If this ever moves to a host with rewrite rules (Netlify, Cloudflare Pages,
 * or anything in front of the API), BrowserRouter becomes the better choice
 * again and this is the one line to change back.
 *
 * No basename: the hash is relative to whatever path serves index.html, so a
 * project subdirectory is handled by the server rather than the router.
 */

export default function App() {
  return (
    <HashRouter>
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
                  page (and its clock) survives that hop instead of being
                  torn down and rebuilt mid-request. */}
              <Route path="/grid/:gameId?" element={<GridPage />} />
              {/* Recast pairs its two paths for the same reason: "/recast"
                  starts a round and redirects to "/recast/:id", and matching
                  both here keeps the page, and the round it is holding,
                  alive across that hop. */}
              <Route path="/recast/:gameId?" element={<RecastPage />} />
              {/* The Chain pairs its two paths for the same reason as the two
                  above: "/chain" deals a pair of films and redirects to
                  "/chain/:id", and matching both here keeps the page, and the
                  stopwatch it is running, alive across that hop. */}
              <Route path="/chain/:gameId?" element={<ChainPage />} />
              <Route path="*" element={<NotFoundPage />} />
            </Route>
          </Routes>
        </GameProvider>
      </ToastProvider>
    </HashRouter>
  );
}
