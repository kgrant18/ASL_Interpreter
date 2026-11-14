"""Extract MediaPipe landmarks from downloaded ASL Citizen clips and cache them.

Each clip is decoded, subsampled to ~15 FPS (matching the live pipeline), passed
through the *same* `LandmarkExtractor` used at runtime, and stored as an .npz of raw
landmarks under backend/data/landmarks/. Raw video is never modified.

Usage:
    python -m training.prepare_data --workers 12
"""

from __future__ import annotations

import argparse
import sys
from concurrent.futures import ProcessPoolExecutor, as_completed
from pathlib import Path

import numpy as np
import pandas as pd

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

DATA_DIR = ROOT / "data" / "asl_citizen"
OUT_DIR = ROOT / "data" / "landmarks"
TARGET_FPS = 15.0


def extract_clip(video: str) -> tuple[str, int, str]:
    import cv2

    from app.vision.landmarks import LandmarkExtractor
    from app.vision.serialization import pack

    out = OUT_DIR / (Path(video).stem + ".npz")
    if out.exists():
        return video, -1, "cached"
    cap = cv2.VideoCapture(str(DATA_DIR / "videos" / video))
    fps = cap.get(cv2.CAP_PROP_FPS) or 30.0
    step = max(1, round(fps / TARGET_FPS))
    frames = []
    try:
        with LandmarkExtractor() as ex:
            i = 0
            while True:
                ok, bgr = cap.read()
                if not ok:
                    break
                if i % step == 0:
                    rgb = cv2.cvtColor(bgr, cv2.COLOR_BGR2RGB)
                    frames.append(ex.process(rgb, int(i * 1000 / fps)))
                i += 1
    finally:
        cap.release()
    if not frames:
        return video, 0, "no frames"
    np.savez_compressed(out, **pack(frames))
    hands = sum(f.has_hands for f in frames)
    return video, len(frames), f"{hands} frames with hands"


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--workers", type=int, default=12)
    ap.add_argument("--manifest", default="manifest.csv")
    args = ap.parse_args()
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    manifest = pd.read_csv(DATA_DIR / args.manifest)
    bad = 0
    with ProcessPoolExecutor(args.workers) as ex:
        futs = {ex.submit(extract_clip, v): v for v in manifest.video}
        for i, f in enumerate(as_completed(futs), 1):
            try:
                _, n, msg = f.result()
                if n == 0:
                    bad += 1
                    print("EMPTY", futs[f], msg)
            except Exception as exc:
                bad += 1
                print("FAIL", futs[f], repr(exc))
            if i % 100 == 0:
                print(f"{i}/{len(futs)}", flush=True)
    print(f"done, {bad} failures")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
