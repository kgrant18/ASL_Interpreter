"""Training-time window sampling + augmentation over cached landmark clips."""

from __future__ import annotations

import sys
from dataclasses import dataclass
from pathlib import Path

import numpy as np
import pandas as pd

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from app.vision.normalization import (  # noqa: E402
    HAND_DIM, POSE_POINTS, SEQ_LEN, body_reference, frame_features, mirror_features,
    resample_by_time,
)
from app.vision.serialization import unpack  # noqa: E402

LANDMARK_DIR = ROOT / "data" / "landmarks"
UNKNOWN = "_UNKNOWN"

# Live inference window length (seconds). Training samples lengths around it.
LIVE_WINDOW_S = 1.6
TRAIN_WINDOW_RANGE_S = (1.1, 2.1)


@dataclass
class Clip:
    video: str
    label: str
    split: str
    participant: str
    times: np.ndarray   # (T,) ms
    feats: np.ndarray   # (T, F)
    active: tuple[float, float]  # ms range where hands are visible


def load_clips(manifest_path: Path) -> list[Clip]:
    m = pd.read_csv(manifest_path)
    clips = []
    for row in m.itertuples():
        p = LANDMARK_DIR / (Path(row.video).stem + ".npz")
        if not p.exists():
            continue
        frames = unpack(np.load(p))
        ref = body_reference(frames)
        hand_t = [f.timestamp_ms for f in frames if f.has_hands]
        if ref is None or len(hand_t) < 3:
            continue  # no usable signer in this clip
        times = np.array([f.timestamp_ms for f in frames], np.float64)
        feats = np.stack([frame_features(f, ref) for f in frames]).astype(np.float32)
        clips.append(Clip(row.video, row.label, row.split, row.participant, times, feats,
                          (float(hand_t[0]), float(hand_t[-1]))))
    return clips


def central_window(c: Clip, length_s: float = LIVE_WINDOW_S) -> np.ndarray:
    """Deterministic window centered on the active signing segment (for eval)."""
    mid = (c.active[0] + c.active[1]) / 2
    half = length_s * 500
    return resample_by_time(c.times, c.feats, mid - half, mid + half, SEQ_LEN)


def sample_window(c: Clip, rng: np.random.Generator, partial: bool = False) -> np.ndarray:
    """Random window. `partial=True` yields a window that only grazes the sign."""
    w = rng.uniform(*TRAIN_WINDOW_RANGE_S) * 1000
    a0, a1 = c.active
    alen = max(a1 - a0, 1.0)
    if partial:
        # window mostly before or after the active segment (<30% coverage)
        cover = rng.uniform(0.05, 0.3) * alen
        start = a0 + cover - w if rng.random() < 0.5 else a1 - cover
    elif alen <= w:
        # whole sign inside, with ≥ ~85% coverage allowed at edges
        slack = 0.15 * alen
        start = rng.uniform(a1 - w - slack, a0 + slack)
    else:
        start = rng.uniform(a0, a1 - w)
    return resample_by_time(c.times, c.feats, start, start + w, SEQ_LEN)


def augment(x: np.ndarray, rng: np.random.Generator) -> np.ndarray:
    x = x.copy()
    if rng.random() < 0.5:
        x = mirror_features(x)
    ang = np.deg2rad(rng.uniform(-12, 12))
    rot = np.array([[np.cos(ang), -np.sin(ang)], [np.sin(ang), np.cos(ang)]], np.float32)
    scale = rng.uniform(0.85, 1.15)
    shift = rng.normal(0, 0.15, 2).astype(np.float32)
    for h in range(2):
        b = h * HAND_DIM
        present = x[:, b] > 0.5
        wr = x[:, b + 1:b + 3] @ rot.T * scale + shift
        x[:, b + 1:b + 3] = np.where(present[:, None], wr, 0)
        local = x[:, b + 3:b + HAND_DIM].reshape(len(x), 21, 3)
        local[..., :2] = local[..., :2] @ rot.T * rng.uniform(0.9, 1.1)
        local += rng.normal(0, 0.03, local.shape).astype(np.float32)
        local[~present] = 0
        x[:, b + 3:b + HAND_DIM] = local.reshape(len(x), -1)
        # simulate missed detections
        drop = rng.random(len(x)) < 0.06
        x[drop, b:b + HAND_DIM] = 0
    pb = 2 * HAND_DIM
    present = x[:, pb] > 0.5
    pts = x[:, pb + 1:].reshape(len(x), len(POSE_POINTS), 2)
    nz = np.abs(pts).sum(-1, keepdims=True) > 0
    pts = np.where(nz, pts @ rot.T * scale + shift, 0)
    pts[~present] = 0
    x[:, pb + 1:] = pts.reshape(len(x), -1)
    return x
