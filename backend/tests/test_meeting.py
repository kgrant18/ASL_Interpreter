"""Meeting output: virtual-mic speech + Zoom captions (all external effects faked)."""

from __future__ import annotations

import threading
import time
from urllib.parse import parse_qs, urlparse

import httpx
import pytest
from fastapi.testclient import TestClient

from app.main import create_app
from app.meeting.service import MeetingOutput
from app.meeting.zoom_cc import ZoomCaptionClient, ZoomTokenError, validate_token_url
from tests.conftest import MockRecognizer

TOKEN = "https://wmcc.zoom.us/closedcaption?id=123456&ns=abc&expire=86400&sparams=id%2Cns%2Cexpire&signature=xyz"
UI = {"Origin": "http://localhost:5173"}


class FakeTTS:
    available = True

    def __init__(self):
        from pathlib import Path
        self.voice_path = Path("fake-voice.onnx")
        self.spoken: list[str] = []

    def synthesize(self, text: str) -> bytes:
        self.spoken.append(text)
        return b"RIFF-fake"


class FakePlayer:
    def __init__(self, block: threading.Event | None = None):
        self.played: list[list] = []
        self.stopped = 0
        self.block = block
        self.started = threading.Event()

    @staticmethod
    def available() -> bool:
        return True

    def play(self, wav, targets):
        self.played.append(targets)
        self.started.set()
        if self.block:
            self.block.wait(2)

    def stop(self):
        self.stopped += 1
        if self.block:
            self.block.set()


class FakeMic:
    def __init__(self, active=True):
        self.active = active

    def status(self):
        return {"available": True, "active": self.active, "device_name": "SignBridge Virtual Microphone", "error": None}

    def create(self):
        self.active = True
        return self.status()

    def remove(self):
        self.active = False
        return self.status()


class ZoomRecorder:
    def __init__(self, fail_first: int = 0):
        self.requests: list[httpx.Request] = []
        self.fail_first = fail_first

    def __call__(self, request: httpx.Request) -> httpx.Response:
        if request.method == "GET":          # last-seq probe: not supported by this fake
            return httpx.Response(404)
        self.requests.append(request)
        if self.fail_first > 0:
            self.fail_first -= 1
            return httpx.Response(500, text="boom")
        return httpx.Response(200, text="2026-11-14T12:00:00")


def wait_done(svc: MeetingOutput, n: int = 1, timeout: float = 10.0):
    t0 = time.time()
    while time.time() - t0 < timeout:
        items = list(svc.log)[:n]
        if len(items) >= n and all(i.finished_at for i in items):
            return items
        time.sleep(0.01)
    raise AssertionError("delivery did not finish")


@pytest.fixture
def zoom():
    return ZoomRecorder()


@pytest.fixture
def svc(zoom):
    s = MeetingOutput(FakeTTS(), FakePlayer(), FakeMic(),
                      zoom_factory=lambda url: ZoomCaptionClient(url, transport=httpx.MockTransport(zoom)))
    yield s
    s.close()


# ---- Zoom client ----
def test_token_validation():
    assert validate_token_url(" " + TOKEN + " ") == TOKEN
    for bad in ["http://wmcc.zoom.us/closedcaption?id=1", "https://evil.example/closedcaption?id=1",
                "https://zoom.us.evil.example/closedcaption?id=1", "https://wmcc.zoom.us/other?id=1",
                "https://wmcc.zoom.us/closedcaption?ns=1"]:
        with pytest.raises(ZoomTokenError):
            validate_token_url(bad)


def test_zoom_post_format_and_seq(zoom):
    c = ZoomCaptionClient(TOKEN, transport=httpx.MockTransport(zoom))
    c.post("Hello.")
    c.post("Thank you.")
    assert [parse_qs(urlparse(str(r.url)).query)["seq"] for r in zoom.requests] == [["1"], ["2"]]
    r = zoom.requests[0]
    q = parse_qs(urlparse(str(r.url)).query)
    assert r.method == "POST" and q["lang"] == ["en-US"] and q["id"] == ["123456"]
    assert r.headers["content-type"].startswith("text/plain") and r.content == b"Hello."
    assert "signature" not in c.redacted()


def test_zoom_retry_keeps_seq():
    z = ZoomRecorder(fail_first=1)
    c = ZoomCaptionClient(TOKEN, transport=httpx.MockTransport(z))
    c.post("Hi.")
    seqs = [parse_qs(urlparse(str(r.url)).query)["seq"][0] for r in z.requests]
    assert seqs == ["1", "1"] and c.seq == 1


def test_zoom_failure_does_not_advance_seq():
    z = ZoomRecorder(fail_first=5)
    c = ZoomCaptionClient(TOKEN, transport=httpx.MockTransport(z))
    with pytest.raises(RuntimeError):
        c.post("Hi.")
    assert c.seq == 0


# ---- service ----
def test_off_by_default_refuses_send(svc):
    assert svc.config.enabled is False
    with pytest.raises(PermissionError):
        svc.send("Hello.", "recognition")


def test_speech_and_captions_delivered(svc, zoom):
    svc.set_zoom_token(TOKEN)
    svc.update(enabled=True, captions=True)
    svc.send("Hello.", "recognition")
    (item,) = wait_done(svc)
    assert item.speech == "sent" and item.caption == "sent"
    assert svc.tts.spoken == ["Hello."]
    assert svc.player.played == [["signbridge_speech"]]
    assert zoom.requests[0].content == b"Hello."  # the signer's own words, no prefix by default


def test_local_monitor_and_optional_prefix(svc, zoom):
    svc.set_zoom_token(TOKEN)
    svc.update(enabled=True, captions=True, caption_prefix=True, local_monitor=True)
    svc.send("Hi.", "typed")
    wait_done(svc)
    assert svc.player.played == [["signbridge_speech", None]]
    assert svc.tts.spoken == ["Hi."]  # speech never carries the prefix
    assert zoom.requests[0].content == b"[SignBridge] Hi."


def test_missing_virtual_mic_reports_failure(svc):
    svc.mic.active = False
    svc.update(enabled=True)
    svc.send("Hello.", "recognition")
    (item,) = wait_done(svc)
    assert item.speech.startswith("failed") and "virtual microphone" in item.speech
    assert item.caption == "skipped"


def test_mute_drops_queue_and_stops_playback(zoom):
    gate = threading.Event()
    svc = MeetingOutput(FakeTTS(), FakePlayer(block=gate), FakeMic())
    try:
        svc.update(enabled=True)
        svc.send("one", "typed")
        assert svc.player.started.wait(5)  # worker is now blocked playing "one"
        svc.send("two", "typed")
        svc.mute()
        items = wait_done(svc, 2)
        by_text = {i.text: i for i in items}
        assert by_text["two"].speech == "skipped"
        assert by_text["one"].speech == "skipped"   # interrupted -> not reported as sent
        assert svc.player.stopped >= 1 and svc.tts.spoken == ["one"]
    finally:
        svc.close()


def test_whitespace_and_length_normalized(svc):
    svc.update(enabled=True)
    item = svc.send("  hello \n  there ", "typed")
    assert item.text == "hello there"
    with pytest.raises(ValueError):
        svc.send("   ", "typed")


# ---- REST API ----
@pytest.fixture
def client(svc):
    with TestClient(create_app(MockRecognizer(), meeting_output=svc)) as c:
        yield c


def test_api_status_and_flow(client, svc, zoom):
    s = client.get("/api/meeting/status").json()
    assert s["config"]["enabled"] is False and s["zoom"]["connected"] is False
    assert client.post("/api/meeting/send", json={"text": "Hi.", "source": "typed"}, headers=UI).status_code == 409
    assert client.post("/api/meeting/config", json={"captions": True}, headers=UI).status_code == 400
    assert client.post("/api/meeting/zoom-token", json={"token_url": "https://x.example/closedcaption?id=1"}, headers=UI).status_code == 400
    s = client.post("/api/meeting/zoom-token", json={"token_url": TOKEN}, headers=UI).json()
    assert s["zoom"]["connected"] and "signature" not in s["zoom"]["endpoint"]
    s = client.post("/api/meeting/config", json={"enabled": True, "captions": True}, headers=UI).json()
    assert s["config"]["enabled"] and s["config"]["captions"]
    r = client.post("/api/meeting/send", json={"text": "Hello.", "source": "recognition"}, headers=UI)
    assert r.status_code == 200
    wait_done(svc)
    assert zoom.requests[-1].content == b"Hello."
    assert client.post("/api/meeting/mute", json={}, headers=UI).json()["config"]["enabled"] is False


def test_api_refuses_simulated(client):
    client.post("/api/meeting/config", json={"enabled": True}, headers=UI)
    r = client.post("/api/meeting/send", json={"text": "Hello.", "source": "recognition", "simulated": True}, headers=UI)
    assert r.status_code == 400


def test_api_rejects_foreign_origin(client):
    r = client.post("/api/meeting/config", json={"enabled": True}, headers={"Origin": "https://evil.example"})
    assert r.status_code == 403
    assert client.get("/api/meeting/status").json()["config"]["enabled"] is False


def test_api_virtual_mic(client, svc):
    svc.mic.active = False
    s = client.post("/api/meeting/virtual-mic", json={"action": "create"}, headers=UI).json()
    assert s["virtual_mic"]["active"] is True
