// Analytics: what the two offline models learned. Route "/analytics".
//
// Reads the two model-summary endpoints (docs/ML.md, docs/API.md):
//   GET /api/analytics/clusters → ClusterSummary (archetype scatter)
//   GET /api/analytics/ranker   → RankerSummary  (prestige model report card)
//
// Both are optional artifacts: a checkout that has never run the training
// scripts answers 404, so each section degrades to its own EmptyState rather
// than failing the page. Charts are recharts; every colour comes from the
// palette in src/index.css so the charts match the rest of the app.

import { useMemo } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Line,
  LineChart,
  ResponsiveContainer,
  Scatter,
  ScatterChart,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { api } from "../api";
import type { ClusterSummary, RankerSummary } from "../api/types";
import { useAsync, type AsyncState } from "../lib/useAsync";
import { formatMetric, humanise } from "../lib/format";
import { Chip } from "../components/ui/Chip";
import { EmptyState } from "../components/ui/EmptyState";
import { ErrorBanner } from "../components/ui/ErrorBanner";
import { PageHeader } from "../components/ui/PageHeader";
import { PageLoader } from "../components/ui/Spinner";

/** Archetype series colours: gold-forward, then cool contrasts. Cycled if the
 *  clustering ever produces more labels than there are entries here. */
const SERIES_COLORS = [
  "#d4af37", // gold
  "#6fbf8a", // win green
  "#7fa6d9", // cool blue
  "#c25a4d", // loss red
  "#b892d9", // violet
  "#e8cf7a", // gold soft
  "#8fb8a8", // sage
];

/** Shared axis/grid styling so the three charts read as one family. */
const AXIS = { stroke: "#7d7565", fontSize: 11 } as const;
const GRID = "#2c2820";

const TOOLTIP_STYLE = {
  contentStyle: {
    background: "#14120e",
    border: "1px solid #2c2820",
    borderRadius: 8,
    fontSize: 12,
  },
  labelStyle: { color: "#b9b09c" },
  itemStyle: { color: "#f3ecdc" },
} as const;

export function AnalyticsPage() {
  const clusters = useAsync<ClusterSummary>(() => api.getClusters(), []);
  const ranker = useAsync<RankerSummary>(() => api.getRanker(), []);

  return (
    <div className="flex flex-col gap-14">
      <PageHeader
        eyebrow="Under the hood"
        title="Model analytics"
        lede="Two offline models feed the game: a k-means clustering that tags every film with an archetype, and a gradient-boosted ranker whose win probability becomes the Prestige metric. Neither runs on the request path — the API only serves their outputs."
      />

      <ArchetypeSection state={clusters} />
      <div className="rule-gold" aria-hidden />
      <RankerSection state={ranker} />
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Archetypes                                                          */
/* ------------------------------------------------------------------ */

function ArchetypeSection({ state }: { state: AsyncState<ClusterSummary> }) {
  const { data, loading, error, status, reload } = state;

  // One recharts <Scatter> series per archetype: that is what gives each
  // cluster its own colour and its own tooltip identity.
  const series = useMemo(() => {
    if (!data) return [];
    const order = data.archetypes.map((a) => a.label);
    const extra = [...new Set(data.points.map((p) => p.archetype))].filter(
      (label) => !order.includes(label),
    );
    return [...order, ...extra].map((label, i) => ({
      label,
      color: SERIES_COLORS[i % SERIES_COLORS.length],
      points: data.points.filter((p) => p.archetype === label),
      size: data.archetypes.find((a) => a.label === label)?.size ?? 0,
      examples: data.archetypes.find((a) => a.label === label)?.examples ?? [],
    }));
  }, [data]);

  return (
    <section aria-labelledby="archetypes">
      <h2 id="archetypes" className="text-3xl">
        Archetypes
      </h2>
      <p className="mt-2 max-w-2xl text-sm text-ivory-dim">
        Films are clustered on rating, vote volume, runtime and genre, then projected to two dimensions for this plot. Release year is deliberately left out: with it the clusters just rediscover the calendar. The labels are descriptive only — archetypes never affect scoring.
      </p>

      {loading && <PageLoader label="Loading clusters" />}
      {!loading && status === 404 && (
        <EmptyState title="No clustering model yet">
          {error ?? "Run the training scripts to generate the archetype model."} Until then, cards
          simply show no archetype badge.
        </EmptyState>
      )}
      {!loading && error && status !== 404 && <ErrorBanner message={error} onRetry={reload} />}

      {!loading && !error && data && (
        <div className="mt-6 grid gap-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
          <div className="rounded-xl border border-line bg-ink-2/70 p-4">
            <ResponsiveContainer width="100%" height={380}>
              <ScatterChart margin={{ top: 8, right: 12, bottom: 24, left: 0 }}>
                <CartesianGrid stroke={GRID} />
                <XAxis
                  type="number"
                  dataKey="x"
                  name="Component 1"
                  tick={AXIS}
                  axisLine={{ stroke: GRID }}
                  tickLine={false}
                  label={{ value: "Component 1", position: "insideBottom", offset: -12, fill: "#7d7565", fontSize: 11 }}
                />
                <YAxis
                  type="number"
                  dataKey="y"
                  name="Component 2"
                  tick={AXIS}
                  axisLine={{ stroke: GRID }}
                  tickLine={false}
                  width={44}
                />
                <Tooltip
                  {...TOOLTIP_STYLE}
                  cursor={{ stroke: GRID }}
                  // recharts hands the formatter a loosely typed value, so
                  // narrow it here rather than asserting a shape.
                  formatter={(value: unknown) =>
                    typeof value === "number" ? value.toFixed(2) : String(value ?? "")
                  }
                  labelFormatter={() => ""}
                />
                {series.map((s) => (
                  <Scatter key={s.label} name={s.label} data={s.points} fill={s.color} fillOpacity={0.75} />
                ))}
              </ScatterChart>
            </ResponsiveContainer>
          </div>

          {/* Legend doubles as the archetype glossary: colour, size, examples. */}
          <ul className="flex flex-col gap-3">
            {series.map((s) => (
              <li key={s.label} className="rounded-xl border border-line bg-ink-2/70 p-4">
                <div className="flex items-center justify-between gap-3">
                  <span className="flex items-center gap-2">
                    <span
                      aria-hidden
                      className="inline-block h-2.5 w-2.5 rounded-full"
                      style={{ background: s.color }}
                    />
                    <span className="text-ivory">{s.label}</span>
                  </span>
                  <span className="text-xs tabular-nums text-muted">
                    {s.size.toLocaleString()} films
                  </span>
                </div>
                {s.examples.length > 0 && (
                  <p className="mt-2 text-xs text-ivory-dim">{s.examples.join(" · ")}</p>
                )}
              </li>
            ))}
            <li className="text-xs text-muted">
              Clustered on: {data.features.map(humanise).join(", ")}.
            </li>
          </ul>
        </div>
      )}
    </section>
  );
}

/* ------------------------------------------------------------------ */
/* Prestige ranker                                                     */
/* ------------------------------------------------------------------ */

function RankerSection({ state }: { state: AsyncState<RankerSummary> }) {
  const { data, loading, error, status, reload } = state;

  return (
    <section aria-labelledby="ranker">
      <h2 id="ranker" className="text-3xl">
        Prestige ranker
      </h2>
      <p className="mt-2 max-w-2xl text-sm text-ivory-dim">
        A binary classifier over contender features: &ldquo;does this look like an Oscar winner?&rdquo;
        Its calibrated probability, scaled to 0&#8211;100, is the Prestige metric on every card.
      </p>

      {loading && <PageLoader label="Loading model report" />}
      {!loading && status === 404 && (
        <EmptyState title="No ranker model yet">
          {error ?? "Train the ranker to populate this report."} Prestige falls back to null on cards
          until it exists.
        </EmptyState>
      )}
      {!loading && error && status !== 404 && <ErrorBanner message={error} onRetry={reload} />}

      {!loading && !error && data && (
        <div className="mt-6 flex flex-col gap-6">
          <p className="text-xs uppercase tracking-[0.2em] text-muted">
            Model <span className="text-ivory-dim">{data.model}</span>
          </p>

          {/* Report-card tiles: two ranking metrics, one calibration metric,
              and the split sizes they were measured on. */}
          <dl className="grid gap-3 sm:grid-cols-3 lg:grid-cols-5">
            <MetricTile label="ROC-AUC" value={formatMetric(data.metrics.roc_auc, 3)} hint="Ranking quality: 0.5 is a coin flip." accent />
            <MetricTile label="Avg. precision" value={formatMetric(data.metrics.average_precision, 3)} hint="Area under precision-recall; winners are rare." />
            <MetricTile label="Brier" value={formatMetric(data.metrics.brier, 3)} hint="Squared probability error — lower is better." />
            <MetricTile label="Train rows" value={data.metrics.n_train.toLocaleString()} hint="Contenders used to fit the model." />
            <MetricTile label="Test rows" value={data.metrics.n_test.toLocaleString()} hint="Held-out contenders it was scored on." />
          </dl>

          <div className="grid gap-6 lg:grid-cols-2">
            <div className="rounded-xl border border-line bg-ink-2/70 p-4">
              <h3 className="mb-3 text-[11px] uppercase tracking-[0.25em] text-gold">
                Feature importances
              </h3>
              <ResponsiveContainer width="100%" height={Math.max(240, data.feature_importances.length * 26)}>
                <BarChart
                  layout="vertical"
                  data={data.feature_importances.map((f) => ({ ...f, label: humanise(f.feature) }))}
                  margin={{ top: 4, right: 16, bottom: 4, left: 8 }}
                >
                  <CartesianGrid stroke={GRID} horizontal={false} />
                  <XAxis type="number" tick={AXIS} axisLine={{ stroke: GRID }} tickLine={false} />
                  <YAxis
                    type="category"
                    dataKey="label"
                    width={130}
                    tick={AXIS}
                    axisLine={{ stroke: GRID }}
                    tickLine={false}
                  />
                  <Tooltip
                    {...TOOLTIP_STYLE}
                    cursor={{ fill: "rgba(212,175,55,0.08)" }}
                    formatter={(value: unknown) =>
                      typeof value === "number" ? value.toFixed(3) : String(value ?? "")
                    }
                  />
                  <Bar dataKey="importance" radius={[0, 3, 3, 0]}>
                    {/* The headline feature is gold; the rest recede. */}
                    {data.feature_importances.map((f, i) => (
                      <Cell key={f.feature} fill={i === 0 ? "#d4af37" : "#9a7b1f"} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>

            <div className="rounded-xl border border-line bg-ink-2/70 p-4">
              <h3 className="mb-3 text-[11px] uppercase tracking-[0.25em] text-gold">Calibration</h3>
              <ResponsiveContainer width="100%" height={300}>
                <LineChart data={data.calibration} margin={{ top: 8, right: 16, bottom: 24, left: 0 }}>
                  <CartesianGrid stroke={GRID} />
                  <XAxis
                    type="number"
                    dataKey="bin_mean_pred"
                    domain={[0, 1]}
                    tick={AXIS}
                    axisLine={{ stroke: GRID }}
                    tickLine={false}
                    label={{ value: "Predicted probability", position: "insideBottom", offset: -12, fill: "#7d7565", fontSize: 11 }}
                  />
                  <YAxis
                    type="number"
                    domain={[0, 1]}
                    tick={AXIS}
                    axisLine={{ stroke: GRID }}
                    tickLine={false}
                    width={44}
                  />
                  <Tooltip
                    {...TOOLTIP_STYLE}
                    formatter={(value: unknown, name: unknown) => [
                      typeof value === "number" ? value.toFixed(2) : String(value ?? ""),
                      name === "bin_frac_pos" ? "Observed" : "Perfect",
                    ]}
                    labelFormatter={(label: unknown) =>
                      `Predicted ${typeof label === "number" ? label.toFixed(2) : String(label ?? "")}`
                    }
                  />
                  {/* Plotting the x value against itself draws the y = x line
                      a perfectly calibrated model would follow. */}
                  <Line
                    type="linear"
                    dataKey="bin_mean_pred"
                    stroke="#7d7565"
                    strokeDasharray="4 4"
                    dot={false}
                    isAnimationActive={false}
                  />
                  <Line
                    type="monotone"
                    dataKey="bin_frac_pos"
                    stroke="#d4af37"
                    strokeWidth={2}
                    dot={{ r: 3, fill: "#d4af37" }}
                  />
                </LineChart>
              </ResponsiveContainer>
              <p className="mt-2 text-xs text-muted">
                Gold is the observed win rate per probability bin; the dashed line is perfect
                calibration. Above it the model is under-confident, below it over-confident.
              </p>
            </div>
          </div>

          <div className="flex flex-wrap gap-2">
            <Chip tone="gold">offline training</Chip>
            <Chip>scores baked into the seed</Chip>
            <Chip>no scikit-learn on the request path</Chip>
          </div>
        </div>
      )}
    </section>
  );
}

/** One number from the model report card. */
function MetricTile({
  label,
  value,
  hint,
  accent = false,
}: {
  label: string;
  value: string;
  hint: string;
  accent?: boolean;
}) {
  return (
    <div className="rounded-xl border border-line bg-ink-2/70 p-4" title={hint}>
      <dt className="text-[10px] uppercase tracking-[0.2em] text-muted">{label}</dt>
      <dd
        className={`mt-1 font-display text-2xl tabular-nums ${accent ? "text-gold" : "text-ivory"}`}
      >
        {value}
      </dd>
      <p className="mt-1 text-[11px] leading-snug text-ivory-dim">{hint}</p>
    </div>
  );
}
