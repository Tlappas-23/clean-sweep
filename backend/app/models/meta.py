"""
``GET /api/meta`` schema (``app.models.meta``).

Static reference data the frontend needs before a game starts: labels for
enums, the year range the slot machine can land on, and the circuit's
thresholds so the results page can draw the difficulty curve.
"""

from __future__ import annotations

from pydantic import BaseModel

from app.models.enums import Category, Mode


class CategoryInfo(BaseModel):
    id: Category
    label: str


class ModeInfo(BaseModel):
    id: Mode
    label: str
    description: str


class YearRange(BaseModel):
    min: int
    max: int


class CeremonyInfo(BaseModel):
    index: int
    name: str
    threshold: float


class MetricInfo(BaseModel):
    id: str
    label: str
    description: str


class Meta(BaseModel):
    categories: list[CategoryInfo]
    modes: list[ModeInfo]
    years: YearRange
    decades: list[str]
    ceremonies: list[CeremonyInfo]
    metrics: list[MetricInfo]
