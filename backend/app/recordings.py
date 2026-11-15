"""Local sign recordings (landmarks only; no video is ever stored).

Each take is saved as backend/data/landmarks/local-<LABEL>-<ms>.npz (the same format
as the dataset landmark cache, so training reads it unchanged) and listed in
backend/data/local/recordings.csv. Everything under backend/data/ is git-ignored.
"""

from __future__ import annotations

import csv
from dataclasses import replace
import re
import threading
import time
from pathlib import Path

import numpy as np

from .config import BACKEND_DIR
from .vision.landmarks import FrameLandmarks
from .vision.normalization import body_reference
from .vision.serialization import pack

LANDMARK_DIR = BACKEND_DIR / "data" / "landmarks"
INDEX = BACKEND_DIR / "data" / "local" / "recordings.csv"
IDLE = "_IDLE"
FIELDS = ["video", "label", "created_ms", "frames", "hand_frames"]
LABEL_RE = re.compile(r"^(_IDLE|[A-Z][A-Z0-9]{0,23})$")
MIN_HAND_FRAMES = 4
_lock = threading.Lock()


class RecordingError(ValueError):
    pass


def valid_label(label: str) -> bool:
    return bool(LABEL_RE.match(label))


def _rows(index: Path | None = None) -> list[dict]:
    index = index or INDEX
    if not index.exists():
        return []
    with index.open() as f:
        return list(csv.DictReader(f))


def _write(rows: list[dict], index: Path) -> None:
    index.parent.mkdir(parents=True, exist_ok=True)
    tmp = index.with_suffix(".tmp")
    with tmp.open("w", newline="") as f:
        w = csv.DictWriter(f, FIELDS)
        w.writeheader()
        w.writerows(rows)
    tmp.replace(index)


def save(label: str, frames: list[FrameLandmarks], *, landmark_dir: Path | None = None,
         index: Path | None = None) -> dict:
    landmark_dir, index = landmark_dir or LANDMARK_DIR, index or INDEX
    if not valid_label(label):
        raise RecordingError(f"invalid label {label!r}")
    if len(frames) < 8:
        raise RecordingError("too few frames captured; keep the camera running and try again")
    hand_frames = sum(f.has_hands for f in frames)
    if label != IDLE and hand_frames < MIN_HAND_FRAMES:
        raise RecordingError("no hands detected during the take; sign inside the frame")
    if body_reference(frames) is None:
        raise RecordingError("shoulders not detected: move back so your head, both shoulders "
                             "and your hands are all in frame")
    with _lock:
        created = int(time.time() * 1000)
        name = f"local-{label.strip('_')}-{created}"
        landmark_dir.mkdir(parents=True, exist_ok=True)
        t0 = frames[0].timestamp_ms  # store clip-relative times, like the dataset cache
        frames = [replace(f, timestamp_ms=f.timestamp_ms - t0) for f in frames]
        np.savez_compressed(landmark_dir / f"{name}.npz", **pack(frames))
        rows = _rows(index)
        rows.append({"video": f"{name}.npz", "label": label, "created_ms": created,
                     "frames": len(frames), "hand_frames": hand_frames})
        _write(rows, index)
    return {"file": f"{name}.npz", "frames": len(frames), "hand_frames": hand_frames,
            "count": counts(index).get(label, 0)}


def counts(index: Path | None = None) -> dict[str, int]:
    out: dict[str, int] = {}
    for r in _rows(index):
        out[r["label"]] = out.get(r["label"], 0) + 1
    return out


def delete_last(label: str, *, landmark_dir: Path | None = None,
                index: Path | None = None) -> dict:
    """Remove the most recent take of `label` (to discard a bad rep)."""
    landmark_dir, index = landmark_dir or LANDMARK_DIR, index or INDEX
    with _lock:
        rows = _rows(index)
        for i in range(len(rows) - 1, -1, -1):
            if rows[i]["label"] == label:
                (landmark_dir / rows[i]["video"]).unlink(missing_ok=True)
                del rows[i]
                _write(rows, index)
                break
        else:
            raise RecordingError(f"no recordings for {label}")
    return counts(index)
