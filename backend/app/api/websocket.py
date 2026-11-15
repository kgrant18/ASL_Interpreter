"""WS /ws/interpret — real-time interpretation endpoint.

Backpressure: the reader keeps only the *latest* unprocessed frame (a 1-slot mailbox);
a frame that arrives while another is waiting replaces it and is counted as dropped.
The browser additionally keeps at most one frame in flight (it waits for the
`processing.status` ack), so queues are bounded on both ends.
"""

from __future__ import annotations

import asyncio
import json
import logging
import struct

from fastapi import APIRouter, WebSocket, WebSocketDisconnect
from pydantic import ValidationError

from ..config import settings
from ..schemas import messages as m
from .. import recordings
from ..services.interpretation import (
    BaseSession, FrameError, RecordingSession, create_session, now_ms,
)

logger = logging.getLogger(__name__)
router = APIRouter()

MAX_TEXT_BYTES = 16_384


def _err(code: str, message: str, session_id: str | None = None,
         recoverable: bool = True) -> dict:
    return m.ErrorMessage(session_id=session_id, code=code, message=message,
                          recoverable=recoverable).model_dump()


class Connection:
    def __init__(self, ws: WebSocket, recognizer):
        self.ws = ws
        self.recognizer = recognizer
        self.session: BaseSession | None = None
        self.lock = asyncio.Lock()          # serializes processing vs start/stop
        self.pending: tuple[int, float, bytes] | None = None
        self.wake = asyncio.Event()
        self.send_lock = asyncio.Lock()

    async def send(self, msg: dict) -> None:
        async with self.send_lock:
            await self.ws.send_text(json.dumps(msg))

    # ---- control messages -------------------------------------------------
    async def handle_text(self, text: str) -> None:
        if len(text) > MAX_TEXT_BYTES:
            await self.send(_err("message_too_large", "Control message too large."))
            return
        try:
            data = json.loads(text)
            kind = data.get("type")
        except (json.JSONDecodeError, AttributeError):
            await self.send(_err("invalid_message", "Control message must be a JSON object."))
            return
        try:
            if kind == "session.start":
                await self.start(m.SessionStart.model_validate(data))
            elif kind == "session.stop":
                await self.stop(m.SessionStop.model_validate(data).session_id)
            elif kind == "config.update":
                upd = m.ConfigUpdate.model_validate(data)
                if self.session and upd.session_id == self.session.session_id:
                    self.session.update_config(upd)
            elif kind == "record.begin":
                msg = m.RecordBegin.model_validate(data)
                if not recordings.valid_label(msg.label):
                    await self.send(_err("invalid_label", f"Invalid label {msg.label!r}."))
                elif self._recording(msg.session_id):
                    self.session.begin(msg.label)
            elif kind == "record.end":
                msg = m.RecordEnd.model_validate(data)
                if self._recording(msg.session_id):
                    await self.finish_take(msg)
            elif kind == "ping":
                await self.send({"type": "pong", "timestamp_ms": now_ms()})
            else:
                await self.send(_err("unknown_message", f"Unknown message type: {kind!r}"))
        except ValidationError as exc:
            first = exc.errors()[0]
            loc = ".".join(str(p) for p in first.get("loc", ()))
            await self.send(_err("invalid_config", f"Invalid {loc}: {first.get('msg')}"))

    def _recording(self, session_id: str) -> bool:
        return isinstance(self.session, RecordingSession) and self.session.session_id == session_id

    async def finish_take(self, msg: m.RecordEnd) -> None:
        async with self.lock:  # waits for the frame being processed
            label, frames = self.session.end()
        if label is None or msg.discard:
            return
        reply = dict(session_id=msg.session_id, timestamp_ms=now_ms(), label=label)
        try:
            info = await asyncio.to_thread(recordings.save, label, frames)
            out = m.RecordSaved(ok=True, frames=info["frames"], hand_frames=info["hand_frames"],
                                count=info["count"], **reply)
        except recordings.RecordingError as exc:
            out = m.RecordSaved(ok=False, message=str(exc), frames=len(frames), **reply)
        await self.send(out.model_dump())

    async def start(self, cfg: m.SessionStart) -> None:
        async with self.lock:
            await self._close_session()
            self.pending = None
            try:
                self.session = await asyncio.to_thread(
                    create_session, cfg, settings, self.recognizer)
            except RuntimeError as exc:
                if str(exc) == "model_unavailable":
                    await self.send(_err(
                        "model_unavailable",
                        "The recognition model is not loaded. Train it (see README) or "
                        "use the clearly labeled Simulated Demo mode.",
                        cfg.session_id))
                    return
                raise
            except FileNotFoundError as exc:
                await self.send(_err("landmarker_unavailable", str(exc), cfg.session_id))
                return
        window = getattr(self.recognizer, "window_s", 1.6) if self.recognizer else 1.6
        await self.send(m.SessionStarted(
            session_id=cfg.session_id, timestamp_ms=now_ms(), mode=cfg.mode,
            window_seconds=window,
            model_loaded=bool(self.recognizer and self.recognizer.loaded)).model_dump())
        logger.info("session %s started (%s, %s)", cfg.session_id, cfg.source, cfg.mode)

    async def stop(self, session_id: str) -> None:
        async with self.lock:
            if self.session is None or self.session.session_id != session_id:
                return
            frames = self.session.timing.frames
            await self._close_session()
            self.pending = None
        await self.send(m.SessionStopped(session_id=session_id, timestamp_ms=now_ms(),
                                         frames_processed=frames).model_dump())
        logger.info("session %s stopped after %d frames", session_id, frames)

    async def _close_session(self) -> None:
        if self.session is not None:
            s, self.session = self.session, None
            await asyncio.to_thread(s.close)

    # ---- frames -----------------------------------------------------------
    async def handle_bytes(self, data: bytes) -> None:
        if self.session is None:
            return  # frames before session.start (or after stop) are ignored
        if len(data) > settings.max_frame_bytes:
            await self.send(_err("frame_too_large", "Frame exceeds size limit; lower the "
                                 "capture resolution.", self.session.session_id))
            return
        if len(data) <= m.FRAME_HEADER_BYTES:
            await self.send(_err("invalid_frame", "Frame too short.", self.session.session_id))
            return
        seq, capture_ms = struct.unpack_from("<Id", data, 0)
        if self.pending is not None:
            self.session.timing.dropped += 1  # replaced before it was processed
        self.pending = (seq, capture_ms, data[m.FRAME_HEADER_BYTES:])
        self.wake.set()

    async def processor(self) -> None:
        while True:
            await self.wake.wait()
            self.wake.clear()
            async with self.lock:
                item, self.pending = self.pending, None
                session = self.session
                if item is None or session is None:
                    continue
                seq, capture_ms, jpeg = item
                if not session.check_sequence(seq):
                    continue
                try:
                    msgs = await asyncio.to_thread(session.process_frame, seq, capture_ms, jpeg)
                except FrameError as exc:
                    msgs = [_err("invalid_frame", str(exc), session.session_id)]
                except Exception:
                    logger.exception("frame processing failed")
                    msgs = [_err("processing_failed",
                                 "Processing this frame failed; continuing with the next.",
                                 session.session_id)]
            for msg in msgs:
                await self.send(msg)


@router.websocket("/ws/interpret")
async def interpret(ws: WebSocket) -> None:
    # CORS does not apply to WebSockets: reject browser pages from other origins.
    # (Non-browser clients such as scripts/replay_clip.py send no Origin header.)
    origin = ws.headers.get("origin")
    if origin is not None and origin not in settings.cors_origins:
        logger.warning("rejected websocket from origin %s", origin)
        await ws.close(code=1008)
        return
    await ws.accept()
    conn = Connection(ws, ws.app.state.recognizer)
    proc = asyncio.create_task(conn.processor())
    try:
        while True:
            msg = await ws.receive()
            if msg["type"] == "websocket.disconnect":
                break
            if msg.get("bytes") is not None:
                await conn.handle_bytes(msg["bytes"])
            elif msg.get("text") is not None:
                await conn.handle_text(msg["text"])
            if proc.done():  # surface unexpected processor crashes
                proc.result()
    except WebSocketDisconnect:
        pass
    except Exception:
        logger.exception("websocket error")
    finally:
        # Close synchronously: this handler may itself be cancelled on disconnect,
        # in which case any further `await` here would be cancelled too and leak the
        # session. LandmarkExtractor.close() takes its own lock, so it is safe even if
        # a frame is mid-processing in a worker thread.
        proc.cancel()
        s, conn.session = conn.session, None
        conn.pending = None
        if s is not None:
            try:
                s.close()
            except Exception:
                logger.exception("error closing session")
        logger.info("websocket closed; session state released")
