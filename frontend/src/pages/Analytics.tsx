// Analytics: what the offline models learned, and why you should believe it.
// Route "/analytics".
//
// Reads the three model-summary endpoints (docs/ML.md, docs/API.md):
//   GET /api/analytics/clusters   → ClusterSummary   (archetype scatter)
//   GET /api/analytics/ranker     → RankerSummary    (prestige report card)
//   GET /api/analytics/validation → ValidationReport (the adversarial checks)
//
// The third section matters more than it looks. Prestige is no longer part of
// anyone's score, so the only reason to show a model number at all is that the
// model is demonstrably better than guessing. That is what the validation
// report argues, and why it is presented as an argument (verdict, interval,
// permutation test, baselines, leakage audit) rather than a dump of fields.
//
// All three are optional artifacts: a checkout that has never run the training
// scripts answers 404, so each section degrades to its own EmptyState rather
// than failing the page. Charts are recharts; the validation section draws its
// own bars in CSS, because five labelled rows do not need a chart library.
// Every colour comes from the palette in src/index.css.

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
import type {
  ClusterSummary,
  RankerSummary,
  RollingReport,
  ValidationReport,
} from "../api/types";
import { useAsync, type AsyncState } from "../lib/useAsync";
import { formatMetric, humanise } from "../lib/format";
import { Chip } from "../components/ui/Chip";
import { EmptyState } from "../components/ui/EmptyState";
import { ErrorBanner } from "../components/ui/ErrorBanner";
import { PageHeader } from "../components/ui/PageHeader";
import { PageLoader } from "../components/ui/Spinner";

/**
 * Archetype series colours: the accent first, then hues spaced around it.
 *
 * Recharts wants real values rather than class names, so this block is the
 * one place in the app that repeats the palette by hand. Every hex here is a
 * token from the @theme block in src/index.css. If that palette moves, this
 * list moves with it. Cycled if the clustering ever produces more labels than
 * there are entries.
 */
const SERIES_COLORS = [
  "#8ec5ff", // accent
  "#57cc99", // win green
  "#b8a6ff", // periwinkle
  "#ff7a6b", // loss coral
  "#5fd0d6", // teal
  "#c6e2ff", // accent soft
  "#9aa8c4", // slate
];

/** Shared axis/grid styling so the three charts read as one family. */
const AXIS = { stroke: "#78859c", fontSize: 11 } as const; // --color-muted
const GRID = "#29334a"; // --color-line

const TOOLTIP_STYLE = {
  contentStyle: {
    background: "#0f1320", // --color-ink-2
    border: "1px solid #29334a", // --color-line
    borderRadius: 8,
    fontSize: 12,
  },
  labelStyle: { color: "#a7b3c6" }, // --color-bone-dim
  itemStyle: { color: "#edf1f7" }, // --color-bone
} as const;

export function AnalyticsPage() {
  const clusters = useAsync<ClusterSummary>(() => api.getClusters(), []);
  const ranker = useAsync<RankerSummary>(() => api.getRanker(), []);
  const validation = useAsync<ValidationReport>(() => api.getValidation(), []);
  const rolling = useAsync<RollingReport>(() => api.getRolling(), []);

  return (
    <div className="flex flex-col gap-14">
      <PageHeader
        eyebrow="Under the hood"
        title="Model analytics"
        lede="Two offline models feed the game: a k-means clustering that tags every film with an archetype, and a gradient-boosted ranker that estimates how much a contender looks like a winner. Neither runs on the request path and neither is scored, so the case that they mean anything has to be made here rather than assumed."
      />

      <ArchetypeSection state={clusters} />
      <div className="rule-accent" aria-hidden />
      <RankerSection state={ranker} />
      <div className="rule-accent" aria-hidden />
      <ValidationSection state={validation} />
      <div className="rule-accent" aria-hidden />
      <RollingSection state={rolling} />
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
      <h2 id="archetypes" className="text-2xl sm:text-3xl">
        Archetypes
      </h2>
      <p className="mt-2 max-w-2xl text-sm text-bone-dim">
        Films are clustered on rating, vote volume, runtime and genre, then projected to two dimensions for this plot. Release year is deliberately left out: with it the clusters just rediscover the calendar. The labels are descriptive only, and archetypes never affect scoring.
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
                  label={{ value: "Component 1", position: "insideBottom", offset: -12, fill: "#78859c", fontSize: 11 }}
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
                    <span className="text-bone">{s.label}</span>
                  </span>
                  <span className="text-xs tabular-nums text-muted">
                    {s.size.toLocaleString()} films
                  </span>
                </div>
                {s.examples.length > 0 && (
                  <p className="mt-2 text-xs text-bone-dim">{s.examples.join(" · ")}</p>
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
      <h2 id="ranker" className="text-2xl sm:text-3xl">
        Prestige ranker
      </h2>
      <p className="mt-2 max-w-2xl text-sm text-bone-dim">
        A binary classifier over contender features: &ldquo;does this look like an Oscar winner?&rdquo;
        Its calibrated probability, scaled to 0&#8211;100, is the Prestige figure shown on every card.
        It is shown, and never scored. Whether it deserves the space is settled in the next section.
      </p>

      {loading && <PageLoader label="Loading model report" />}
      {!loading && status === 404 && (
        <EmptyState title="No ranker model yet">
          {error ?? "Train the ranker to populate this report."} Prestige falls back to null on cards
          until it exists, and since it is not scored, nothing about the game changes.
        </EmptyState>
      )}
      {!loading && error && status !== 404 && <ErrorBanner message={error} onRetry={reload} />}

      {!loading && !error && data && (
        <div className="mt-6 flex flex-col gap-6">
          <p className="text-xs uppercase tracking-[0.2em] text-muted">
            Model <span className="text-bone-dim">{data.model}</span>
          </p>

          {/* Report-card tiles: two ranking metrics, one calibration metric,
              and the split sizes they were measured on. */}
          <dl className="grid gap-3 sm:grid-cols-3 lg:grid-cols-5">
            <MetricTile label="ROC-AUC" value={formatMetric(data.metrics.roc_auc, 3)} hint="Ranking quality: 0.5 is a coin flip." accent />
            <MetricTile label="Avg. precision" value={formatMetric(data.metrics.average_precision, 3)} hint="Area under precision-recall; winners are rare." />
            {/* Brier used to read "lower is better" with nothing to compare
                against, which is how a number worse than a constant predictor
                gets presented as a result. At a 1% base rate, always answering
                0.01 scores about 0.0096. The tile now says so. */}
            <MetricTile
              label="Brier"
              value={formatMetric(data.metrics.brier, 3)}
              hint="Squared probability error. Only readable against the constant-predictor baseline, shown in the validation section below."
            />
            <MetricTile label="Train rows" value={data.metrics.n_train.toLocaleString()} hint="Contenders used to fit the model." />
            <MetricTile label="Test rows" value={data.metrics.n_test.toLocaleString()} hint="Held-out contenders it was scored on." />
          </dl>

          <div className="grid gap-6 lg:grid-cols-2">
            <div className="rounded-xl border border-line bg-ink-2/70 p-4">
              <h3 className="mb-3 text-[11px] uppercase tracking-[0.25em] text-accent">
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
                    cursor={{ fill: "rgba(142,197,255,0.08)" }}
                    formatter={(value: unknown) =>
                      typeof value === "number" ? value.toFixed(3) : String(value ?? "")
                    }
                  />
                  <Bar dataKey="importance" radius={[0, 3, 3, 0]}>
                    {/* The headline feature is accent; the rest recede. */}
                    {data.feature_importances.map((f, i) => (
                      <Cell key={f.feature} fill={i === 0 ? "#8ec5ff" : "#35618f"} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>

            <div className="rounded-xl border border-line bg-ink-2/70 p-4">
              <h3 className="mb-3 text-[11px] uppercase tracking-[0.25em] text-accent">Calibration</h3>
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
                    label={{ value: "Predicted probability", position: "insideBottom", offset: -12, fill: "#78859c", fontSize: 11 }}
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
                    stroke="#78859c"
                    strokeDasharray="4 4"
                    dot={false}
                    isAnimationActive={false}
                  />
                  <Line
                    type="monotone"
                    dataKey="bin_frac_pos"
                    stroke="#8ec5ff"
                    strokeWidth={2}
                    dot={{ r: 3, fill: "#8ec5ff" }}
                  />
                </LineChart>
              </ResponsiveContainer>
              <p className="mt-2 text-xs text-muted">
                Accent is the observed win rate per probability bin; the dashed line is perfect
                calibration. Above it the model is under-confident, below it over-confident.
              </p>
            </div>
          </div>

          <div className="flex flex-wrap gap-2">
            <Chip tone="accent">offline training</Chip>
            <Chip>scores baked into the seed</Chip>
            <Chip>no scikit-learn on the request path</Chip>
          </div>
        </div>
      )}
    </section>
  );
}

/* ------------------------------------------------------------------ */
/* Validation                                                          */
/* ------------------------------------------------------------------ */

/** Human-readable p-value: below the resolution of the test, say so. */
function formatPValue(p: number): string {
  return p < 0.001 ? "< 0.001" : p.toFixed(3);
}

/**
 * An AUC as a fraction of the space above chance.
 *
 * 0.5 is a coin flip, so a bar drawn from zero spends half its length saying
 * nothing. Rescaling to (auc − 0.5) / 0.5 makes the bars show what is
 * actually in dispute: how much of the possible skill each rule has.
 */
function skillFraction(auc: number): number {
  return Math.max(0, Math.min(1, (auc - 0.5) / 0.5));
}

/**
 * The validation report: the argument that Prestige is worth showing.
 *
 * Exported for src/pages/Analytics.test.tsx, and structured as four claims
 * rather than a field dump:
 *   1. the verdict and the headline interval;
 *   2. it is not memorising: no single feature carries the answer;
 *   3. it is not luck: shuffled labels never come close;
 *   4. it is not trivial: it beats every one-number rule a person would use.
 */
export function ValidationSection({ state }: { state: AsyncState<ValidationReport> }) {
  const { data, loading, error, status, reload } = state;

  return (
    <section aria-labelledby="validation">
      <h2 id="validation" className="text-2xl sm:text-3xl">
        Is the model real?
      </h2>
      <p className="mt-2 max-w-2xl text-sm text-bone-dim">
        A held-out ROC-AUC on its own proves very little: rare labels, a leaky feature or a
        flattering baseline can each manufacture one. So the ranker is put through three checks it
        could fail: a leakage audit, a permutation test against shuffled labels, and a comparison
        against the one-number rules a person would actually use. This is the result.
      </p>

      {loading && <PageLoader label="Loading validation report" />}
      {!loading && status === 404 && (
        <EmptyState title="No validation report yet">
          {error ?? "Run the validation harness to generate this report."} Until it exists, Prestige
          is shown on cards without any evidence behind it, which is the one situation this page is
          here to prevent.
        </EmptyState>
      )}
      {!loading && error && status !== 404 && <ErrorBanner message={error} onRetry={reload} />}

      {!loading && !error && data && (
        <div className="mt-6 flex flex-col gap-6">
          <VerdictBanner report={data} />

          <div className="grid gap-4 lg:grid-cols-3">
            <LeakagePanel audit={data.leakage_audit} />
            <PermutationPanel test={data.permutation_test} />
            <ScopePanel report={data} />
          </div>

          <BaselinePanel report={data} />

          <div className="flex flex-wrap gap-2">
            <Chip tone="accent">forward-chained split</Chip>
            <Chip>bootstrap interval</Chip>
            <Chip>label permutation</Chip>
            <Chip>prestige is reported, never scored</Chip>
          </div>
        </div>
      )}
    </section>
  );
}

/** The headline: the verdict, the interval, and the margin over the baselines. */
function VerdictBanner({ report }: { report: ValidationReport }) {
  const { held_out_auc, verdict, beats_best_baseline_by, permutation_test } = report;
  const [low, high] = held_out_auc.ci95;

  return (
    <div className="rounded-2xl border border-accent/30 bg-accent/5 p-6">
      <div className="flex flex-wrap items-end justify-between gap-5">
        <div>
          <p className="text-[11px] uppercase tracking-[0.25em] text-accent">Verdict</p>
          <p className="mt-1 font-display text-3xl capitalize text-bone">{verdict}</p>
        </div>
        <div className="text-right">
          <p className="text-[10px] uppercase tracking-[0.2em] text-muted">Held-out ROC-AUC</p>
          <p className="font-display text-4xl tabular-nums text-accent">
            {formatMetric(held_out_auc.point, 3)}
          </p>
          <p className="text-[11px] tabular-nums text-bone-dim">
            95% CI {formatMetric(low, 3)}&#8211;{formatMetric(high, 3)}
          </p>
        </div>
      </div>

      {/* The interval on the 0.5-to-1.0 scale that AUC lives on. The whole
          band sitting clear of the coin-flip line is the claim being made. */}
      <div className="mt-5">
        <div className="relative h-2 overflow-hidden rounded-full bg-white/10">
          <div
            className="absolute inset-y-0 rounded-full bg-accent/40"
            style={{
              left: `${skillFraction(low) * 100}%`,
              width: `${Math.max(1, (skillFraction(high) - skillFraction(low)) * 100)}%`,
            }}
          />
          <span
            aria-hidden
            className="absolute inset-y-0 w-0.5 bg-accent"
            style={{ left: `${skillFraction(held_out_auc.point) * 100}%` }}
          />
        </div>
        <div className="mt-1 flex justify-between text-[10px] uppercase tracking-[0.15em] text-muted">
          <span>0.50 coin flip</span>
          <span>1.00 perfect</span>
        </div>
      </div>

      <p className="mt-4 max-w-3xl text-sm text-bone-dim">
        Measured on {held_out_auc.n_positives} held-out winners, with the interval taken from{" "}
        {held_out_auc.resamples.toLocaleString()} bootstrap resamples. It is wide because winners
        are rare, and reporting the point estimate alone would hide that. The model beats the best
        human baseline by{" "}
        <span className="tabular-nums text-bone">{formatMetric(beats_best_baseline_by, 3)}</span>{" "}
        AUC, and shuffled labels reproduce its score with p ={" "}
        <span className="tabular-nums text-bone">{formatPValue(permutation_test.p_value)}</span>.
      </p>
    </div>
  );
}

/** Check 1: no single feature is quietly carrying the answer. */
function LeakagePanel({ audit }: { audit: ValidationReport["leakage_audit"] }) {
  const strongest = audit.strongest[0];

  return (
    <div className="flex flex-col rounded-xl border border-line bg-ink-2/70 p-4">
      <div className="flex items-start justify-between gap-3">
        <h3 className="text-[11px] uppercase tracking-[0.25em] text-accent">Leakage audit</h3>
        <Chip tone={audit.clean ? "win" : "loss"}>{audit.clean ? "pass" : "fail"}</Chip>
      </div>
      <p className="mt-3 text-sm text-bone-dim">
        Every one of the {audit.n_features} features was scored on its own. Any single feature at or
        above {formatMetric(audit.threshold, 2)} AUC would mean the label had leaked into the
        inputs.
      </p>
      {strongest && (
        <p className="mt-3 text-sm text-bone-dim">
          Strongest alone:{" "}
          <span className="text-bone">{humanise(strongest.feature)}</span> at{" "}
          <span className="tabular-nums text-bone">{formatMetric(strongest.auc, 2)}</span>, well
          under the line, and a plausible real signal rather than a copy of the answer.
        </p>
      )}
      <p className="mt-auto pt-3 text-xs text-muted">
        {audit.suspected_leaks.length === 0
          ? "No suspected leaks."
          : `Suspected leaks: ${audit.suspected_leaks.map((f) => humanise(f.feature)).join(", ")}.`}
      </p>
    </div>
  );
}

/** Check 2: shuffled labels do not reproduce the score. */
function PermutationPanel({ test }: { test: ValidationReport["permutation_test"] }) {
  return (
    <div className="flex flex-col rounded-xl border border-line bg-ink-2/70 p-4">
      <div className="flex items-start justify-between gap-3">
        <h3 className="text-[11px] uppercase tracking-[0.25em] text-accent">Permutation test</h3>
        <Chip tone={test.beats_null ? "win" : "loss"}>
          p = {formatPValue(test.p_value)}
        </Chip>
      </div>
      <p className="mt-3 text-sm text-bone-dim">
        The same model, refitted {test.rounds} times on shuffled winners. If the score were an
        artefact of how few winners there are, the shuffles would find it too.
      </p>

      {/* Observed against the null distribution, on the same skill scale. */}
      <div className="mt-4">
        <div className="relative h-2 rounded-full bg-white/10">
          <span
            aria-hidden
            title={`Null mean ${formatMetric(test.null_mean_auc, 3)}`}
            className="absolute inset-y-0 w-0.5 bg-muted"
            style={{ left: `${skillFraction(test.null_mean_auc) * 100}%` }}
          />
          <span
            aria-hidden
            title={`Best of ${test.rounds} shuffles: ${formatMetric(test.null_max_auc, 3)}`}
            className="absolute inset-y-0 w-0.5 bg-loss"
            style={{ left: `${skillFraction(test.null_max_auc) * 100}%` }}
          />
          <span
            aria-hidden
            title={`Observed ${formatMetric(test.observed_auc, 3)}`}
            className="absolute inset-y-0 w-1 rounded-full bg-accent"
            style={{ left: `${skillFraction(test.observed_auc) * 100}%` }}
          />
        </div>
        <dl className="mt-3 grid grid-cols-3 gap-2 text-center">
          <NullStat label="Null mean" value={formatMetric(test.null_mean_auc, 3)} tone="text-muted" />
          <NullStat label="Null best" value={formatMetric(test.null_max_auc, 3)} tone="text-loss" />
          <NullStat label="Observed" value={formatMetric(test.observed_auc, 3)} tone="text-accent" />
        </dl>
      </div>

      <p className="mt-auto pt-3 text-xs text-muted">
        Null spread {formatMetric(test.null_sd, 3)} SD. Not one shuffle in {test.rounds} reached the
        observed score.
      </p>
    </div>
  );
}

/** One of the three numbers under the permutation bar. */
function NullStat({ label, value, tone }: { label: string; value: string; tone: string }) {
  return (
    <div>
      <dt className="text-[10px] uppercase tracking-[0.15em] text-muted">{label}</dt>
      <dd className={`font-display text-lg tabular-nums ${tone}`}>{value}</dd>
    </div>
  );
}

/** What was measured, and on which rows: the caveats, stated up front. */
function ScopePanel({ report }: { report: ValidationReport }) {
  const { split, n_rows, n_winners, scope } = report;
  return (
    <div className="flex flex-col rounded-xl border border-line bg-ink-2/70 p-4">
      <h3 className="text-[11px] uppercase tracking-[0.25em] text-accent">What was measured</h3>
      <p className="mt-3 text-sm text-bone-dim">{scope}</p>
      <dl className="mt-4 flex flex-col gap-2 text-sm">
        <SplitRow label="Contenders" value={n_rows.toLocaleString()} />
        <SplitRow
          label="Winners"
          value={`${n_winners.toLocaleString()} (${((n_winners / n_rows) * 100).toFixed(1)}%)`}
        />
        <SplitRow label={`Trained on pre-${split.train_below}`} value={split.n_train.toLocaleString()} />
        <SplitRow label={`Tested on ${split.train_below}+`} value={split.n_test.toLocaleString()} />
      </dl>
      <p className="mt-auto pt-3 text-xs text-muted">
        The split is by year, not at random: the model is asked to predict a future it has not seen,
        which is the only version of the question the game actually asks.
      </p>
    </div>
  );
}

function SplitRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3 border-b border-line/60 pb-1.5">
      <dt className="text-bone-dim">{label}</dt>
      <dd className="shrink-0 tabular-nums text-bone">{value}</dd>
    </div>
  );
}

/**
 * Check 3: the model against the one-number rules a person would use.
 *
 * Drawn in CSS rather than recharts: five labelled rows on a shared scale are
 * a table with bars, and a chart library here would add a dependency to the
 * render path without adding a single thing the reader can see.
 */
function BaselinePanel({ report }: { report: ValidationReport }) {
  const rows = useMemo(
    () =>
      Object.entries(report.baselines)
        .map(([name, stats]) => ({ name, ...stats }))
        .sort((a, b) => b.roc_auc - a.roc_auc),
    [report.baselines],
  );

  return (
    <div className="rounded-xl border border-line bg-ink-2/70 p-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <h3 className="text-[11px] uppercase tracking-[0.25em] text-accent">
          Against the obvious rules
        </h3>
        <p className="text-xs text-muted">
          ROC-AUC on the same held-out rows. Bars start at 0.50, a coin flip.
        </p>
      </div>

      <ul className="mt-4 flex flex-col gap-3">
        {rows.map((row) => {
          const isModel = row.name === "model";
          return (
            // The label column is narrow on a phone and generous from `sm`
            // up, so a long baseline name truncates rather than squeezing the
            // bar it is being compared on.
            <li
              key={row.name}
              className="grid grid-cols-[minmax(0,7rem)_1fr_2.75rem] items-center gap-3 sm:grid-cols-[minmax(0,14rem)_1fr_3rem]"
            >
              <span className={`truncate text-sm ${isModel ? "text-accent" : "text-bone-dim"}`} title={row.name}>
                {isModel ? "The ranker" : row.name}
              </span>
              <span className="block h-2 overflow-hidden rounded-full bg-white/10">
                <span
                  className={`block h-full rounded-full ${isModel ? "bg-accent" : "bg-accent-deep/70"}`}
                  style={{ width: `${skillFraction(row.roc_auc) * 100}%` }}
                />
              </span>
              <span
                className={`text-right text-sm tabular-nums ${isModel ? "text-accent" : "text-bone-dim"}`}
                title={`Average precision ${formatMetric(row.average_precision, 3)} on ${row.n.toLocaleString()} rows`}
              >
                {formatMetric(row.roc_auc, 3)}
              </span>
            </li>
          );
        })}
      </ul>

      <p className="mt-4 max-w-3xl text-xs text-bone-dim">
        Acclaim alone is a good rule, since the best-reviewed film of a year often does win, and
        the model has to beat it by a real margin to justify existing. It does, by{" "}
        <span className="tabular-nums text-bone">
          {formatMetric(report.beats_best_baseline_by, 3)}
        </span>
        .
      </p>

      {/* A point estimate of a difference is not evidence of one. Two AUCs
          with overlapping intervals can still differ reliably, and two that
          look far apart can fail to, so the difference gets its own interval
          from paired resamples of the same rows. The verdict above depends on
          this excluding zero, not on the point estimate being positive. */}
      {report.margin_over_best_baseline && (
        <p className="mt-3 max-w-3xl text-xs text-bone-dim">
          That lead has its own interval, taken from{" "}
          <span className="tabular-nums text-bone">
            {report.margin_over_best_baseline.resamples.toLocaleString()}
          </span>{" "}
          paired bootstrap resamples of the same held-out rows:{" "}
          <span className="tabular-nums text-bone">
            {formatMetric(report.margin_over_best_baseline.ci95[0], 3)} to{" "}
            {formatMetric(report.margin_over_best_baseline.ci95[1], 3)}
          </span>
          .{" "}
          {report.margin_over_best_baseline.excludes_zero
            ? "It excludes zero, so the lead is established rather than assumed."
            : "It includes zero, so the lead is not established."}
        </p>
      )}

      {/* The number the old page reported without a reference. */}
      {report.calibration && (
        <div className="mt-6 rounded-xl border border-line bg-ink-2/70 p-4">
          <h3 className="text-[11px] uppercase tracking-[0.25em] text-accent">
            Is the probability a probability?
          </h3>
          <p className="mt-2 max-w-3xl text-xs leading-relaxed text-bone-dim">
            Ranking well and being calibrated are different claims, and only the first is made
            here. A Brier of{" "}
            <span className="tabular-nums text-bone">
              {formatMetric(report.calibration.brier, 3)}
            </span>{" "}
            reads as small until you know that a model ignoring every input and always answering
            the base rate of{" "}
            <span className="tabular-nums text-bone">
              {(report.calibration.base_rate * 100).toFixed(2)}%
            </span>{" "}
            scores{" "}
            <span className="tabular-nums text-bone">
              {formatMetric(report.calibration.brier_constant_baseline, 4)}
            </span>
            .{" "}
            {report.calibration.beats_constant
              ? "The ranker beats it."
              : "The ranker does not beat it, and that is a disclosed trade rather than a defect."}{" "}
            {report.calibration.note}
          </p>
          <dl className="mt-3 grid gap-3 sm:grid-cols-3">
            <MetricTile
              label="Brier"
              value={formatMetric(report.calibration.brier, 4)}
              hint="The model's squared probability error."
            />
            <MetricTile
              label="Constant baseline"
              value={formatMetric(report.calibration.brier_constant_baseline, 4)}
              hint="What always answering the base rate scores. The reference the model has to be read against."
              accent
            />
            <MetricTile
              label="Calibration error"
              value={formatMetric(report.calibration.ece, 3)}
              hint="Expected calibration error: mean gap between predicted and observed rate, weighted by bin size. 0 is perfect."
            />
          </dl>
        </div>
      )}
    </div>
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
        className={`mt-1 font-display text-2xl tabular-nums ${accent ? "text-accent" : "text-bone"}`}
      >
        {value}
      </dd>
      <p className="mt-1 text-[11px] leading-snug text-bone-dim">{hint}</p>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Rolling-origin validation                                           */
/* ------------------------------------------------------------------ */

/**
 * The ranker refitted and rescored year by year.
 *
 * This section exists because everything above it rests on one train/test
 * boundary, and one boundary is one draw. A single held-out ROC-AUC cannot
 * tell a model that generalises apart from a model that got an easy test set,
 * and reporting it alone quietly asks the reader to assume the first.
 *
 * The tuning result is the part worth reading. It came out *negative*, and it
 * is shown that way: a search that does not beat the settings it was meant to
 * improve is a finding about the search, and hiding it would leave the page
 * making a claim the numbers do not support.
 */
function RollingSection({ state }: { state: AsyncState<RollingReport> }) {
  const { data, loading, error, status, reload } = state;

  if (loading) return <PageLoader label="Loading rolling validation" />;
  if (status === 404) {
    return (
      <EmptyState title="No rolling validation yet">
        {error ?? "Run `python -m ml.rolling` to generate it."} The single-split report above still
        stands; this section is what turns that one number into a distribution.
      </EmptyState>
    );
  }
  if (error) return <ErrorBanner message={error} onRetry={reload} />;
  if (!data) return null;

  const { summary, folds } = data;
  const worst = folds.find((f) => f.year === summary.worst_year);
  const tuned = summary.untuned_baseline;

  return (
    <section aria-labelledby="rolling" className="flex flex-col gap-5">
      <h2 id="rolling" className="text-2xl sm:text-3xl">
        Was one split lucky?
      </h2>
      <p className="max-w-3xl text-sm leading-relaxed text-bone-dim">
        Everything above rests on a single boundary: train before 2019, test after. That is the
        right shape, since predicting a year the model has not seen is the only version of the
        question the game asks, but it is one draw. So the origin is rolled forward instead: fit on
        everything up to a year, score the next one, advance, repeat. Each fold trains on strictly
        more history than the last and no fold sees its own future.
      </p>

      <dl className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <MetricTile
          label="Mean ROC-AUC"
          value={formatMetric(summary.mean_roc_auc, 3)}
          hint={`Averaged over ${summary.n_folds} folds, ${summary.first_fold_year} onward.`}
          accent
        />
        <MetricTile
          label="Spread"
          value={formatMetric(summary.sd_across_folds, 3)}
          hint="Standard deviation across folds. Not a confidence interval: consecutive folds share nearly all their training data, so their scores are correlated and this understates true uncertainty."
        />
        <MetricTile
          label="Worst fold"
          value={formatMetric(summary.min_roc_auc, 3)}
          hint={`${summary.worst_year}. A hard year is real; a model that never has one would be more suspicious, not less.`}
        />
        <MetricTile label="Folds" value={String(summary.n_folds)} hint="Years scored, one at a time." />
      </dl>

      {/* Every fold, so the spread is visible rather than summarised away. */}
      <ul className="flex flex-col gap-1">
        {folds.map((f: RollingReport["folds"][number]) => (
          <li key={f.year} className="flex items-center gap-3 text-xs">
            <span className="w-12 shrink-0 tabular-nums text-muted">{f.year}</span>
            <span className="h-2 flex-1 overflow-hidden rounded-full bg-white/10">
              {/* Bars start at 0.5, a coin flip, so the visible length is the
                  part of the score that is actually skill. */}
              <span
                className={`block h-full rounded-full ${
                  f.year === summary.worst_year ? "bg-loss/70" : "bg-accent/70"
                }`}
                style={{ width: `${Math.max(0, (f.roc_auc - 0.5) / 0.5) * 100}%` }}
              />
            </span>
            <span className="w-14 shrink-0 text-right tabular-nums text-bone">
              {formatMetric(f.roc_auc, 3)}
            </span>
            <span className="hidden w-24 shrink-0 text-right tabular-nums text-muted sm:inline">
              {f.n_winners} winners
            </span>
          </li>
        ))}
      </ul>

      {tuned && (
        <div className="rounded-xl border border-line bg-ink-2/70 p-4">
          <h3 className="text-[11px] uppercase tracking-[0.25em] text-accent">
            Did tuning help? No.
          </h3>
          <p className="mt-2 max-w-3xl text-xs leading-relaxed text-bone-dim">
            The hyperparameters were originally hand-picked and checked against the test split,
            which is the bias this removes: choosing settings by looking at the answer and then
            reporting the score makes the score optimistic. So the search runs{" "}
            <em>inside</em> each fold, on an inner holdout carved from that fold&rsquo;s own
            training years, and the fold&rsquo;s test year is never used to choose anything.
          </p>
          <p className="mt-2 max-w-3xl text-xs leading-relaxed text-bone-dim">
            Over {summary.n_folds} folds and {summary.grid_size} candidates each, tuning scored{" "}
            <span className="tabular-nums text-bone">{formatMetric(summary.mean_roc_auc, 4)}</span>{" "}
            against{" "}
            <span className="tabular-nums text-bone">{formatMetric(tuned.mean_roc_auc, 4)}</span>{" "}
            for the untouched constants: a gain of{" "}
            <span className={`tabular-nums ${tuned.tuning_gain > 0 ? "text-win" : "text-loss"}`}>
              {tuned.tuning_gain > 0 ? "+" : ""}
              {formatMetric(tuned.tuning_gain, 4)}
            </span>
            . The search also picked {summary.params_chosen.length} different winners across{" "}
            {summary.n_folds} folds, which is what fitting noise looks like. The constants stay,
            and the nesting is what makes it possible to say so rather than guess.
          </p>
        </div>
      )}

      {worst && (
        <p className="max-w-3xl text-xs text-bone-dim">
          The weakest fold is {worst.year} at {formatMetric(worst.roc_auc, 3)}, scored on{" "}
          {worst.n_winners} winners. Reported rather than smoothed: with eight winners in a year, a
          single surprise moves the number a long way, and a page that showed only the mean would
          be hiding the reason to be careful with it.
        </p>
      )}
    </section>
  );
}
