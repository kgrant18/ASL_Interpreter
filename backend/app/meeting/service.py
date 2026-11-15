"""MeetingOutput: queue of captions sent to the call (virtual mic speech + Zoom captions).

Safety model:
  * Everything is off until the user turns on the master switch in the UI.
  * Turning the master switch off (or the mute shortcut) drops queued items and stops
    the utterance that is currently playing.
  * Simulated-demo captions are refused: only live recognition or text the user typed.
"""

from __future__ import annotations

import logging
import os
import queue
import shutil
import subprocess
import sys
import tempfile
import threading
import time
import uuid
from collections import deque
from dataclasses import asdict, dataclass, field
from typing import Callable

from . import virtual_mic
from .tts import PiperTTS
from .zoom_cc import ZoomCaptionClient

logger = logging.getLogger(__name__)

MAX_QUEUE = 8
MAX_TEXT = 300


@dataclass
class MeetingConfig:
    enabled: bool = False          # master switch
    speech: bool = True            # speak into the virtual microphone
    captions: bool = False         # post to Zoom (needs a token)
    caption_prefix: bool = True    # prefix captions with "[SignBridge]"
    local_monitor: bool = False    # also play speech on this computer's speakers


@dataclass
class SentItem:
    id: str
    text: str
    source: str
    queued_at: float
    speech: str = "pending"        # pending | sent | skipped | failed: …
    caption: str = "pending"
    finished_at: float | None = None


@dataclass
class _Job:
    item: SentItem
    generation: int


class AudioPlayer:
    """Plays a WAV file into a PipeWire target with pw-play (falls back to paplay)."""

    def __init__(self):
        self._procs: list[subprocess.Popen] = []
        self._lock = threading.Lock()

    @staticmethod
    def available() -> bool:
        return bool(shutil.which("pw-play") or shutil.which("paplay"))

    def play(self, wav: bytes, targets: list[str | None]) -> None:
        fd, path = tempfile.mkstemp(prefix="signbridge-", suffix=".wav")
        try:
            with os.fdopen(fd, "wb") as f:
                f.write(wav)
            procs = []
            for t in targets:
                if shutil.which("pw-play"):
                    cmd = ["pw-play"] + (["--target", t] if t else []) + [path]
                else:
                    cmd = ["paplay"] + ([f"--device={t}"] if t else []) + [path]
                procs.append(subprocess.Popen(cmd, stdout=subprocess.DEVNULL,
                                              stderr=subprocess.PIPE))
            with self._lock:
                self._procs = procs
            errors = []
            for p in procs:
                _, err = p.communicate(timeout=60)
                if p.returncode not in (0, -15):  # -15: stopped by mute
                    errors.append(err.decode(errors="replace").strip()[:200])
            if errors:
                raise RuntimeError("; ".join(errors))
        finally:
            with self._lock:
                self._procs = []
            os.unlink(path)

    def stop(self) -> None:
        with self._lock:
            for p in self._procs:
                if p.poll() is None:
                    p.terminate()


def default_player():
    if sys.platform == "darwin":
        from .audio_mac import MacAudioPlayer
        return MacAudioPlayer()
    return AudioPlayer()


class MeetingOutput:
    def __init__(self, tts: PiperTTS, player: AudioPlayer | None = None,
                 mic: object = virtual_mic,
                 zoom_factory: Callable[[str], ZoomCaptionClient] = ZoomCaptionClient):
        self.tts = tts
        self.player = player or default_player()
        self.mic = mic
        self.zoom_factory = zoom_factory
        self.config = MeetingConfig()
        self.zoom: ZoomCaptionClient | None = None
        self.log: deque[SentItem] = deque(maxlen=30)
        self._q: queue.Queue[_Job] = queue.Queue(MAX_QUEUE)
        self._gen = 0
        self._lock = threading.Lock()
        self._stop = threading.Event()
        self._worker = threading.Thread(target=self._run, name="meeting-output", daemon=True)
        self._worker.start()

    # ---- configuration ----
    def update(self, **changes) -> MeetingConfig:
        with self._lock:
            was_enabled = self.config.enabled
            for k, v in changes.items():
                if v is not None and hasattr(self.config, k):
                    setattr(self.config, k, v)
            if was_enabled and not self.config.enabled:
                self._flush_locked()
        return self.config

    def set_zoom_token(self, token_url: str | None) -> None:
        with self._lock:
            if self.zoom:
                self.zoom.close()
            self.zoom = self.zoom_factory(token_url) if token_url else None
            if self.zoom is None:
                self.config.captions = False

    def test_caption(self, text: str = "SignBridge captions are connected.") -> None:
        """Post one caption right now (outside the queue) so the host can check the token."""
        with self._lock:
            zoom = self.zoom
        if zoom is None:
            raise LookupError("paste a Zoom caption API token first")
        zoom.post(text)

    def mute(self) -> None:
        """Master off + drop queue + stop current speech."""
        self.update(enabled=False)

    def _flush_locked(self) -> None:
        self._gen += 1
        while True:
            try:
                job = self._q.get_nowait()
            except queue.Empty:
                break
            job.item.speech = job.item.caption = "skipped"
            job.item.finished_at = time.time()
        self.player.stop()

    # ---- sending ----
    def send(self, text: str, source: str) -> SentItem:
        text = " ".join(text.split())[:MAX_TEXT]
        if not text:
            raise ValueError("empty text")
        with self._lock:
            if not self.config.enabled:
                raise PermissionError("meeting output is off")
            item = SentItem(id=uuid.uuid4().hex[:12], text=text, source=source,
                            queued_at=time.time())
            if not self.config.speech:
                item.speech = "skipped"
            if not (self.config.captions and self.zoom):
                item.caption = "skipped"
            try:
                self._q.put_nowait(_Job(item, self._gen))
            except queue.Full:
                raise OverflowError("too many captions queued; slow down or mute")
            self.log.appendleft(item)
            return item

    def _run(self) -> None:
        warm = getattr(self.tts, "warm", None)
        if warm:
            warm()
        while not self._stop.is_set():
            try:
                job = self._q.get(timeout=0.5)
            except queue.Empty:
                continue
            try:
                self._deliver(job)
            except Exception:
                logger.exception("meeting delivery crashed")
            job.item.finished_at = time.time()

    def _current(self, job: _Job) -> bool:
        return job.generation == self._gen and self.config.enabled

    def _deliver(self, job: _Job) -> None:
        item = job.item
        # Captions first: posting is fast and independent of audio playback.
        if item.caption == "pending":
            if not self._current(job):
                item.caption = "skipped"
            else:
                prefix = "[SignBridge] " if self.config.caption_prefix else ""
                try:
                    self.zoom.post(prefix + item.text)
                    item.caption = "sent"
                except Exception as exc:
                    item.caption = f"failed: {exc}"
        if item.speech == "pending":
            if not self._current(job):
                item.speech = "skipped"
                return
            try:
                mic = self.mic.status()
                if not mic.get("active"):
                    raise RuntimeError(mic.get("error") or "virtual microphone is not set up")
                wav = self.tts.synthesize(item.text)
                if not self._current(job):
                    item.speech = "skipped"
                    return
                targets: list[str | None] = [mic.get("target", virtual_mic.SINK)]
                if self.config.local_monitor:
                    targets.append(None)
                self.player.play(wav, targets)
                item.speech = "sent" if self._current(job) else "skipped"
            except Exception as exc:
                item.speech = f"failed: {exc}"

    # ---- reporting ----
    def status(self) -> dict:
        return {
            "config": asdict(self.config),
            "virtual_mic": self.mic.status(),
            "tts": {"engine": getattr(self.tts, "engine", "piper"),
                    "voice": self.tts.voice_path.stem,
                    "available": self.tts.available,
                    "error": getattr(self.tts, "error", None)},
            "player_available": self.player.available(),
            "zoom": {"connected": self.zoom is not None,
                     "endpoint": self.zoom.redacted() if self.zoom else None,
                     "seq": self.zoom.seq if self.zoom else None,
                     "delivered": getattr(self.zoom, "delivered", 0) if self.zoom else 0,
                     "last_ok_at": getattr(self.zoom, "last_ok_at", None) if self.zoom else None,
                     "last_error": getattr(self.zoom, "last_error", None) if self.zoom else None,
                     "last_error_at": (getattr(self.zoom, "last_error_at", None)
                                       if self.zoom else None)},
            "queued": self._q.qsize(),
            "recent": [asdict(i) for i in list(self.log)[:10]],
        }

    def close(self) -> None:
        self._stop.set()
        self.player.stop()
        self._worker.join(timeout=10)
        if self.zoom:
            self.zoom.close()
