"""
Analytics schemas (``app.models.analytics``).

These mirror the JSON files the ML step writes to ``data/models``
(``cluster_summary.json`` and ``ranker_metrics.json``). The API validates
the files against these models before serving them so a drift between the
training scripts and the contract is caught loudly rather than passed on to
the frontend. Extra keys in the files are ignored.
"""

from __future__ import annotations

from pydantic import BaseModel, ConfigDict, Field


class Archetype(BaseModel):
    model_config = ConfigDict(extra="ignore")

    label: str
    size: int
    centroid: dict[str, float]
    examples: list[str]


class ClusterPoint(BaseModel):
    """One film in the 2-D PCA projection used for the scatter plot."""

    model_config = ConfigDict(extra="ignore")

    film_id: str
    title: str
    year: int
    x: float
    y: float
    archetype: str


class ClusterSummary(BaseModel):
    model_config = ConfigDict(extra="ignore")

    archetypes: list[Archetype]
    points: list[ClusterPoint]
    features: list[str]


class RankerMetrics(BaseModel):
    model_config = ConfigDict(extra="ignore")

    roc_auc: float
    average_precision: float
    brier: float
    n_train: int
    n_test: int


class FeatureImportance(BaseModel):
    model_config = ConfigDict(extra="ignore")

    feature: str
    importance: float


class CalibrationBin(BaseModel):
    model_config = ConfigDict(extra="ignore")

    bin_mean_pred: float
    bin_frac_pos: float
    count: int


class RankerSummary(BaseModel):
    model_config = ConfigDict(extra="ignore")

    model: str
    metrics: RankerMetrics
    feature_importances: list[FeatureImportance]
    calibration: list[CalibrationBin]


class LeakageAudit(BaseModel):
    model_config = ConfigDict(extra="ignore")

    threshold: float
    n_features: int
    clean: bool
    strongest: list[dict]
    suspected_leaks: list[dict]


class HeldOutAuc(BaseModel):
    model_config = ConfigDict(extra="ignore")

    point: float
    ci95: list[float]
    resamples: int
    n_positives: int


class PermutationTest(BaseModel):
    model_config = ConfigDict(extra="ignore")

    observed_auc: float
    null_mean_auc: float
    null_max_auc: float
    null_sd: float
    rounds: int
    p_value: float
    beats_null: bool


class Calibration(BaseModel):
    """
    Whether the ranker's probability is a probability or only a ranking.

    ``brier`` is meaningless without ``brier_constant_baseline``: at a 1% base
    rate a model that always answers 0.01 scores about 0.0096, so a Brier
    above that is worse calibrated than a constant. Both travel together for
    that reason, along with ``beats_constant`` so the page cannot present one
    without the other.

    The ranker does not beat it, and that is a disclosed trade rather than a
    defect: it is fitted with balanced class weights so a 1% positive rate is
    not ignored by the boosting, which inflates every probability. Prestige is
    a within-pool rank, where inflation cancels.
    """

    brier: float
    brier_constant_baseline: float
    beats_constant: bool
    ece: float = Field(description="Expected calibration error, 0 is perfect")
    base_rate: float
    mean_predicted: float
    note: str


class BaselineMargin(BaseModel):
    """
    The model's lead over the best simple rule, with an interval on the lead.

    A point estimate of a difference is not evidence of one. The interval is
    taken from paired bootstrap resamples of the same held-out rows, and
    ``excludes_zero`` is what the verdict is allowed to depend on.
    """

    baseline: str
    point: float
    ci95: list[float]
    resamples: int
    excludes_zero: bool


class RollingFold(BaseModel):
    """One year scored by a model that trained only on the years before it."""

    year: int
    n_train: int
    n_test: int
    n_winners: int
    roc_auc: float
    average_precision: float
    params: dict
    candidates_compared: int


class RollingReport(BaseModel):
    """
    ``GET /api/analytics/rolling`` - the ranker scored over and over.

    Mirrors ``data/models/rolling.json``, written by ``python -m ml.rolling``.
    It answers the thing a single train/test split cannot: whether one
    held-out number was skill or a friendly test set. Fit on everything up to
    year k, score year k+1, advance.

    ``sd_across_folds`` is a spread, not a confidence interval, and is
    deliberately not named like one. Consecutive folds share nearly all their
    training data, so their scores are correlated and this understates true
    uncertainty. It measures stability, which one split cannot measure at all.
    """

    model_config = ConfigDict(extra="ignore")

    summary: dict
    folds: list[RollingFold]


class ValidationReport(BaseModel):
    """
    ``GET /api/analytics/validation`` - the evidence that the ranker is real.

    Mirrors ``data/models/validation.json``, written by ``python -m
    ml.validate``. It is served separately from ``ranker_metrics.json``
    because it answers a different question: those are the model's scores,
    this is the argument that the scores are not an artefact of leakage, class
    imbalance or a flattering baseline.
    """

    model_config = ConfigDict(extra="ignore")

    scope: str
    n_rows: int
    n_winners: int
    split: dict
    leakage_audit: LeakageAudit
    held_out_auc: HeldOutAuc
    permutation_test: PermutationTest
    baselines: dict[str, dict]
    beats_best_baseline_by: float
    #: Optional so a report written before these existed still deserialises;
    #: the page hides the blocks rather than failing.
    calibration: Calibration | None = None
    margin_over_best_baseline: BaselineMargin | None = None
    verdict: str


class BoxOfficeFilm(BaseModel):
    """One film's pre-release forecast beside what it actually earned."""

    model_config = ConfigDict(extra="ignore")

    imdb_id: str
    title: str
    year: int
    projected: float
    actual: float | None = None
    ratio: float | None = None
    within_2x: bool


class BoxOfficeSummary(BaseModel):
    model_config = ConfigDict(extra="ignore")

    films: int
    within_2x: float
    median_ratio: float


class BoxOfficeReport(BaseModel):
    """
    Search results from the box office artifact.

    `generated_from` travels with the payload rather than living only in the
    docs, because the single most important fact about these numbers is that
    each one came from a model that had not seen the film's year. A reader
    looking at a forecast beside an actual gross should be told that without
    having to go and find it.
    """

    model_config = ConfigDict(extra="ignore")

    generated_from: str
    summary: BoxOfficeSummary
    films: list[BoxOfficeFilm]
