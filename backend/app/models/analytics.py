"""
Analytics schemas (``app.models.analytics``).

These mirror the JSON files the ML step writes to ``data/models``
(``cluster_summary.json`` and ``ranker_metrics.json``). The API validates
the files against these models before serving them so a drift between the
training scripts and the contract is caught loudly rather than passed on to
the frontend. Extra keys in the files are ignored.
"""

from __future__ import annotations

from pydantic import BaseModel, ConfigDict


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
