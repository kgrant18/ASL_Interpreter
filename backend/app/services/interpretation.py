"""Per-session interpretation pipeline.

decode JPEG -> MediaPipe landmarks -> temporal buffer -> SignGRU -> stabilizer -> events

Each WebSocket session owns its own extractor, buffer, stabilizer, sequence counter and
timing stats — nothing mutable is shared between clients except the (thread-safe,
read-only) recognizer weights.

`LiveInterpretationSession` and `SimulatedInterpretationSession` are deliberately
separate classes: simulated captions never pass through the live code path.
"""

from __future__ import annotations

import logging
import time
from collections import deque
from typing import Callable

import cv2
import numpy as np

from ..config import Settings
from ..recognition.base import SignRecognizer
from ..recognition.inference import LandmarkTemporalRecognizer
from ..recognition.stabilizer import Observation, PredictionStabilizer, StabilizerConfig
from ..recognition.vocabulary import english_for
from ..schemas import messages as m
from ..vision.landmarks import FrameLandmarks, LandmarkExtractor
from ..vision.normalization import window_tensor
from ..vision.temporal_buffer import TemporalBuffer

logger = logging.getLogger(__name__)


class FrameError(ValueError):
    """Invalid/undecodable frame from the client (recoverable)."""


def decode_jpeg(data: bytes, max_pixels: int) -> np.ndarray:
    if len(data) < 4 or data[:2] != b"\xff\xd8":
        raise FrameError("frame is not a JPEG image")
    buf = np.frombuffer(data, np.uint8)
    bgr = cv2.imdecode(buf, cv2.IMREAD_COLOR)
    if bgr is None:
        raise FrameError("could not decode JPEG frame")
    h, w = bgr.shape[:2]
    if h * w > max_pixels or h < 32 or w < 32:
        raise FrameError(f"unsupported frame size {w}x{h}")
    return cv2.cvtColor(bgr, cv2.COLOR_BGR2RGB)


def now_ms() -> int:
    return int(time.time() * 1000)


class _Timing:
    def __init__(self) -> None:
        self._stamps: deque[float] = deque(maxlen=30)
        self.dropped = 0
        self.frames = 0

    def tick(self) -> None:
        self._stamps.append(time.perf_counter())
        self.frames += 1

    @property
    def fps(self) -> float:
        if len(self._stamps) < 2:
            return 0.0
        span = self._stamps[-1] - self._stamps[0]
        return round((len(self._stamps) - 1) / span, 1) if span > 0 else 0.0


class BaseSession:
    mode: str = "live"

    def __init__(self, cfg: m.SessionStart, settings: Settings,
                 extractor_factory: Callable[[], LandmarkExtractor] | None = None):
        self.cfg = cfg
        self.settings = settings
        self.session_id = cfg.session_id
        self.timing = _Timing()
        self.extractor = (extractor_factory or LandmarkExtractor)()
        self.last_sequence = -1
        self.closed = False

    def _landmarks(self, jpeg: bytes, capture_ms: float) -> tuple[FrameLandmarks, float]:
        t0 = time.perf_counter()
        rgb = decode_jpeg(jpeg, self.settings.max_frame_pixels)
        lm = self.extractor.process(rgb, int(capture_ms))
        return lm, (time.perf_counter() - t0) * 1000

    def _status(self, seq: int, lm: FrameLandmarks, state: str, perf: m.Performance) -> dict:
        hands = int(lm.left_hand is not None) + int(lm.right_hand is not None)
        return m.ProcessingStatus(
            session_id=self.session_id, timestamp_ms=now_ms(), sequence=seq, state=state,
            hands_visible=hands,
            landmarks=lm.to_overlay() if self.cfg.enable_landmarks else None,
            frame_width=lm.width, frame_height=lm.height, performance=perf,
        ).model_dump()

    def update_config(self, upd: m.ConfigUpdate) -> None:
        if upd.enable_landmarks is not None:
            self.cfg.enable_landmarks = upd.enable_landmarks

    def check_sequence(self, seq: int) -> bool:
        """Monotonic sequence numbers; stale/duplicate frames are dropped."""
        if seq <= self.last_sequence:
            self.timing.dropped += 1
            return False
        self.last_sequence = seq
        return True

    def close(self) -> None:
        if not self.closed:
            self.closed = True
            self.extractor.close()


class LiveInterpretationSession(BaseSession):
    mode = "live"

    def __init__(self, cfg: m.SessionStart, settings: Settings,
                 recognizer: SignRecognizer, **kw):
        super().__init__(cfg, settings, **kw)
        self.recognizer = recognizer
        window_s = getattr(recognizer, "window_s", 1.6)
        self.window_ms = int(window_s * 1000)
        self.buffer = TemporalBuffer(window_ms=self.window_ms + 200, max_frames=90)
        self.stabilizer = PredictionStabilizer(StabilizerConfig(threshold=cfg.threshold))
        self._last_infer_ms: float | None = None
        self._event_id = 0

    def update_config(self, upd: m.ConfigUpdate) -> None:
        super().update_config(upd)
        if upd.threshold is not None:
            self.stabilizer.config.threshold = upd.threshold
            self.cfg.threshold = upd.threshold

    def process_frame(self, seq: int, capture_ms: float, jpeg: bytes) -> list[dict]:
        t0 = time.perf_counter()
        lm, lm_ms = self._landmarks(jpeg, capture_ms)
        return self.process_landmarks(seq, lm, lm_ms, t0)

    def process_landmarks(self, seq: int, lm: FrameLandmarks, lm_ms: float = 0.0,
                          t0: float | None = None) -> list[dict]:
        """Everything after landmark extraction. Also used by offline evaluation so
        reported streaming metrics come from the exact live code path."""
        t0 = t0 if t0 is not None else time.perf_counter()
        self.buffer.append(lm)
        self.timing.tick()
        out: list[dict] = []
        infer_ms = None

        hand_frac = self.buffer.recent_hand_fraction()
        ts = lm.timestamp_ms
        if lm.pose is None and not lm.has_hands:
            state = "no_signer"
            self.stabilizer.update(Observation(ts, None, 0.0))
            # Signer left the frame: drop stale motion so it can't be re-classified.
            self.buffer.clear()
        elif hand_frac < 0.25:
            state = "no_hands"
            self.stabilizer.update(Observation(ts, None, 0.0))
        elif self.buffer.span_ms < 0.75 * self.window_ms:
            state = "collecting"
        elif (self._last_infer_ms is not None
              and ts - self._last_infer_ms < self.settings.inference_interval_ms):
            state = "recognizing"
        else:
            state = "recognizing"
            self._last_infer_ms = ts
            window = window_tensor(self.buffer.frames(), ts - self.window_ms, ts)
            if window is None:
                state = "no_signer"
            else:
                pred = self.recognizer.predict(window)
                infer_ms = pred.inference_ms
                out.extend(self._handle_prediction(seq, ts, pred, lm_ms, t0))

        perf = m.Performance(
            processing_ms=round((time.perf_counter() - t0) * 1000, 1),
            landmark_ms=round(lm_ms, 1),
            inference_ms=round(infer_ms, 2) if infer_ms is not None else None,
            processed_fps=self.timing.fps, dropped_frames=self.timing.dropped,
        )
        out.insert(0, self._status(seq, lm, state, perf))
        return out

    def _handle_prediction(self, seq, ts, pred, lm_ms, t0) -> list[dict]:
        out = []
        top = sorted(pred.scores.items(), key=lambda kv: -kv[1])[:3]
        top_list = [(k, round(v, 3)) for k, v in top] + [("_UNKNOWN", round(pred.unknown_score, 3))]
        obs = Observation(ts, pred.label, pred.score, pred.scores)
        event = self.stabilizer.update(obs)
        if pred.label is None or pred.score < self.stabilizer.config.threshold:
            out.append(m.RecognitionUnknown(
                session_id=self.session_id, timestamp_ms=now_ms(), sequence=seq,
                reason="unsupported_sign" if pred.label is None else "low_confidence",
                unknown_score=round(pred.unknown_score, 3),
            ).model_dump())
        if pred.label is not None:
            out.append(m.RecognitionPartial(
                session_id=self.session_id, timestamp_ms=now_ms(), sequence=seq,
                prediction=m.Prediction(label=pred.label, english=english_for(pred.label),
                                        score=round(pred.score, 3), is_stable=False,
                                        is_unknown=False),
                top=top_list,
            ).model_dump())
        if event is not None:
            self._event_id += 1
            out.append(m.RecognitionResult(
                session_id=self.session_id, timestamp_ms=now_ms(), sequence=seq,
                event_id=self._event_id,
                prediction=m.Prediction(label=event.label, english=english_for(event.label),
                                        score=round(event.score, 3), is_stable=True,
                                        is_unknown=False),
                performance=m.Performance(
                    processing_ms=round((time.perf_counter() - t0) * 1000, 1),
                    landmark_ms=round(lm_ms, 1), inference_ms=round(pred.inference_ms, 2),
                    processed_fps=self.timing.fps, dropped_frames=self.timing.dropped),
            ).model_dump())
        return out

    def close(self) -> None:
        super().close()
        self.buffer.clear()
        self.stabilizer.reset()


SIMULATED_SCRIPT = ["HELLO", "THANKYOU", "HELP", "PLEASE", "YES", "SORRY", "BYE"]


class SimulatedInterpretationSession(BaseSession):
    """SIMULATED DEMO: real capture/transport/landmarks, *scripted* captions.

    Every message it emits carries `simulated: true` and the UI shows a
    "SIMULATED DEMO" badge. It never runs or imitates the recognition model.
    """

    mode = "simulated"
    interval_ms = 3500

    def __init__(self, cfg: m.SessionStart, settings: Settings, **kw):
        super().__init__(cfg, settings, **kw)
        self._start: float | None = None
        self._event_id = 0

    def process_frame(self, seq: int, capture_ms: float, jpeg: bytes) -> list[dict]:
        t0 = time.perf_counter()
        lm, lm_ms = self._landmarks(jpeg, capture_ms)
        self.timing.tick()
        if self._start is None:
            self._start = capture_ms
        out = []
        due = int((capture_ms - self._start) // self.interval_ms)
        perf = m.Performance(processing_ms=round((time.perf_counter() - t0) * 1000, 1),
                             landmark_ms=round(lm_ms, 1), processed_fps=self.timing.fps,
                             dropped_frames=self.timing.dropped)
        out.append(self._status(seq, lm, "recognizing", perf))
        if due > self._event_id:
            label = SIMULATED_SCRIPT[self._event_id % len(SIMULATED_SCRIPT)]
            self._event_id += 1
            out.append(m.RecognitionResult(
                session_id=self.session_id, timestamp_ms=now_ms(), sequence=seq,
                event_id=self._event_id,
                prediction=m.Prediction(label=label, english=english_for(label), score=1.0,
                                        is_stable=True, is_unknown=False),
                performance=perf, simulated=True,
            ).model_dump())
        return out


def create_session(cfg: m.SessionStart, settings: Settings,
                   recognizer: LandmarkTemporalRecognizer | None, **kw) -> BaseSession:
    if cfg.mode == "simulated":
        return SimulatedInterpretationSession(cfg, settings, **kw)
    if recognizer is None or not recognizer.loaded:
        raise RuntimeError("model_unavailable")
    return LiveInterpretationSession(cfg, settings, recognizer, **kw)
