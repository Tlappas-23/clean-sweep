// Leaderboard: submitted ballots, ranked. Route "/leaderboard" (src/App.tsx).
//
// Two scopes over the same endpoint (GET /api/leaderboard):
//   "daily"    ?seed=<today, local time> — comparable runs, identical spins
//   "all-time" no seed — every submitted game
// The server already returns rows sorted (wins, then ballot strength), so the
// page renders them in the order it receives them.

import { useState } from "react";
import { Link } from "react-router";
import { api } from "../api";
import type { LeaderboardEntry } from "../api/types";
import { useAsync } from "../lib/useAsync";
import { formatDate, formatRecord, todaySeed } from "../lib/format";
import { MODE_LABELS } from "../lib/labels";
import { Button } from "../components/ui/Button";
import { Chip } from "../components/ui/Chip";
import { EmptyState } from "../components/ui/EmptyState";
import { ErrorBanner } from "../components/ui/ErrorBanner";
import { PageHeader } from "../components/ui/PageHeader";
import { PageLoader } from "../components/ui/Spinner";

type Scope = "daily" | "all-time";

const ROW_LIMIT = 50;

export function LeaderboardPage() {
  const [scope, setScope] = useState<Scope>("daily");
  const seed = todaySeed();

  const { data, loading, error, reload } = useAsync<LeaderboardEntry[]>(
    () => api.getLeaderboard(scope === "daily" ? { seed, limit: ROW_LIMIT } : { limit: ROW_LIMIT }),
    [scope, seed],
  );

  return (
    <div>
      <PageHeader
        eyebrow="Leaderboard"
        title={scope === "daily" ? "Today's challenge" : "All time"}
        lede={
          scope === "daily"
            ? `Everyone who played the ${seed} daily drew the same spins, so these records are directly comparable.`
            : "Every submitted ballot, seeded or not, ranked by ceremonies won and then by ballot strength."
        }
        actions={
          <div
            role="group"
            aria-label="Leaderboard scope"
            className="flex rounded-md border border-line p-0.5"
          >
            {(["daily", "all-time"] as Scope[]).map((s) => (
              <button
                key={s}
                type="button"
                aria-pressed={scope === s}
                onClick={() => setScope(s)}
                className={`rounded px-3 py-1.5 text-xs uppercase tracking-wider transition-colors ${
                  scope === s ? "bg-gold/15 text-gold" : "text-ivory-dim hover:text-ivory"
                }`}
              >
                {s === "daily" ? "Daily" : "All time"}
              </button>
            ))}
          </div>
        }
      />

      {loading && <PageLoader label="Loading scores" />}

      {!loading && error && <ErrorBanner message={error} onRetry={reload} />}

      {!loading && !error && data && data.length === 0 && (
        <EmptyState
          title={scope === "daily" ? "No one has finished today's daily yet" : "No scores yet"}
          action={
            <Link to="/">
              <Button>Be the first</Button>
            </Link>
          }
        >
          Complete a ballot and submit it from the results screen to appear here.
        </EmptyState>
      )}

      {!loading && !error && data && data.length > 0 && (
        <div className="overflow-x-auto rounded-xl border border-line">
          <table className="w-full min-w-[38rem] border-collapse text-sm">
            <caption className="sr-only">
              {scope === "daily" ? `Scores for the ${seed} daily challenge` : "All-time scores"}
            </caption>
            <thead>
              <tr className="border-b border-line bg-ink-3 text-left text-[10px] uppercase tracking-[0.2em] text-ivory-dim">
                <th scope="col" className="px-4 py-3 font-normal">
                  #
                </th>
                <th scope="col" className="px-4 py-3 font-normal">
                  Player
                </th>
                <th scope="col" className="px-4 py-3 font-normal">
                  Mode
                </th>
                <th scope="col" className="px-4 py-3 text-right font-normal">
                  Record
                </th>
                <th scope="col" className="px-4 py-3 text-right font-normal">
                  Strength
                </th>
                <th scope="col" className="px-4 py-3 text-right font-normal">
                  Played
                </th>
              </tr>
            </thead>
            <tbody>
              {data.map((entry, i) => (
                <tr
                  key={entry.id}
                  className={`border-b border-line/50 last:border-0 ${
                    entry.clean_sweep ? "bg-gold/5" : ""
                  }`}
                >
                  <td className="px-4 py-3 font-display tabular-nums text-muted">{i + 1}</td>
                  <td className="px-4 py-3">
                    <span className="text-ivory">{entry.player_name}</span>
                    {entry.clean_sweep && (
                      <Chip tone="gold" className="ml-2">
                        Clean sweep
                      </Chip>
                    )}
                    {/* On the all-time board the seed says which daily it was. */}
                    {scope === "all-time" && entry.seed && (
                      <span className="ml-2 text-[11px] text-muted">daily {entry.seed}</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-ivory-dim">{MODE_LABELS[entry.mode].label}</td>
                  <td className="px-4 py-3 text-right font-display tabular-nums text-ivory">
                    {formatRecord(entry.wins, 30 - entry.wins)}
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums text-ivory-dim">
                    {entry.ballot_strength}
                  </td>
                  <td className="px-4 py-3 text-right text-xs text-muted">
                    {formatDate(entry.created_at)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
