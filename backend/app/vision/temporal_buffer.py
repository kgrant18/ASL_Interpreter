"""Bounded rolling buffer of per-frame landmarks, keyed by capture timestamp."""

from __future__ import annotations

from collections import deque

from .landmarks import FrameLandmarks


class TemporalBuffer:
    def __init__(self, window_ms: int = 1600, max_frames: int = 90):
        self.window_ms = window_ms
        self._frames: deque[FrameLandmarks] = deque(maxlen=max_frames)

    def __len__(self) -> int:
        return len(self._frames)

    def append(self, frame: FrameLandmarks) -> None:
        if self._frames and frame.timestamp_ms <= self._frames[-1].timestamp_ms:
            # Out-of-order or duplicate timestamp: drop to keep time monotonic.
            return
        self._frames.append(frame)
        cutoff = frame.timestamp_ms - self.window_ms
        while self._frames and self._frames[0].timestamp_ms < cutoff:
            self._frames.popleft()

    def frames(self) -> list[FrameLandmarks]:
        return list(self._frames)

    @property
    def span_ms(self) -> int:
        if len(self._frames) < 2:
            return 0
        return self._frames[-1].timestamp_ms - self._frames[0].timestamp_ms

    def recent_hand_fraction(self, last_ms: int = 600) -> float:
        if not self._frames:
            return 0.0
        end = self._frames[-1].timestamp_ms
        rec = [f for f in self._frames if f.timestamp_ms >= end - last_ms]
        return sum(f.has_hands for f in rec) / len(rec)

    def clear(self) -> None:
        self._frames.clear()
