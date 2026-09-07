"""
Filesystem layout shared by every pipeline and ML script.

Architecture note
-----------------
The pipeline is *offline*: it turns raw public datasets into small parquet
"seed" tables that the API loads at startup. Nothing here is imported by the
request path. All paths are resolved relative to the repository root so the
scripts work no matter which directory they are launched from.

    <repo>/data/raw/     bulk downloads (gitignored, ~1.4 GB)
    <repo>/data/seed/    processed parquet tables (committed, a few MB)
    <repo>/data/models/  trained model artifacts + metrics json (committed)
"""

from __future__ import annotations

from pathlib import Path

# backend/pipeline/paths.py -> backend/pipeline -> backend -> <repo>
REPO_ROOT = Path(__file__).resolve().parents[2]
DATA_DIR = REPO_ROOT / "data"
RAW_DIR = DATA_DIR / "raw"
SEED_DIR = DATA_DIR / "seed"
MODELS_DIR = DATA_DIR / "models"
CACHE_DIR = DATA_DIR / "processed" / "cache"  # API response cache for enrichment

# IMDb non-commercial datasets (https://developer.imdb.com/non-commercial-datasets/)
IMDB_BASE_URL = "https://datasets.imdbws.com/"
IMDB_FILES = [
    "title.basics.tsv.gz",  # tconst, titleType, primaryTitle, startYear, runtime, genres
    "title.ratings.tsv.gz",  # tconst, averageRating, numVotes
    "title.crew.tsv.gz",  # tconst, directors (comma-separated nconsts)
    "title.principals.tsv.gz",  # tconst, ordering, nconst, category, characters
    "name.basics.tsv.gz",  # nconst, primaryName, birthYear, deathYear, professions
]

# Academy Award nominations with IMDb ids, maintained at github.com/DLu/oscar_data
OSCARS_URL = "https://raw.githubusercontent.com/DLu/oscar_data/master/oscars.csv"
OSCARS_FILE = "oscars.csv"


def ensure_dirs() -> None:
    """Create the data directories if they do not exist yet."""
    for d in (RAW_DIR, SEED_DIR, MODELS_DIR, CACHE_DIR):
        d.mkdir(parents=True, exist_ok=True)
