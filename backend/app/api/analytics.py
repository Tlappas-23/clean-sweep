"""
Analytics routes (``app.api.analytics``): the ML layer, made visible.

Architecture note
-----------------
Inference never happens on the request path. ``backend/ml`` trains offline
and writes two JSON artifacts into ``data/models``; these handlers read
them, validate them against the contract models and serve them. That keeps
scikit-learn out of the serving process entirely — the API would still run
if the models were never trained (the endpoints answer 404 with instructions).

Validating rather than passing the JSON through is deliberate: if a training
script changes a field name, the failure surfaces here as a 500 with a
Pydantic message instead of silently breaking the analytics page.
"""

from __future__ import annotations

from fastapi import APIRouter, HTTPException

from app.api.deps import SettingsDep, load_json_artifact
from app.models.analytics import ClusterSummary, RankerSummary

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
