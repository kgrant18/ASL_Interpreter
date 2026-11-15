"""Body-relative landmark normalization and fixed-length window construction.

Coordinate system (per window):
  origin = median shoulder midpoint across the window
  unit   = median shoulder width across the window
Using window-level (not per-frame) reference keeps genuine body/hand motion
intact while removing camera position, distance and body-size effects.

Per-frame feature vector (FEATURE_DIM values):
  for each hand (signer-left, signer-right):
     presence flag                                   1
     wrist position, body-relative (x, y)            2
     hand shape: 21 landmarks relative to wrist,
       scaled by palm size (x, y, z)                63
  pose:
     presence flag                                   1
     9 upper-body/face points body-relative (x, y)  18
Missing parts are zeros *with presence flag 0* (explicit, never fake coordinates).
"""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np

from .landmarks import FrameLandmarks

# nose, left eye, right eye, mouth left, mouth right, shoulders, elbows, wrists
POSE_POINTS = [0, 2, 5, 9, 10, 11, 12, 13, 14]
L_SHOULDER, R_SHOULDER = 11, 12

HAND_DIM = 1 + 2 + 21 * 3
POSE_DIM = 1 + len(POSE_POINTS) * 2
FEATURE_DIM = 2 * HAND_DIM + POSE_DIM  # 151

# Number of time steps the classifier sees; windows are resampled by *time*, so the
# result is independent of the capture frame rate.
SEQ_LEN = 24


@dataclass
class BodyReference:
    origin: np.ndarray  # (2,)
    scale: float


# Shoulder width in aspect-corrected image heights. ASL Citizen clips are >= 0.44
# (1st percentile); a pose detected at a few hundredths is a mis-detection.
MIN_SHOULDER_WIDTH = 0.12


def body_reference(frames: list[FrameLandmarks]) -> BodyReference | None:
    """Window-level reference from shoulders. None when no usable pose exists."""
    centers, widths = [], []
    for f in frames:
        if f.pose is None:
            continue
        ls, rs = f.pose[L_SHOULDER], f.pose[R_SHOULDER]
        if min(ls[3], rs[3]) < 0.3:
            continue
        centers.append((ls[:2] + rs[:2]) / 2)
        widths.append(np.linalg.norm(ls[:2] - rs[:2]))
    if not centers:
        return None
    scale = float(np.median(widths))
    if scale < MIN_SHOULDER_WIDTH:
        return None  # pose collapsed/mis-detected (e.g. signer too close): not a usable body
    return BodyReference(origin=np.median(np.array(centers), axis=0), scale=scale)


def _hand_features(hand: np.ndarray | None, ref: BodyReference) -> np.ndarray:
    out = np.zeros(HAND_DIM, dtype=np.float32)
    if hand is None:
        return out
    out[0] = 1.0
    wrist = hand[0]
    out[1:3] = (wrist[:2] - ref.origin) / ref.scale
    # Palm size: wrist to middle-finger MCP; robust hand-shape scale.
    palm = float(np.linalg.norm(hand[9, :2] - wrist[:2]))
    palm = max(palm, 1e-3)
    local = (hand - wrist) / palm
    out[3:] = local.reshape(-1)
    return out


def _pose_features(pose: np.ndarray | None, ref: BodyReference) -> np.ndarray:
    out = np.zeros(POSE_DIM, dtype=np.float32)
    if pose is None:
        return out
    out[0] = 1.0
    pts = (pose[POSE_POINTS, :2] - ref.origin) / ref.scale
    vis = pose[POSE_POINTS, 3] >= 0.3
    pts[~vis] = 0.0  # invisible points carry no information
    out[1:] = pts.reshape(-1)
    return out


def frame_features(f: FrameLandmarks, ref: BodyReference) -> np.ndarray:
    return np.concatenate([
        _hand_features(f.left_hand, ref),
        _hand_features(f.right_hand, ref),
        _pose_features(f.pose, ref),
    ])


def resample_by_time(times_ms: np.ndarray, feats: np.ndarray, start_ms: float,
                     end_ms: float, n: int = SEQ_LEN) -> np.ndarray:
    """Nearest-observation resampling onto n evenly spaced instants in [start, end].

    Nearest (not linear) interpolation so presence flags stay exactly 0/1 and we never
    interpolate between a present and a missing hand.
    """
    targets = np.linspace(start_ms, end_ms, n)
    idx = np.searchsorted(times_ms, targets)
    idx = np.clip(idx, 0, len(times_ms) - 1)
    prev = np.clip(idx - 1, 0, len(times_ms) - 1)
    use_prev = np.abs(times_ms[prev] - targets) < np.abs(times_ms[idx] - targets)
    idx = np.where(use_prev, prev, idx)
    return feats[idx]


def window_tensor(frames: list[FrameLandmarks], start_ms: float | None = None,
                  end_ms: float | None = None, n: int = SEQ_LEN) -> np.ndarray | None:
    """Build an (n, FEATURE_DIM) array for a window of frames, or None if no signer."""
    if not frames:
        return None
    if start_ms is None:
        start_ms = frames[0].timestamp_ms
    if end_ms is None:
        end_ms = frames[-1].timestamp_ms
    sel = [f for f in frames if start_ms - 1 <= f.timestamp_ms <= end_ms + 1]
    if not sel:
        return None
    ref = body_reference(sel)
    if ref is None:
        return None
    times = np.array([f.timestamp_ms for f in sel], dtype=np.float64)
    feats = np.stack([frame_features(f, ref) for f in sel])
    return resample_by_time(times, feats, start_ms, end_ms, n)


def mirror_features(x: np.ndarray) -> np.ndarray:
    """Horizontally mirror a feature window (swap hands, negate x). Used for
    augmentation so left- and right-dominant signers are both covered."""
    x = x.copy()
    left = x[..., :HAND_DIM].copy()
    right = x[..., HAND_DIM:2 * HAND_DIM].copy()
    for h in (left, right):
        h[..., 1] *= -1  # wrist x
        h[..., 3::3] *= -1  # local x
    x[..., :HAND_DIM] = right
    x[..., HAND_DIM:2 * HAND_DIM] = left
    pose = x[..., 2 * HAND_DIM:]
    pts = pose[..., 1:].reshape(*pose.shape[:-1], len(POSE_POINTS), 2).copy()
    pts[..., 0] *= -1
    # swap left/right paired points: eyes(1,2) mouth(3,4) shoulders(5,6) elbows(7,8)
    for a, b in ((1, 2), (3, 4), (5, 6), (7, 8)):
        pts[..., [a, b], :] = pts[..., [b, a], :]
    pose[..., 1:] = pts.reshape(*pose.shape[:-1], -1)
    x[..., 2 * HAND_DIM:] = pose
    return x
