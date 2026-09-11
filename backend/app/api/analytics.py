"""
Analytics routes (``app.api.analytics``): the ML layer, made visible.

Architecture note
-----------------
Inference never happens on the request path. ``backend/ml`` trains offline
and writes its JSON artifacts into ``data/models``; these handlers read
them, validate them against the contract models and serve them. That keeps
scikit-learn out of the serving process entirely. The API would still run
if the models were never trained (the endpoints answer 404 with instructions).

Validating rather than passing the JSON through is deliberate: if a training
script changes a field name, the failure surfaces here as a 500 with a
Pydantic message instead of silently breaking the analytics page.
"""

from __future__ import annotations

from fastapi import APIRouter, HTTPException

from app.api.deps import SettingsDep, load_json_artifact
from app.models.analytics import (
    BoxOfficeReport,
    ClusterSummary,
    RankerSummary,
    RollingReport,
    ValidationReport,
)

router = APIRouter(prefix="/api/analytics", tags=["analytics"])


@router.get("/clusters", response_model=ClusterSummary)
def get_clusters(settings: SettingsDep) -> ClusterSummary:
    """Film archetypes: cluster labels, sizes, centroids and a 2-D PCA projection."""
    payload = load_json_artifact(settings.models_dir / "cluster_summary.json", "cluster summary")
    try:
        return ClusterSummary.model_validate(payload)
    except ValueError as exc:  # pragma: no cover - drift between ml/ and the contract
        detail = f"cluster summary does not match the contract: {exc}"
        raise HTTPException(status_code=500, detail=detail) from exc


@router.get("/ranker", response_model=RankerSummary)
def get_ranker(settings: SettingsDep) -> RankerSummary:
    """Prestige ranker: held-out metrics, permutation importances and the calibration curve."""
    payload = load_json_artifact(settings.models_dir / "ranker_metrics.json", "ranker metrics")
    try:
        return RankerSummary.model_validate(payload)
    except ValueError as exc:  # pragma: no cover - drift between ml/ and the contract
        detail = f"ranker metrics do not match the contract: {exc}"
        raise HTTPException(status_code=500, detail=detail) from exc


@router.get("/rolling", response_model=RollingReport)
def get_rolling(settings: SettingsDep) -> RollingReport:
    """
    Rolling-origin validation: the ranker refitted and rescored year by year.

    Separate from ``/validation`` because it answers a different question.
    That endpoint asks whether the held-out score is an artefact of leakage or
    class imbalance; this one asks whether one split was lucky.
    """
    payload = load_json_artifact(settings.models_dir / "rolling.json", "rolling validation")
    try:
        return RollingReport.model_validate(payload)
    except ValueError as exc:  # pragma: no cover - drift between ml/ and the contract
        detail = f"rolling report does not match the contract: {exc}"
        raise HTTPException(status_code=500, detail=detail) from exc


@router.get("/validation", response_model=ValidationReport)
def get_validation(settings: SettingsDep) -> ValidationReport:
    """
    The adversarial checks behind the ranker: leakage audit, permutation test,
    bootstrap interval and the human baselines it has to beat.
    """
    payload = load_json_artifact(settings.models_dir / "validation.json", "validation report")
    try:
        return ValidationReport.model_validate(payload)
    except ValueError as exc:  # pragma: no cover - drift between ml/ and the contract
        detail = f"validation report does not match the contract: {exc}"
        raise HTTPException(status_code=500, detail=detail) from exc


@router.get("/boxoffice", response_model=BoxOfficeReport)
def box_office(settings: SettingsDep, q: str = "", limit: int = 20) -> BoxOfficeReport:
    """
    Pre-release box office forecasts, searchable by title.

    Every projection here is out of sample: the film was scored by a model
    trained only on films released before its own year, so the number beside an
    actual gross is what a forecaster standing the previous December would have
    said. Films from before the first validation fold are not in the artifact at
    all rather than carrying an in-sample number.

    An empty query returns the largest earners, which is the useful default for
    a page whose first job is to show that the comparison is honest.
    """
    raw = load_json_artifact(settings.models_dir / "boxoffice_projections.json", "Box office projections")

    needle = q.casefold().strip()
    films = raw.get("films", [])
    if needle:
        films = [f for f in films if needle in f.get("key", "")]

    return BoxOfficeReport(
        generated_from=raw["generated_from"],
        summary=raw["summary"],
        films=films[: max(1, min(limit, 100))],
    )
