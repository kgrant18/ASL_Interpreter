#!/usr/bin/env python3
"""Report the SignBridge runtime environment (Python, MediaPipe, PyTorch/CUDA, assets)."""

from __future__ import annotations

import json
import platform
import shutil
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
BACKEND = ROOT / "backend"
results: list[tuple[str, bool, str]] = []


def check(name: str, fn) -> None:
    try:
        ok, detail = fn()
    except Exception as exc:  # report, never crash
        ok, detail = False, f"{type(exc).__name__}: {exc}"
    results.append((name, ok, detail))


def py():
    v = sys.version_info
    return (3, 10) <= (v.major, v.minor) <= (3, 12), platform.python_version()


def mediapipe():
    import mediapipe as mp
    return True, mp.__version__


def opencv():
    import cv2
    return True, cv2.__version__


def torch_check():
    import torch
    cuda = torch.cuda.is_available()
    dev = torch.cuda.get_device_name(0) if cuda else "CPU only (fine — the model is small)"
    return True, f"{torch.__version__}; CUDA available: {cuda}; {dev}"


def gpu():
    if not shutil.which("nvidia-smi"):
        return True, "nvidia-smi not found (optional)"
    out = subprocess.run(["nvidia-smi", "--query-gpu=name,driver_version", "--format=csv,noheader"],
                         capture_output=True, text=True, timeout=10)
    return True, out.stdout.strip() or "no GPU reported"


def assets():
    mp = BACKEND / "models" / "mediapipe"
    need = [mp / "hand_landmarker.task", mp / "pose_landmarker_lite.task"]
    missing = [p.name for p in need if not p.exists()]
    return not missing, "ok" if not missing else f"missing {missing} — run ./scripts/setup.sh"


def weights():
    w = BACKEND / "models" / "signgru.pt"
    e = BACKEND / "models" / "signgru_eval.json"
    if not w.exists():
        return False, "missing — run `make train` (live recognition unavailable until then)"
    if not e.exists():
        return False, "weights present but no evaluation report — run `make evaluate`"
    enabled = json.loads(e.read_text()).get("enabled", [])
    return True, f"{len(enabled)} validated signs: {', '.join(enabled)}"


def node():
    n = shutil.which("node")
    if not n:
        return False, "node not found"
    return True, subprocess.run([n, "--version"], capture_output=True, text=True).stdout.strip()


for name, fn in [("Python 3.10–3.12", py), ("MediaPipe", mediapipe), ("OpenCV", opencv),
                 ("PyTorch", torch_check), ("NVIDIA GPU", gpu), ("Node.js", node),
                 ("MediaPipe models", assets), ("SignGRU model", weights)]:
    check(name, fn)

width = max(len(n) for n, _, _ in results)
for name, ok, detail in results:
    mark = "\033[32m✓\033[0m" if ok else "\033[33m!\033[0m"
    print(f"  {mark} {name.ljust(width)}  {detail}")
sys.exit(0 if all(ok for _, ok, _ in results) else 1)
