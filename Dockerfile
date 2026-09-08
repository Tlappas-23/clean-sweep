# Production image for the Clean Sweep API.
#
# What this deliberately does NOT contain
# ---------------------------------------
# pandas, pyarrow, numpy, scikit-learn and duckdb. Together they are ~230 MB
# of wheel and ~96 MB of resident memory, and the request path uses none of
# them: the seed is packed offline into gzipped columnar JSON that the
# standard library reads (backend/pipeline/pack.py), and the models' outputs
# are joined into that seed rather than being run per request. `pip install
# ./backend` gets the short [project.dependencies] list and nothing else.
#
# That is what makes the whole image ~200 MB rather than ~700 MB, and lets the
# loaded app sit at ~172 MB against the 512 MB a free instance is allowed.

FROM python:3.12-slim AS base

# Python behaviour that only makes sense in a container: never write .pyc
# files to a layer that is thrown away, and never buffer logs, or the platform
# shows nothing until the buffer flushes and a crash looks like silence.
ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1

WORKDIR /srv

# Dependencies before source. The manifest changes rarely and the code changes
# constantly, so this layer is cached across almost every deploy.
COPY backend/pyproject.toml backend/pyproject.toml
COPY backend/app/__init__.py backend/app/__init__.py
RUN pip install --no-cache-dir ./backend && \
    # The offline halves are not installed, so their packages would be dead
    # imports if anything reached for them. Removing the stubs makes that a
    # loud ImportError at build time rather than a quiet one in production.
    find /usr/local/lib/python3.12/site-packages -name '__pycache__' -type d -prune -exec rm -rf {} + || true

# The application, then the data it serves. Data last because the daily
# refresh changes it and the code does not, so a data-only update rebuilds
# exactly one layer.
COPY backend/app ./backend/app
COPY data/seed/*.json.gz data/seed/manifest.json ./data/seed/
COPY data/models/*.json ./data/models/

# Run as nobody. A container that never needs to write anything should not be
# able to, and this is one line against a whole class of mistakes.
RUN useradd --create-home --shell /usr/sbin/nologin appuser && chown -R appuser:appuser /srv
USER appuser

ENV CLEAN_SWEEP_SEED_DIR=/srv/data/seed \
    CLEAN_SWEEP_MODELS_DIR=/srv/data/models \
    PORT=8000

WORKDIR /srv/backend

# The platform's own health check hits this; it reports whether the app came
# up *with its data*, not merely that the process is alive.
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
    CMD python -c "import urllib.request,sys; sys.exit(0 if urllib.request.urlopen('http://127.0.0.1:'+__import__('os').environ.get('PORT','8000')+'/health',timeout=4).status==200 else 1)"

# One worker on purpose. The instance has 512 MB and the catalog is ~150 MB of
# it; a second worker would be a second copy of the whole catalog, and the box
# would be killed rather than made faster. `--proxy-headers` is what lets the
# rate limiter see the real client address instead of the platform's proxy.
#
# Shell form so $PORT is expanded: hosts assign the port at runtime.
CMD exec uvicorn app.main:app \
    --host 0.0.0.0 --port ${PORT} \
    --workers 1 \
    --proxy-headers --forwarded-allow-ips='*' \
    --timeout-keep-alive 65 \
    --no-server-header
