#!/usr/bin/env bash
# SignBridge setup: Python venv + backend deps, frontend deps, model assets check.
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

bold() { printf '\033[1m%s\033[0m\n' "$*"; }
ok()   { printf '  \033[32m✓\033[0m %s\n' "$*"; }
warn() { printf '  \033[33m!\033[0m %s\n' "$*"; }
die()  { printf '  \033[31m✗\033[0m %s\n' "$*"; exit 1; }

bold "1/5 Prerequisites"
command -v node >/dev/null || die "Node.js 20+ is required (https://nodejs.org)"
ok "node $(node --version)"
command -v npm >/dev/null || die "npm is required"

# MediaPipe/PyTorch need Python 3.10–3.12. Find one.
PY="${SIGNBRIDGE_PYTHON:-}"
if [[ -z "$PY" ]]; then
  for c in python3.12 /opt/homebrew/bin/python3.12 python3.11 python3.10 "$HOME/miniforge3/envs/signbridge/bin/python" \
           "$HOME/miniconda3/envs/signbridge/bin/python" "$HOME/anaconda3/envs/signbridge/bin/python"; do
    if command -v "$c" >/dev/null 2>&1; then PY="$(command -v "$c")"; break; fi
  done
fi
if [[ -z "$PY" ]]; then
  CONDA="$(command -v conda || true)"
  [[ -z "$CONDA" && -x "$HOME/miniforge3/condabin/conda" ]] && CONDA="$HOME/miniforge3/condabin/conda"
  if [[ -n "$CONDA" ]]; then
    warn "No Python 3.10–3.12 found; creating conda env 'signbridge' (python=3.12)"
    "$CONDA" create -y -q -n signbridge python=3.12 >/dev/null
    PY="$("$CONDA" run -n signbridge which python)"
  else
    die "Python 3.10–3.12 is required (system python is $(python3 --version 2>&1)). Install python3.12 or set SIGNBRIDGE_PYTHON=/path/to/python3.12"
  fi
fi
ok "python $("$PY" --version 2>&1 | cut -d' ' -f2) ($PY)"

bold "2/5 Backend virtual environment"
if [[ ! -x backend/.venv/bin/python ]]; then
  "$PY" -m venv backend/.venv
  ok "created backend/.venv"
fi
backend/.venv/bin/pip install -q --upgrade pip
if [[ -f backend/requirements.lock ]]; then
  if [[ "$(uname -s)" == "Darwin" ]]; then
    # The lock was resolved on Linux/CUDA: drop the NVIDIA/CUDA/Triton wheels, which
    # don't exist for macOS (PyTorch uses MPS or CPU there).
    LOCK="$(mktemp)"; trap 'rm -f "$LOCK"' EXIT
    grep -viE '^(nvidia-|cuda-|triton==)' backend/requirements.lock > "$LOCK"
    backend/.venv/bin/pip install -q -r "$LOCK"
  else
    backend/.venv/bin/pip install -q -r backend/requirements.lock
  fi
else
  backend/.venv/bin/pip install -q -r backend/requirements.txt
fi
ok "backend dependencies installed"

bold "3/5 Frontend dependencies"
(cd frontend && npm install --no-audit --no-fund --silent)
ok "frontend dependencies installed"

bold "4/5 Model assets"
MP="backend/models/mediapipe"
mkdir -p "$MP"
base="https://storage.googleapis.com/mediapipe-models"
[[ -f "$MP/hand_landmarker.task" ]] || curl -sSfL -o "$MP/hand_landmarker.task" "$base/hand_landmarker/hand_landmarker/float16/latest/hand_landmarker.task"
[[ -f "$MP/pose_landmarker_lite.task" ]] || curl -sSfL -o "$MP/pose_landmarker_lite.task" "$base/pose_landmarker/pose_landmarker_lite/float16/latest/pose_landmarker_lite.task"
ok "MediaPipe hand + pose landmarker models present"
PV="backend/models/piper"; mkdir -p "$PV"
vbase="https://huggingface.co/rhasspy/piper-voices/resolve/main/en/en_US/ljspeech/medium"
for f in en_US-ljspeech-medium.onnx en_US-ljspeech-medium.onnx.json; do
  [[ -f "$PV/$f" ]] || curl -sSfL -o "$PV/$f" "$vbase/$f"
done
ok "Piper TTS voice present (en_US-ljspeech-medium; public-domain training data)"
if [[ "$(uname -s)" == "Darwin" ]]; then
  if say -a '?' 2>/dev/null | grep -qi "BlackHole"; then
    ok "BlackHole audio device found (select \"BlackHole 2ch\" as the microphone in Zoom)"
  else
    warn "BlackHole not found: 'Send to meeting' voice output needs it:"
    warn "    brew install blackhole-2ch    (then log out/in or restart coreaudiod)"
  fi
elif command -v pactl >/dev/null && { command -v pw-play || command -v paplay; } >/dev/null; then
  ok "PipeWire/PulseAudio tools found (virtual microphone available)"
else
  warn "pactl/pw-play not found: 'Send to meeting' voice output needs PipeWire or PulseAudio"
fi
if [[ -f backend/models/signgru.pt && -f backend/models/signgru_eval.json ]]; then
  ok "SignGRU weights + evaluation report present"
else
  warn "SignGRU weights not found. Train them locally (≈25 min, downloads ~800 MB of ASL Citizen clips):"
  warn "    make train"
  warn "Until then, only the clearly labeled Simulated Demo mode is available."
fi

bold "5/5 Environment report"
backend/.venv/bin/python scripts/check_environment.py || true

echo
bold "Setup complete. Launch with:"
echo "    ./scripts/dev.sh"
echo "then open http://localhost:5173"
