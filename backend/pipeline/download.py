"""
Step 1 of the pipeline: fetch the raw public datasets into ``data/raw``.

Usage (from ``backend/``)::

    python -m pipeline.download            # skips files that already exist
    python -m pipeline.download --force    # re-download everything

The IMDb files total ~1.4 GB compressed, so downloads are streamed to disk
in chunks rather than held in memory. This script is the only piece of the
project that touches the network without an API key.
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

import httpx

from pipeline.paths import IMDB_BASE_URL, IMDB_FILES, OSCARS_FILE, OSCARS_URL, RAW_DIR, ensure_dirs


def _stream_download(url: str, dest: Path, force: bool = False) -> None:
    """Download ``url`` to ``dest``, streaming 1 MB chunks; skip if present."""
    if dest.exists() and not force:
        print(f"  skip   {dest.name} (exists)")
        return
    print(f"  fetch  {dest.name} ...", end="", flush=True)
    # ``follow_redirects`` is needed because GitHub raw URLs redirect.
    with httpx.stream("GET", url, follow_redirects=True, timeout=120) as resp:
        resp.raise_for_status()
        tmp = dest.with_suffix(dest.suffix + ".part")  # write atomically
        with tmp.open("wb") as fh:
            for chunk in resp.iter_bytes(chunk_size=1 << 20):
                fh.write(chunk)
        tmp.replace(dest)
    print(f" {dest.stat().st_size / 1e6:.1f} MB")


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--force", action="store_true", help="re-download existing files")
    args = parser.parse_args(argv)

    ensure_dirs()
    print(f"Downloading into {RAW_DIR}")
    for name in IMDB_FILES:
        _stream_download(IMDB_BASE_URL + name, RAW_DIR / name, force=args.force)
    _stream_download(OSCARS_URL, RAW_DIR / OSCARS_FILE, force=args.force)
    return 0


if __name__ == "__main__":
    sys.exit(main())
