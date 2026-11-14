"""Shared fixtures. Model inference is MOCKED in unit tests (software plumbing only);
real recognition quality is measured separately by training/evaluate.py."""

from __future__ import annotations

import sys
from pathlib import Path

import numpy as np
import pytest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from app.recognition.base import RawPrediction, SignRecognizer, VocabularyEntry  # noqa: E402
from app.vision.landmarks import FrameLandmarks  # noqa: E402


class MockRecognizer(SignRecognizer):
    """Deterministic fake: returns whatever `next_label/next_score` is set to."""

    def __init__(self, labels=("HELLO", "YES")):
        self._labels = list(labels)
        self.next_label: str | None = None
        self.next_score = 0.0
        self.calls = 0
        self.window_s = 1.6

    @property
    def loaded(self) -> bool:
        return True

    def load(self) -> None:
        pass

    def predict(self, window):
        self.calls += 1
        assert window.ndim == 2
        if self.next_label is None:
            return RawPrediction(None, 0.9, {l: 0.05 for l in self._labels}, 0.9, 0.1)
        scores = {l: (self.next_score if l == self.next_label else 0.01) for l in self._labels}
        return RawPrediction(self.next_label, self.next_score, scores, 1 - self.next_score, 0.1)

    def get_vocabulary(self):
        return [VocabularyEntry(l, l.title() + ".", "", True, "mock") for l in self._labels]

    def get_metadata(self):
        return {"name": "mock", "version": "test", "loaded": True, "device": "cpu",
                "mode": "live", "supported_class_count": len(self._labels), "limitations": []}


class FakeExtractor:
    """Stands in for MediaPipe: returns a synthetic signer with hands raised."""

    def __init__(self, hands: bool = True):
        self.hands = hands
        self.closed = False

    def process(self, rgb, ts):
        return synthetic_frame(ts, hands=self.hands, w=rgb.shape[1], h=rgb.shape[0])

    def close(self):
        self.closed = True


def synthetic_frame(ts: int, hands: bool = True, pose: bool = True, w=640, h=480,
                    dx: float = 0.0) -> FrameLandmarks:
    """Software-plumbing fixture only — NOT used to train or evaluate recognition."""
    p = None
    if pose:
        p = np.zeros((33, 4), np.float32)
        p[:, 3] = 1.0
        p[:, :2] = [0.65 + dx, 0.5]  # every point valid by default
        p[11, :2] = [0.55 + dx, 0.6]   # left shoulder (image right)
        p[12, :2] = [0.75 + dx, 0.6]   # right shoulder
        p[15, :2] = [0.5 + dx, 0.4]
        p[16, :2] = [0.8 + dx, 0.4]
        p[0, :2] = [0.65 + dx, 0.35]
    lh = rh = None
    if hands:
        base = np.linspace(0, 0.1, 21 * 3, dtype=np.float32).reshape(21, 3)
        lh = base + np.array([0.5 + dx, 0.4, 0], np.float32)
        rh = base + np.array([0.8 + dx, 0.4, 0], np.float32)
    return FrameLandmarks(timestamp_ms=ts, pose=p, left_hand=lh, right_hand=rh, width=w, height=h)


@pytest.fixture
def mock_recognizer():
    return MockRecognizer()


def jpeg_bytes(w=320, h=240) -> bytes:
    import cv2

    img = np.full((h, w, 3), 127, np.uint8)
    ok, buf = cv2.imencode(".jpg", img)
    assert ok
    return buf.tobytes()


@pytest.fixture(autouse=True)
def _no_real_tts_load(monkeypatch):
    """App tests must not load the real Piper voice (slow; not under test there)."""
    from app.meeting.tts import PiperTTS

    monkeypatch.setattr(PiperTTS, "warm", lambda self: None)
