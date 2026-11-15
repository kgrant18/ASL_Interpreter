"""Offline text-to-speech: Piper (voice en_US-ljspeech-medium, public-domain data), or
the built-in macOS `say` voice as a fallback / alternative (SIGNBRIDGE_TTS=say)."""

from __future__ import annotations

import io
import logging
import os
import shutil
import subprocess
import sys
import tempfile
import threading
import wave
from pathlib import Path

logger = logging.getLogger(__name__)


class PiperTTS:
    engine = "piper"

    def __init__(self, voice_path: Path):
        self.voice_path = Path(voice_path)
        self._voice = None
        self._lock = threading.Lock()
        self.error: str | None = None

    @property
    def available(self) -> bool:
        return self.voice_path.exists()

    def _load(self):
        if self._voice is None:
            from piper import PiperVoice  # imported lazily: onnxruntime startup cost

            self._voice = PiperVoice.load(str(self.voice_path))
        return self._voice

    def warm(self) -> None:
        if self.available:
            try:
                with self._lock:
                    self._load()
            except Exception as exc:  # reported via status
                self.error = str(exc)
                logger.error("Piper voice failed to load: %s", exc)

    def synthesize(self, text: str) -> bytes:
        """Return a mono 16-bit WAV."""
        with self._lock:
            voice = self._load()
            buf = io.BytesIO()
            with wave.open(buf, "wb") as w:
                voice.synthesize_wav(text, w)
            return buf.getvalue()


class SayTTS:
    """macOS system voice via `say` (offline). SIGNBRIDGE_SAY_VOICE picks a voice."""

    engine = "say"

    def __init__(self, voice: str | None = None):
        self.voice = voice or os.environ.get("SIGNBRIDGE_SAY_VOICE") or None
        self.voice_path = Path(self.voice or "system-voice")
        self.error: str | None = None

    @property
    def available(self) -> bool:
        return shutil.which("say") is not None

    def synthesize(self, text: str) -> bytes:
        fd, path = tempfile.mkstemp(prefix="signbridge-say-", suffix=".wav")
        os.close(fd)
        try:
            cmd = ["say", "-o", path, "--data-format=LEI16@22050"]
            if self.voice:
                cmd += ["-v", self.voice]
            subprocess.run(cmd + ["--", text], check=True, capture_output=True, timeout=30)
            return Path(path).read_bytes()
        finally:
            os.unlink(path)


def make_tts(voice_path: Path, engine: str = "auto"):
    """auto: Piper when its voice loads, otherwise `say` on macOS."""
    if engine == "say" or (engine == "auto" and sys.platform == "darwin"
                           and not Path(voice_path).exists()):
        return SayTTS()
    tts = PiperTTS(voice_path)
    if engine == "auto" and sys.platform == "darwin":
        tts.warm()
        if tts.error and shutil.which("say"):
            logger.warning("Piper unavailable (%s); using macOS say", tts.error)
            return SayTTS()
    return tts
