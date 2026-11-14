"""Offline text-to-speech with Piper (voice: en_US-ljspeech-medium, public-domain data)."""

from __future__ import annotations

import io
import logging
import threading
import wave
from pathlib import Path

logger = logging.getLogger(__name__)


class PiperTTS:
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
