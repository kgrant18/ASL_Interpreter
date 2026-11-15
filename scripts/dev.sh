#!/usr/bin/env bash
# Start the FastAPI backend (127.0.0.1:8000) and Vite frontend (localhost:5173).
# Ctrl+C stops both.
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

[[ -x backend/.venv/bin/python ]] || { echo "Run ./scripts/setup.sh first."; exit 1; }
[[ -d frontend/node_modules ]] || { echo "Run ./scripts/setup.sh first."; exit 1; }

for port in 8000 5173; do
  if (exec 3<>/dev/tcp/127.0.0.1/$port) 2>/dev/null; then
    echo "Port $port is already in use. Stop the other process (e.g. a previous dev.sh) and retry."
    exit 1
  fi
done

pids=()
indicator=""
cleanup() {
  trap - INT TERM EXIT
  echo
  echo "Stopping SignBridge…"
  [[ -n "$indicator" ]] && kill -TERM "$indicator" 2>/dev/null || true
  for p in "${pids[@]}"; do
    pkill -TERM -P "$p" 2>/dev/null || true   # children first (no orphans)
    kill -TERM "$p" 2>/dev/null || true
  done
  wait 2>/dev/null || true
}
trap cleanup INT TERM EXIT

(cd backend && exec .venv/bin/python -m app.main) &
pids+=($!)
(cd frontend && exec ./node_modules/.bin/vite --clearScreen false) &
pids+=($!)

for i in $(seq 1 40); do
  curl -sf http://127.0.0.1:8000/health >/dev/null 2>&1 && break
  sleep 0.5
done

# macOS: menu-bar status indicator (stays visible while Zoom is in front).
if [[ "$(uname)" == "Darwin" && "${SIGNBRIDGE_INDICATOR:-1}" != "0" ]] \
   && backend/.venv/bin/python -c "import rumps" 2>/dev/null; then
  (cd backend && exec .venv/bin/python -m app.statusbar) &
  indicator=$!
fi

echo
echo "  SignBridge is running"
echo "  ─────────────────────────────────────────"
echo "  App:      http://localhost:5173"
echo "  Backend:  http://localhost:8000/health"
echo "  Model:    http://localhost:8000/api/model"
echo "  Press Ctrl+C to stop."
echo

# exit if either process dies
wait -n "${pids[@]}"
