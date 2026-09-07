// Application root: providers + router.
//
// Route map (docs/ARCHITECTURE.md, frontend section):
//   /                 Home        hero, how to play, mode buttons
//   /play/:gameId     Play        slot machine, candidate grid, ballot
//   /results/:gameId  Results     season record, ceremonies, reveals
//   /leaderboard      Leaderboard daily vs all-time table
//   /analytics        Analytics   archetype scatter + prestige ranker
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
import { NotFoundPage } from "./pages/NotFound";
import { PageLoader } from "./components/ui/Spinner";

// Analytics is the only route that pulls in Recharts, and Recharts is roughly
// two thirds of the bundle. Loading it lazily keeps the charting library out
// of the entry chunk so the game itself starts fast; the Suspense fallback is
// the same loader the data-fetching pages already use.
const AnalyticsPage = lazy(() =>
  import("./pages/Analytics").then((m) => ({ default: m.AnalyticsPage })),
);

export default function App() {
  return (
    <BrowserRouter>
      <ToastProvider>
        <GameProvider>
          <Routes>
            <Route element={<AppShell />}>
              <Route path="/" element={<HomePage />} />
              <Route path="/play/:gameId" element={<PlayPage />} />
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
              <Route path="*" element={<NotFoundPage />} />
            </Route>
          </Routes>
        </GameProvider>
      </ToastProvider>
    </BrowserRouter>
  );
}
