"""MediaPipe landmark extraction (hands + upper body pose).

One `LandmarkExtractor` per session / per video: MediaPipe VIDEO mode keeps temporal
tracking state and requires strictly increasing timestamps.

The same extractor is used by the offline training pipeline and the live WebSocket
pipeline, so features are computed identically in both.
"""

from __future__ import annotations

import logging
import threading
from dataclasses import dataclass
from pathlib import Path

import numpy as np

logger = logging.getLogger(__name__)

MODELS_DIR = Path(__file__).resolve().parents[2] / "models" / "mediapipe"
HAND_MODEL = MODELS_DIR / "hand_landmarker.task"
POSE_MODEL = MODELS_DIR / "pose_landmarker_lite.task"

# Frames are resized so the longest side is at most this many pixels before
# landmark extraction (both offline and live), keeping conditions consistent.
MAX_SIDE = 640

POSE_LEFT_WRIST = 15
POSE_RIGHT_WRIST = 16


@dataclass
class FrameLandmarks:
    """Landmarks for one frame, in *aspect-corrected* image units.

    x is multiplied by (width / height) so x and y share a unit (image heights).
    Missing parts are `None` — never filled with fake coordinates.

    "left"/"right" refer to the signer's body sides, assigned by proximity to the
    pose wrists (falls back to MediaPipe handedness when no pose is visible).
    """

    timestamp_ms: int
    pose: np.ndarray | None = None        # (33, 4): x, y, z, visibility
    left_hand: np.ndarray | None = None   # (21, 3)
    right_hand: np.ndarray | None = None  # (21, 3)
    width: int = 0
    height: int = 0

    @property
    def has_hands(self) -> bool:
        return self.left_hand is not None or self.right_hand is not None

    def to_overlay(self) -> dict:
        """Compact, normalized [0,1] landmarks for the frontend overlay."""
        aspect = self.width / self.height if self.height else 1.0

        def pts(a: np.ndarray | None) -> list | None:
            if a is None:
                return None
            return [[round(float(p[0] / aspect), 4), round(float(p[1]), 4)] for p in a]

        pose = None
        if self.pose is not None:
            pose = pts(self.pose[:25])  # upper body only
        return {"pose": pose, "left_hand": pts(self.left_hand), "right_hand": pts(self.right_hand)}


def resize_for_landmarks(rgb: np.ndarray) -> np.ndarray:
    import cv2

    h, w = rgb.shape[:2]
    scale = MAX_SIDE / max(h, w)
    if scale < 1.0:
        rgb = cv2.resize(rgb, (int(w * scale), int(h * scale)), interpolation=cv2.INTER_AREA)
    return rgb


class LandmarkExtractor:
    """Wraps MediaPipe HandLandmarker + PoseLandmarker in VIDEO running mode."""

    def __init__(self, min_hand_confidence: float = 0.5, min_pose_confidence: float = 0.5):
        import mediapipe as mp
        from mediapipe.tasks.python import BaseOptions, vision

        if not HAND_MODEL.exists() or not POSE_MODEL.exists():
            raise FileNotFoundError(
                f"MediaPipe model files missing in {MODELS_DIR}. Run ./scripts/setup.sh"
            )
        self._mp = mp
        self._lock = threading.Lock()
        self._hands = vision.HandLandmarker.create_from_options(
            vision.HandLandmarkerOptions(
                base_options=BaseOptions(model_asset_path=str(HAND_MODEL)),
                running_mode=vision.RunningMode.VIDEO,
                num_hands=2,
                min_hand_detection_confidence=min_hand_confidence,
                min_hand_presence_confidence=min_hand_confidence,
                min_tracking_confidence=0.5,
            )
        )
        self._pose = vision.PoseLandmarker.create_from_options(
            vision.PoseLandmarkerOptions(
                base_options=BaseOptions(model_asset_path=str(POSE_MODEL)),
                running_mode=vision.RunningMode.VIDEO,
                num_poses=1,
                min_pose_detection_confidence=min_pose_confidence,
                min_pose_presence_confidence=min_pose_confidence,
            )
        )
        self._last_ts = -1
        self._closed = False

    def process(self, rgb: np.ndarray, timestamp_ms: int) -> FrameLandmarks:
        """Extract landmarks from an RGB uint8 image."""
        rgb = resize_for_landmarks(rgb)
        h, w = rgb.shape[:2]
        aspect = w / h
        with self._lock:
            if self._closed:
                raise RuntimeError("extractor closed")
            # MediaPipe requires strictly increasing timestamps.
            ts = max(int(timestamp_ms), self._last_ts + 1)
            self._last_ts = ts
            image = self._mp.Image(image_format=self._mp.ImageFormat.SRGB,
                                   data=np.ascontiguousarray(rgb))
            hand_res = self._hands.detect_for_video(image, ts)
            pose_res = self._pose.detect_for_video(image, ts)

        out = FrameLandmarks(timestamp_ms=int(timestamp_ms), width=w, height=h)
        if pose_res.pose_landmarks:
            out.pose = np.array(
                [[p.x * aspect, p.y, p.z, p.visibility if p.visibility is not None else 1.0]
                 for p in pose_res.pose_landmarks[0]],
                dtype=np.float32,
            )

        hands = []
        for lms, handed in zip(hand_res.hand_landmarks, hand_res.handedness):
            arr = np.array([[p.x * aspect, p.y, p.z] for p in lms], dtype=np.float32)
            # MediaPipe handedness assumes a mirrored (selfie) image; for an unmirrored
            # frame its "Left" is the signer's right hand.
            label = handed[0].category_name if handed else None
            hands.append((arr, label))
        _assign_hands(out, hands)
        return out

    def close(self) -> None:
        with self._lock:
            if self._closed:
                return
            self._closed = True
            for obj in (self._hands, self._pose):
                try:
                    obj.close()
                except Exception:  # pragma: no cover - best effort cleanup
                    logger.exception("error closing mediapipe task")

    def __enter__(self) -> "LandmarkExtractor":
        return self

    def __exit__(self, *exc) -> None:
        self.close()


def _assign_hands(out: FrameLandmarks, hands: list[tuple[np.ndarray, str | None]]) -> None:
    """Assign detected hands to the signer's left/right side."""
    if not hands:
        return
    if out.pose is not None:
        lw = out.pose[POSE_LEFT_WRIST, :2]
        rw = out.pose[POSE_RIGHT_WRIST, :2]
        if len(hands) == 1:
            arr = hands[0][0]
            d_l = np.linalg.norm(arr[0, :2] - lw)
            d_r = np.linalg.norm(arr[0, :2] - rw)
            if d_l <= d_r:
                out.left_hand = arr
            else:
                out.right_hand = arr
        else:
            a, b = hands[0][0], hands[1][0]
            cost_ab = np.linalg.norm(a[0, :2] - lw) + np.linalg.norm(b[0, :2] - rw)
            cost_ba = np.linalg.norm(b[0, :2] - lw) + np.linalg.norm(a[0, :2] - rw)
            out.left_hand, out.right_hand = (a, b) if cost_ab <= cost_ba else (b, a)
        return
    # No pose: fall back to MediaPipe's (mirrored) handedness labels.
    for arr, label in hands[:2]:
        if label == "Left" and out.right_hand is None:
            out.right_hand = arr
        elif label == "Right" and out.left_hand is None:
            out.left_hand = arr
        elif out.right_hand is None:
            out.right_hand = arr
        else:
            out.left_hand = arr
