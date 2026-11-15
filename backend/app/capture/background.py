"""Background capture: the backend reads the webcam itself and runs recognition.

Why: browsers throttle hidden/minimized tabs, so capture stops while Zoom is in front.
This thread runs the *same* pipeline as the browser path
(landmarks -> LiveInterpretationSession -> stabilizer -> phrase matcher) on frames read
straight from the camera with OpenCV (AVFoundation on macOS).

On macOS several apps can use the camera at the same time, so Zoom keeps its video.

Recognized phrases are handed to `on_phrase` (the meeting output: BlackHole voice +
Zoom captions) and kept in a short history that the UI and menu-bar indicator poll.
"""

from __future__ import annotations

import logging
import sys
import threading
import time
import uuid
from collections import deque
from dataclasses import dataclass, field
from typing import Callable, Protocol

import cv2
import numpy as np

from ..config import Settings
from ..recognition.base import SignRecognizer
from ..schemas import messages as m
from ..services.interpretation import LiveInterpretationSession
from ..vision.landmarks import LandmarkExtractor

logger = logging.getLogger(__name__)

TARGET_FPS = 15.0
REOPEN_DELAY_S = 2.0
MAX_READ_FAILURES = 15          # ~0.5-1 s of failed reads -> reopen the camera
CAMERA_HELP = ("Could not open the camera. Allow camera access for the app that runs "
               "SignBridge (Terminal, or Claude) in System Settings → Privacy & Security → "
               "Camera, then press Start again.")


class Camera(Protocol):
    def read(self) -> tuple[bool, np.ndarray | None]: ...
    def release(self) -> None: ...


class OpenCVCamera:
    """Thin wrapper around cv2.VideoCapture (AVFoundation on macOS)."""

    def __init__(self, index: int = 0, width: int = 640, height: int = 480):
        backend = cv2.CAP_AVFOUNDATION if sys.platform == "darwin" else cv2.CAP_ANY
        self.cap = cv2.VideoCapture(index, backend)
        if not self.cap.isOpened():
            self.cap.release()
            raise RuntimeError(CAMERA_HELP)
        self.cap.set(cv2.CAP_PROP_FRAME_WIDTH, width)
        self.cap.set(cv2.CAP_PROP_FRAME_HEIGHT, height)

    def read(self):
        return self.cap.read()

    def release(self) -> None:
        self.cap.release()


@dataclass
class PhraseEvent:
    id: str
    english: str
    glosses: list[str]
    score: float
    at: float                       # unix seconds
    sent: bool                      # handed to meeting output


@dataclass
class _State:
    camera: str = "off"             # off | starting | on | error
    camera_error: str | None = None
    recognition: str = "off"        # off | no_signer | no_hands | collecting | recognizing
    hands_visible: int = 0
    shoulders_ok: bool = False
    fps: float = 0.0
    frame_width: int = 0
    frame_height: int = 0
    last_frame_at: float | None = None
    last_sign: str | None = None
    pending: list[str] = field(default_factory=list)


class BackgroundRecognizer:
    def __init__(self, settings: Settings, recognizer: SignRecognizer,
                 on_phrase: Callable[[str, list[str]], bool] | None = None,
                 camera_factory: Callable[[], Camera] | None = None,
                 extractor_factory: Callable[[], LandmarkExtractor] = LandmarkExtractor,
                 fps: float = TARGET_FPS, clock: Callable[[], float] = time.time):
        self.settings = settings
        self.recognizer = recognizer
        self.on_phrase = on_phrase
        self.camera_factory = camera_factory or (
            lambda: OpenCVCamera(settings.camera_index))
        self.extractor_factory = extractor_factory
        self.fps = fps
        self.clock = clock
        self.threshold = 0.7
        self.history: deque[PhraseEvent] = deque(maxlen=50)
        self._state = _State()
        self._lock = threading.Lock()
        self._stop = threading.Event()
        self._thread: threading.Thread | None = None
        self.started_at: float | None = None
        self._last: tuple[np.ndarray, object] | None = None

    def preview_jpeg(self, max_side: int = 480) -> bytes | None:
        """Latest camera frame with the landmark overlay (for framing; kept in memory only)."""
        last = self._last if self.running else None
        if last is None:
            return None
        bgr, lm = last
        img = bgr.copy()
        h, w = img.shape[:2]
        ov = lm.to_overlay()
        pose = ov.get("pose")
        if pose:
            for a, b in ((11, 12), (11, 13), (13, 15), (12, 14), (14, 16)):
                pa, pb = pose[a], pose[b]
                cv2.line(img, (int(pa[0] * w), int(pa[1] * h)), (int(pb[0] * w), int(pb[1] * h)),
                         (94, 111, 47), 3)
        for key in ("left_hand", "right_hand"):
            for x, y in ov.get(key) or []:
                cv2.circle(img, (int(x * w), int(y * h)), 3, (164, 188, 108), -1)
        img = cv2.flip(img, 1)  # mirror like a selfie view
        scale = max_side / max(h, w)
        if scale < 1:
            img = cv2.resize(img, (int(w * scale), int(h * scale)), interpolation=cv2.INTER_AREA)
        ok, buf = cv2.imencode(".jpg", img, [cv2.IMWRITE_JPEG_QUALITY, 70])
        return buf.tobytes() if ok else None

    # ---- control ----
    @property
    def running(self) -> bool:
        return self._thread is not None and self._thread.is_alive()

    def start(self) -> None:
        if self.running:
            return
        if self.recognizer is None or not getattr(self.recognizer, "loaded", False):
            raise RuntimeError("recognition is unavailable")
        self._stop.clear()
        with self._lock:
            self._state = _State(camera="starting", recognition="off")
        self.started_at = self.clock()
        self._thread = threading.Thread(target=self._run, name="background-capture",
                                        daemon=True)
        self._thread.start()

    def stop(self, timeout: float = 5.0) -> None:
        self._stop.set()
        t = self._thread
        if t is not None:
            t.join(timeout=timeout)
        self._thread = None
        with self._lock:
            self._state = _State()
        self.started_at = None
        self._last = None

    # ---- worker ----
    def _new_session(self) -> LiveInterpretationSession:
        cfg = m.SessionStart(type="session.start", session_id="background-" + uuid.uuid4().hex[:8],
                             source="webcam", mode="live", target_fps=min(self.fps, 30),
                             enable_landmarks=False, enable_tts=False,
                             threshold=self.threshold)
        return LiveInterpretationSession(cfg, self.settings, self.recognizer,
                                         extractor_factory=self.extractor_factory)

    def _run(self) -> None:
        session = None
        try:
            session = self._new_session()
        except Exception as exc:  # pragma: no cover - model files missing etc.
            logger.exception("background session failed to start")
            self._set(camera="error", camera_error=f"recognition failed to start: {exc}")
            return
        try:
            while not self._stop.is_set():
                cam = self._open_camera()
                if cam is None:
                    continue
                try:
                    self._capture_loop(cam, session)
                finally:
                    cam.release()
        finally:
            session.close()

    def _open_camera(self) -> Camera | None:
        self._set(camera="starting")
        try:
            cam = self.camera_factory()
        except Exception as exc:
            logger.warning("camera open failed: %s", exc)
            self._set(camera="error", camera_error=str(exc), recognition="off")
            self._stop.wait(REOPEN_DELAY_S)
            return None
        return cam

    def _capture_loop(self, cam: Camera, session: LiveInterpretationSession) -> None:
        interval = 1.0 / self.fps
        last = 0.0
        failures = 0
        seq = 0
        while not self._stop.is_set():
            ok, frame = cam.read()
            if not ok or frame is None:
                failures += 1
                if failures >= MAX_READ_FAILURES:
                    self._set(camera="error", recognition="off",
                              camera_error="The camera stopped sending frames (unplugged, "
                                           "or taken by another app). Retrying…")
                    self._stop.wait(REOPEN_DELAY_S)
                    return
                self._stop.wait(0.05)
                continue
            failures = 0
            now = time.perf_counter()
            if now - last < interval * 0.92:
                continue
            last = now
            seq += 1
            self._process(session, seq, frame)

    def _process(self, session: LiveInterpretationSession, seq: int, bgr: np.ndarray) -> None:
        t0 = time.perf_counter()
        rgb = cv2.cvtColor(bgr, cv2.COLOR_BGR2RGB)
        ts = int(self.clock() * 1000)
        lm = session.extractor.process(rgb, ts)
        lm_ms = (time.perf_counter() - t0) * 1000
        self._last = (bgr, lm)
        outs = session.process_landmarks(seq, lm, lm_ms, t0)
        for msg in outs:
            self._handle(msg, lm)

    def _handle(self, msg: dict, lm) -> None:
        kind = msg.get("type")
        if kind == "processing.status":
            from ..vision.normalization import body_reference
            self._set(camera="on", camera_error=None, recognition=msg["state"],
                      hands_visible=msg["hands_visible"],
                      shoulders_ok=body_reference([lm]) is not None,
                      fps=msg["performance"]["processed_fps"],
                      frame_width=msg["frame_width"], frame_height=msg["frame_height"],
                      last_frame_at=self.clock())
        elif kind == "recognition.sign":
            self._set(last_sign=msg["label"], pending=list(msg["pending"]))
        elif kind == "recognition.result" and msg.get("phrase_id"):
            pred = msg["prediction"]
            sent = False
            if self.on_phrase is not None:
                try:
                    sent = bool(self.on_phrase(pred["english"], list(msg["glosses"])))
                except Exception:
                    logger.exception("phrase output failed")
            self.history.appendleft(PhraseEvent(
                id=uuid.uuid4().hex[:12], english=pred["english"], glosses=list(msg["glosses"]),
                score=pred["score"], at=self.clock(), sent=sent))
            self._set(pending=[])

    def _set(self, **kw) -> None:
        with self._lock:
            for k, v in kw.items():
                setattr(self._state, k, v)

    # ---- reporting ----
    def status(self) -> dict:
        with self._lock:
            s = self._state
            stale = (s.last_frame_at is not None and self.running
                     and self.clock() - s.last_frame_at > 3.0)
            return {
                "running": self.running,
                "started_at": self.started_at,
                "camera": {"state": "error" if stale else s.camera,
                           "error": "No frames for over 3 seconds." if stale else s.camera_error,
                           "index": self.settings.camera_index,
                           "width": s.frame_width, "height": s.frame_height, "fps": s.fps},
                "recognition": {"state": s.recognition if self.running else "off",
                                "hands_visible": s.hands_visible,
                                "shoulders_visible": s.shoulders_ok,
                                "last_sign": s.last_sign, "pending": s.pending},
                "history": [vars(e) for e in list(self.history)[:20]],
            }
