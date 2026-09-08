"""
Runtime footprint tests (``tests.test_footprint``).

The free tier this deploys to allows 512 MB and restarts whenever it has been
idle, so both numbers below are things a player actually feels: memory decides
whether the instance survives, and boot time is added to the first request
after a sleep.

Both were won by moving parquet reading offline (``pipeline.pack``) so the
serving process never imports pandas, pyarrow or numpy. That saving is easy to
give back by accident, with a single convenience import in a module the app
loads, and nothing else in the suite would notice. So it is asserted.

The budgets are ceilings with real headroom, not targets. They exist to catch
a regression of the "someone imported pandas in a data module" size, not to
fail on a 3% drift between Python versions.
"""

from __future__ import annotations

import os
import subprocess
import sys
import textwrap

import pytest
from conftest import REPO_ROOT  # noqa: E402 - pytest puts tests/ on the path

#: Ceiling for the fully-loaded app, in MB.
#:
#: Peak, not steady state, because peak is what an OOM killer sees and boot is
#: when it happens: the parsed seed columns and the objects built from them are
#: briefly alive together. The loaders call ``Table.release()`` to keep that
#: overlap short.
#:
#: The number is platform-dependent and by more than a rounding error. The same
#: load measures ~168 MB on macOS and substantially more under glibc, whose
#: per-thread arenas inflate RSS in a container; the deployment sets
#: MALLOC_ARENA_MAX for that reason and this probe matches it. The budget is
#: set against the higher of the two, since that is the one that has to fit,
#: and leaves real headroom under the 512 MB an instance is allowed.
RSS_BUDGET_MB = 400

#: Ceiling for loading the seed, in seconds. Measured at ~0.5s. On a sleeping
#: instance this is added to the first request somebody makes.
BOOT_BUDGET_SECONDS = 4.0

#: Never importable from the request path. Each is tens of megabytes of wheel
#: and resident memory, and every one of them is an offline dependency.
FORBIDDEN = ("pandas", "numpy", "pyarrow", "sklearn", "scipy", "duckdb", "joblib")

PROBE = textwrap.dedent(
    """
    import json, sys, time
    t = time.perf_counter()
    from app.main import app
    from app.core.config import Settings
    from app.data.catalog import Catalog
    from app.data.people import PeopleCatalog
    s = Settings()
    catalog = Catalog.load(s.seed_dir)
    people = PeopleCatalog.load(s.seed_dir)
    elapsed = time.perf_counter() - t
    try:
        import resource
        peak = resource.getrusage(resource.RUSAGE_SELF).ru_maxrss
        rss = peak / (1024 * 1024) if sys.platform == "darwin" else peak / 1024
    except ImportError:
        rss = -1.0
    print(json.dumps({
        "rss_mb": rss,
        "seconds": elapsed,
        "contenders": len(catalog),
        "actors": len(people),
        "loaded": sorted(m for m in sys.modules if m in %(forbidden)r),
    }))
    """
) % {"forbidden": FORBIDDEN}


@pytest.fixture(scope="module")
def probe() -> dict:
    """
    Boot the app in a *fresh* interpreter and report what it cost.

    A subprocess rather than an in-process measurement, because by the time
    this test runs pytest has already imported pandas for tests/test_pack.py
    and the numbers would be meaningless.
    """
    # Match the deployment's allocator settings, or the number measured here
    # is not the number that has to fit. glibc otherwise opens an arena per
    # thread and RSS climbs well past what is actually live.
    env = {**os.environ, "MALLOC_ARENA_MAX": "2"}
    result = subprocess.run(
        [sys.executable, "-c", PROBE],
        cwd=REPO_ROOT / "backend",
        capture_output=True,
        text=True,
        timeout=120,
        env=env,
    )
    if result.returncode != 0:  # pragma: no cover
        pytest.fail(f"probe failed:\n{result.stderr}")
    return __import__("json").loads(result.stdout.strip().splitlines()[-1])


def test_the_request_path_imports_none_of_the_offline_libraries(probe: dict):
    """
    The load-bearing assertion.

    These five are 230 MB of installed wheel and ~96 MB of resident memory,
    and the app needs none of them to serve a request: the seed is packed
    offline into gzipped columnar JSON and read back with the standard
    library. One `import pandas as pd` for convenience in a data module would
    silently undo that, and this is the only thing that would notice.
    """
    assert probe["loaded"] == [], (
        f"the serving app imported {probe['loaded']}. Anything parquet-shaped belongs in pipeline/, not app/."
    )


def test_the_loaded_app_fits_the_free_tier(probe: dict, capsys):
    assert probe["rss_mb"] > 0, "could not measure memory on this platform"
    # Printed on the way through, not only on failure: the trend is the useful
    # thing, and a number that only appears when it is already too late is not
    # much of a budget.
    with capsys.disabled():
        print(
            f"\n  peak RSS {probe['rss_mb']:.0f} MB / {RSS_BUDGET_MB} MB budget"
            f"  ({512 - probe['rss_mb']:.0f} MB headroom on the instance)"
            f"  boot {probe['seconds']:.2f}s",
            end="",
        )
    assert probe["rss_mb"] < RSS_BUDGET_MB, (
        f"peak RSS is {probe['rss_mb']:.0f} MB against a {RSS_BUDGET_MB} MB budget; "
        "the instance has 512 MB and is killed, not throttled, when it runs out"
    )


def test_the_seed_loads_quickly_enough_to_wake_on_demand(probe: dict):
    assert probe["seconds"] < BOOT_BUDGET_SECONDS, (
        f"boot took {probe['seconds']:.1f}s against a {BOOT_BUDGET_SECONDS}s budget; "
        "this is added to the first request after the instance sleeps"
    )


def test_the_whole_catalog_is_actually_there(probe: dict):
    """A footprint budget is trivially met by loading nothing."""
    assert probe["contenders"] > 40_000
    assert probe["actors"] > 1_000
