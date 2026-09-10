"""
Architecture tests (``tests.test_architecture``).

docs/ARCHITECTURE.md makes four claims about how this code is arranged. Three
of them are the reason the project is testable and the reason the deployed
image is 77 MB rather than 530, and all three are one convenience import away
from quietly becoming false.

A rule nobody checks is a comment. These are the checks.
"""

from __future__ import annotations

import ast
from pathlib import Path

import pytest

BACKEND = Path(__file__).resolve().parents[1]
ENGINE = BACKEND / "app" / "engine"
APP = BACKEND / "app"

#: Modules the pure engine may import. Anything else is either I/O, a
#: framework, or a dependency the request path must not carry.
ENGINE_ALLOWED_STDLIB = {
    "__future__",
    "abc",
    "bisect",
    "collections",
    "dataclasses",
    "datetime",
    "enum",
    "functools",
    "itertools",
    "json",
    "math",
    "random",
    "statistics",
    "typing",
    "heapq",
    "operator",
    "re",
}

#: Offline-only packages. The serving app importing any of these puts 230 MB
#: of wheel and ~96 MB of resident memory back on the request path.
OFFLINE_ONLY = {"pandas", "numpy", "pyarrow", "sklearn", "scipy", "duckdb", "joblib", "matplotlib"}


def _imports(path: Path) -> set[str]:
    """Top-level package name of every import in a module."""
    tree = ast.parse(path.read_text())
    found: set[str] = set()
    for node in ast.walk(tree):
        if isinstance(node, ast.Import):
            found.update(a.name.split(".")[0] for a in node.names)
        elif isinstance(node, ast.ImportFrom) and node.module and node.level == 0:
            found.add(node.module.split(".")[0])
    return found


def _modules(root: Path) -> list[Path]:
    return sorted(p for p in root.rglob("*.py") if "__pycache__" not in p.parts)


@pytest.mark.parametrize("module", _modules(ENGINE), ids=lambda p: p.name)
def test_the_engine_stays_pure(module: Path):
    """
    "Engine is pure": no I/O, no framework, no settings.

    This is what lets every rule be tested against a hand-built fake catalog
    in milliseconds, and what stops the request path growing a dependency by
    accident. The exception that used to exist, a calibration script that read
    settings and printed a report, now lives in ml/ where the constraint does
    not apply.
    """
    names = _imports(module)
    illegal = {name for name in names if not name.startswith("app") and name not in ENGINE_ALLOWED_STDLIB}
    assert not illegal, (
        f"{module.name} imports {sorted(illegal)}. app/engine must stay free of I/O, "
        "frameworks and settings; a module that needs them belongs in ml/ or pipeline/."
    )


@pytest.mark.parametrize("module", _modules(ENGINE), ids=lambda p: p.name)
def test_the_engine_never_reaches_for_app_state(module: Path):
    """
    The engine may know about models and other engine modules, and nothing
    else. Importing app.data or app.core would drag the catalog loader and the
    settings object into what is meant to be a pile of pure functions.
    """
    tree = ast.parse(module.read_text())
    reached = {
        node.module
        for node in ast.walk(tree)
        if isinstance(node, ast.ImportFrom)
        and node.module
        and node.module.startswith("app.")
        and not node.module.startswith(("app.models", "app.engine"))
    }
    assert not reached, f"{module.name} imports {sorted(reached)}, outside app.models / app.engine"


@pytest.mark.parametrize("module", _modules(APP), ids=lambda p: str(p.relative_to(APP)))
def test_the_serving_app_carries_no_offline_dependency(module: Path):
    """
    The load-bearing one for the deploy.

    pandas, pyarrow, numpy, scikit-learn and duckdb are 230 MB of wheel and
    ~96 MB of resident memory, and the request path needs none of them: the
    seed is packed offline into gzipped JSON Lines that the standard library
    streams. One `import pandas as pd` for convenience in a data module would
    hand all of that back, and nothing else in the suite would notice.

    tests/test_footprint.py measures the consequence; this names the cause.
    """
    offending = _imports(module) & OFFLINE_ONLY
    assert not offending, (
        f"app/{module.relative_to(APP)} imports {sorted(offending)}. "
        "Anything parquet- or model-shaped belongs in pipeline/ or ml/."
    )


def test_every_engine_module_is_covered_by_these_rules():
    """
    A guard on the guard: if the engine gains a module, it is checked without
    anyone remembering to add it. Cheap insurance against a rule that silently
    stops applying to new code.
    """
    modules = _modules(ENGINE)
    assert len(modules) >= 5, "engine modules are not being discovered"
    assert any(m.name == "grid.py" for m in modules)
    assert not any(m.name == "calibrate.py" for m in modules), (
        "calibrate.py is back in app/engine; it reads settings and prints, so it belongs in ml/"
    )
