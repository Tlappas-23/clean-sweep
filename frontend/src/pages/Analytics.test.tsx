// Tests for the validation section of the analytics page (src/pages/Analytics.tsx).
//
// This is the section that justifies showing a model number to a player at
// all, so the assertions are about the argument surviving, not the layout:
// the verdict, the held-out interval, the permutation p-value, the leakage
// verdict and the baseline the model has to beat all have to reach the
// screen. If any of them silently stopped rendering, the page would still
// look fine and would no longer be evidence of anything.
//
// The report is fetched separately from the two model summaries and 404s in a
// checkout where `python -m ml.validate` has never run, so the friendly empty
// state is pinned here too.

import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import type { ValidationReport } from "../api/types";
import type { AsyncState } from "../lib/useAsync";
import { ValidationSection } from "./Analytics";

/** The numbers the committed artifact carries (data/models/validation.json). */
function reportOf(overrides: Partial<ValidationReport> = {}): ValidationReport {
  return {
    scope: "six Academy categories only; genre crowns excluded as circular",
    n_rows: 47_463,
    n_winners: 460,
    split: { train_below: 2019, n_train: 42_526, n_test: 4_937 },
    leakage_audit: {
      threshold: 0.9,
      n_features: 28,
      clean: true,
      strongest: [
        { feature: "billing", auc: 0.8105 },
        { feature: "metascore", auc: 0.7927 },
      ],
      suspected_leaks: [],
    },
    held_out_auc: { point: 0.8904, ci95: [0.8364, 0.9379], resamples: 2000, n_positives: 43 },
    permutation_test: {
      observed_auc: 0.8904,
      null_mean_auc: 0.4324,
      null_max_auc: 0.7008,
      null_sd: 0.0931,
      rounds: 199,
      p_value: 0.005,
      beats_null: true,
    },
    baselines: {
      model: { roc_auc: 0.8904, average_precision: 0.2009, n: 4_937 },
      "acclaim (IMDb rating percentile)": { roc_auc: 0.7923, average_precision: 0.0292, n: 4_937 },
      "top billing": { roc_auc: 0.5516, average_precision: 0.0251, n: 4_937 },
    },
    beats_best_baseline_by: 0.0981,
    verdict: "signal confirmed",
    ...overrides,
  };
}

/** A resolved `useAsync` state; the section only ever reads one of these. */
function stateOf(data: ValidationReport | null, error?: string, status?: number): AsyncState<ValidationReport> {
  return {
    data,
    loading: false,
    error: error ?? null,
    status: status ?? null,
    reload: vi.fn(),
  };
}

describe("ValidationSection", () => {
  it("leads with the verdict and the held-out interval", () => {
    render(<ValidationSection state={stateOf(reportOf())} />);

    expect(screen.getByText("signal confirmed")).toBeInTheDocument();

    // 0.890 appears in three places (headline, permutation, baselines), so
    // assert it in the one that is the page's claim.
    const headline = screen.getByText("Held-out ROC-AUC").parentElement;
    expect(headline).toHaveTextContent("0.890");
    // The interval is the honest half of that claim: 43 held-out winners
    // cannot support a bare point estimate.
    expect(headline).toHaveTextContent("95% CI 0.836–0.938");
  });

  it("reports the permutation test with its p-value and null distribution", () => {
    render(<ValidationSection state={stateOf(reportOf())} />);

    expect(screen.getByText("p = 0.005")).toBeInTheDocument();
    expect(screen.getByText("0.432")).toBeInTheDocument(); // null mean
    expect(screen.getByText("0.701")).toBeInTheDocument(); // best of 199 shuffles
    expect(screen.getByText(/199 times on shuffled winners/)).toBeInTheDocument();
  });

  it("passes or fails the leakage audit visibly, naming the strongest feature", () => {
    render(<ValidationSection state={stateOf(reportOf())} />);

    expect(screen.getByText("pass")).toBeInTheDocument();
    expect(screen.getByText("Billing")).toBeInTheDocument();
    expect(screen.getByText("0.81")).toBeInTheDocument();
    expect(screen.getByText("No suspected leaks.")).toBeInTheDocument();
  });

  it("fails the audit loudly when a feature is too strong on its own", () => {
    render(
      <ValidationSection
        state={stateOf(
          reportOf({
            leakage_audit: {
              threshold: 0.9,
              n_features: 28,
              clean: false,
              strongest: [{ feature: "won_last_year", auc: 0.97 }],
              suspected_leaks: [{ feature: "won_last_year", auc: 0.97 }],
            },
          }),
        )}
      />,
    );

    expect(screen.getByText("fail")).toBeInTheDocument();
    expect(screen.getByText("Suspected leaks: Won last year.")).toBeInTheDocument();
  });

  it("ranks the model against the named human baselines", () => {
    render(<ValidationSection state={stateOf(reportOf())} />);

    expect(screen.getByText("The ranker")).toBeInTheDocument();
    expect(screen.getByText("acclaim (IMDb rating percentile)")).toBeInTheDocument();
    expect(screen.getByText("0.792")).toBeInTheDocument();
    expect(screen.getByText("top billing")).toBeInTheDocument();
    expect(screen.getByText("0.552")).toBeInTheDocument();
  });

  it("shows the friendly empty state when the artifact was never built", () => {
    render(
      <ValidationSection state={stateOf(null, "Validation report has not been generated yet.", 404)} />,
    );

    expect(screen.getByText("No validation report yet")).toBeInTheDocument();
    expect(screen.queryByText("signal confirmed")).not.toBeInTheDocument();
  });
});
