"""
``app.data`` — the in-memory ``Catalog`` of films and contenders.

Architecture note
-----------------
"Data is a build artifact": the offline pipeline writes small parquet
tables to ``data/seed`` and this package loads them *once* at startup into
plain Python objects indexed by ``(year, category)``. Request handlers only
ever do dictionary lookups; pandas is used for the load and then dropped.
"""

from app.data.catalog import Catalog, ContenderRecord, public_contender, search_pool

__all__ = ["Catalog", "ContenderRecord", "public_contender", "search_pool"]
