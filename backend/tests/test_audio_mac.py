"""macOS meeting audio: BlackHole routing, WAV handling, TTS selection (no real devices)."""

from __future__ import annotations

import io
import sys
import time
import wave

import numpy as np
import pytest

from app.meeting import audio_mac, tts
from app.meeting.service import MeetingOutput
from tests.test_meeting import FakePlayer, FakeTTS


def _wav(n=2205, sr=22050, ch=1) -> bytes:
    buf = io.BytesIO()
    with wave.open(buf, "wb") as w:
        w.setnchannels(ch)
        w.setsampwidth(2)
        w.setframerate(sr)
        w.writeframes((np.sin(np.arange(n * ch) / 5) * 8000).astype(np.int16).tobytes())
    return buf.getvalue()


def test_decode_and_resample_to_device_rate():
    x, sr = audio_mac._decode(_wav())
    assert sr == 22050 and x.dtype == np.float32 and abs(x).max() <= 1
    y = audio_mac._resample(x, sr, 48000)
    assert abs(len(y) - len(x) * 48000 / 22050) <= 1


def test_decode_downmixes_stereo():
    x, _ = audio_mac._decode(_wav(ch=2))
    assert x.ndim == 1


class BlackHoleMic:
    """Shape of virtual_mic.status() on macOS with BlackHole installed."""

    def status(self):
        return {"available": True, "active": True, "managed": False,
                "target": "BlackHole 2ch", "device_name": "BlackHole 2ch", "error": None}


class MissingBlackHole:
    def status(self):
        return {"available": False, "active": False, "managed": False,
                "error": "BlackHole is not installed. Run: brew install blackhole-2ch"}


def _wait(item):
    for _ in range(200):
        if item.finished_at:
            return
        time.sleep(0.01)


def test_speech_is_routed_to_blackhole_device():
    svc = MeetingOutput(FakeTTS(), player=FakePlayer(), mic=BlackHoleMic())
    try:
        svc.update(enabled=True, local_monitor=True)
        _wait(svc.send("Thank you for listening.", "recognition"))
        assert svc.player.played == [["BlackHole 2ch", None]]
    finally:
        svc.close()


def test_missing_blackhole_reports_install_hint():
    svc = MeetingOutput(FakeTTS(), player=FakePlayer(), mic=MissingBlackHole())
    try:
        svc.update(enabled=True)
        item = svc.send("Hello.", "recognition")
        _wait(item)
        assert item.speech.startswith("failed") and "blackhole-2ch" in item.speech
        assert svc.player.played == []
    finally:
        svc.close()


def test_make_tts_falls_back_to_say_without_piper_voice(tmp_path, monkeypatch):
    monkeypatch.setattr(sys, "platform", "darwin")
    assert tts.make_tts(tmp_path / "missing.onnx", "auto").engine == "say"
    assert tts.make_tts(tmp_path / "missing.onnx", "say").engine == "say"


@pytest.mark.skipif(sys.platform != "darwin", reason="needs macOS `say`")
def test_say_produces_wav():
    data = tts.SayTTS().synthesize("Hello.")
    x, sr = audio_mac._decode(data)
    assert sr == 22050 and len(x) > 1000
