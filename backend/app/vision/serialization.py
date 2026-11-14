"""Pack/unpack FrameLandmarks sequences to arrays (NaN = missing) for caching."""

from __future__ import annotations

import numpy as np

from .landmarks import FrameLandmarks


def pack(frames: list[FrameLandmarks]) -> dict[str, np.ndarray]:
    n = len(frames)
    pose = np.full((n, 33, 4), np.nan, np.float32)
    lh = np.full((n, 21, 3), np.nan, np.float32)
    rh = np.full((n, 21, 3), np.nan, np.float32)
    for i, f in enumerate(frames):
        if f.pose is not None:
            pose[i] = f.pose
        if f.left_hand is not None:
            lh[i] = f.left_hand
        if f.right_hand is not None:
            rh[i] = f.right_hand
    return {
        "t": np.array([f.timestamp_ms for f in frames], np.int64),
        "pose": pose, "lh": lh, "rh": rh,
        "size": np.array([frames[0].width, frames[0].height] if frames else [0, 0]),
    }


def unpack(d) -> list[FrameLandmarks]:
    out = []
    w, h = (int(v) for v in d["size"])
    for i, t in enumerate(d["t"]):
        def get(a):
            v = a[i]
            return None if np.isnan(v).any() else v
        out.append(FrameLandmarks(timestamp_ms=int(t), pose=get(d["pose"]),
                                  left_hand=get(d["lh"]), right_hand=get(d["rh"]),
                                  width=w, height=h))
    return out
