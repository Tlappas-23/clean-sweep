#!/usr/bin/env bash
# Start Clean Sweep locally: FastAPI on :8000, Vite on :5173.
#
#   ./scripts/dev.sh          both servers, then open http://localhost:5173
#   ./scripts/dev.sh --mock   frontend only, against the in-memory fake catalog
#
# Ctrl-C stops both. The trap matters: without it the backend survives the
# script and the next run fails on an address already in use.
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$root"

mock=false
[[ "${1:-}" == "--mock" ]] && mock=true

# One venv for the backend, created on first run so a fresh clone works.
if [[ ! -x .venv/bin/python ]]; then
  echo "==> creating .venv and installing the backend"
  python3 -m venv .venv
  .venv/bin/pip install -q --upgrade pip
  .venv/bin/pip install -q -e "backend[dev]"
fi

if [[ ! -d frontend/node_modules ]]; then
  echo "==> installing frontend dependencies"
  (cd frontend && npm install)
fi

pids=()
cleanup() { for pid in "${pids[@]:-}"; do kill "$pid" 2>/dev/null || true; done; }
trap cleanup EXIT INT TERM

if [[ "$mock" == false ]]; then
  echo "==> backend  http://localhost:8000  (API docs at /docs)"
  (cd backend && "$root/.venv/bin/uvicorn" app.main:app --port 8000 --reload) &
  pids+=($!)
  # Wait for it to answer before starting Vite, so the first page load is not
  # a proxy error the user has to refresh past.
  for _ in {1..40}; do
    curl -sf http://localhost:8000/health >/dev/null 2>&1 && break
    sleep 0.5
  done
fi

echo "==> frontend http://localhost:5173"
if [[ "$mock" == true ]]; then
  (cd frontend && VITE_API_MOCK=true npm run dev -- --port 5173) &
else
  (cd frontend && npm run dev -- --port 5173) &
fi
pids+=($!)

wait
