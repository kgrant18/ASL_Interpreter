"""WebSocket protocol schemas.

Client -> server
  text   {"type": "session.start", ...SessionStart}
  text   {"type": "session.stop", "session_id": ...}
  text   {"type": "config.update", "session_id": ..., "threshold": 0.6}
  binary frame: <uint32 LE sequence><float64 LE capture_ms><JPEG bytes>

Server -> client (JSON text): see the models below; every message carries `session_id`.
"""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field

FRAME_HEADER_BYTES = 12


class SessionStart(BaseModel):
    type: Literal["session.start"]
    session_id: str = Field(min_length=8, max_length=64)
    source: Literal["webcam", "meeting"] = "webcam"
    mode: Literal["live", "simulated", "record"] = "live"
    target_fps: float = Field(default=15, ge=1, le=30)
    enable_landmarks: bool = True
    enable_tts: bool = True
    threshold: float = Field(default=0.7, ge=0.3, le=0.99)


class SessionStop(BaseModel):
    type: Literal["session.stop"]
    session_id: str


class ConfigUpdate(BaseModel):
    type: Literal["config.update"]
    session_id: str
    threshold: float | None = Field(default=None, ge=0.3, le=0.99)
    enable_landmarks: bool | None = None


class RecordBegin(BaseModel):
    type: Literal["record.begin"]
    session_id: str
    label: str = Field(min_length=1, max_length=24)


class RecordEnd(BaseModel):
    type: Literal["record.end"]
    session_id: str
    discard: bool = False


class Prediction(BaseModel):
    label: str
    english: str
    score: float
    is_stable: bool
    is_unknown: bool


class Performance(BaseModel):
    processing_ms: float
    landmark_ms: float | None = None
    inference_ms: float | None = None
    processed_fps: float
    dropped_frames: int = 0


class _Base(BaseModel):
    session_id: str
    timestamp_ms: int


class SessionStarted(_Base):
    type: Literal["session.started"] = "session.started"
    mode: Literal["live", "simulated", "record"]
    window_seconds: float
    model_loaded: bool


class SessionStopped(_Base):
    type: Literal["session.stopped"] = "session.stopped"
    frames_processed: int


class ProcessingStatus(_Base):
    """Sent once per processed frame (acts as the frame ack for backpressure)."""

    type: Literal["processing.status"] = "processing.status"
    sequence: int
    state: Literal["no_signer", "no_hands", "collecting", "recognizing", "idle"]
    hands_visible: int
    landmarks: dict | None = None
    frame_width: int
    frame_height: int
    performance: Performance


class RecognitionPartial(_Base):
    type: Literal["recognition.partial"] = "recognition.partial"
    sequence: int
    prediction: Prediction
    top: list[tuple[str, float]]
    simulated: bool = False


class RecognitionResult(_Base):
    type: Literal["recognition.result"] = "recognition.result"
    sequence: int
    event_id: int
    prediction: Prediction
    performance: Performance
    simulated: bool = False
    # Set when the result is a matched sentence: the signs actually recognized.
    glosses: list[str] | None = None
    phrase_id: str | None = None


class RecognitionSign(_Base):
    """A stable individual sign while sentences are matched (shown, never spoken)."""

    type: Literal["recognition.sign"] = "recognition.sign"
    sequence: int
    label: str
    score: float
    pending: list[str]


class RecognitionUnknown(_Base):
    type: Literal["recognition.unknown"] = "recognition.unknown"
    sequence: int
    reason: Literal["low_confidence", "unsupported_sign"]
    unknown_score: float


class RecordSaved(_Base):
    type: Literal["record.saved"] = "record.saved"
    label: str
    ok: bool
    message: str = ""
    frames: int = 0
    hand_frames: int = 0
    count: int = 0


class ErrorMessage(BaseModel):
    type: Literal["error"] = "error"
    session_id: str | None = None
    code: str
    message: str
    recoverable: bool = True
