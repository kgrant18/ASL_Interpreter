"""Background capture (backend reads the camera) + Zoom caption error reporting.

The camera, MediaPipe and the model are faked; everything between them (session,
stabilizer, phrase matcher, meeting output, REST API) is the real code.
"""

from __future__ import annotations

import threading
import time
from pathlib import Path

import httpx
import numpy as np
import pytest
from fastapi.testclient import TestClient

from app.capture.background import CAMERA_HELP, BackgroundRecognizer
from app.config import BACKEND_DIR, Settings
from app.main import create_app
from app.meeting.service import MeetingOutput
from app.meeting.zoom_cc import CaptionError, ZoomCaptionClient
from tests.conftest import MockRecognizer, synthetic_frame
from tests.test_meeting import TOKEN, UI, FakeMic, FakePlayer, FakeTTS, wait_done

PHRASES = BACKEND_DIR / "app" / "recognition" / "phrases.json"
FRAME = np.zeros((480, 640, 3), np.uint8)


def sentence_script(labels: list[str], rest: int = 25, hold: int = 15, gap: int = 15):
    """Per-frame (label, hands) script: rest, then each sign held and released."""
    script = [(None, False)] * rest
    for lab in labels:
        script += [(lab, True)] * hold + [(None, False)] * gap
    return script + [(None, False)] * 60   # long rest so partial matches would settle


class Clock:
    def __init__(self):
        self.t = 1_000.0

    def __call__(self) -> float:
        return self.t


class ScriptedCamera:
    """Plays a script: sets the fake model's answer and advances the clock per frame."""

    def __init__(self, script, rec: MockRecognizer, clock: Clock, hands_state: dict):
        self.script, self.rec, self.clock, self.hands = list(script), rec, clock, hands_state
        self.i = 0
        self.released = False

    def read(self):
        time.sleep(0.002)
        if self.i >= len(self.script):
            return False, None
        label, hands = self.script[self.i]
        self.i += 1
        self.rec.next_label, self.rec.next_score = label, 0.95
        self.hands["on"] = hands
        self.clock.t += 1 / 15
        return True, FRAME

    def release(self):
        self.released = True


class ToggleExtractor:
    def __init__(self, hands_state: dict):
        self.hands = hands_state

    def process(self, rgb, ts):
        return synthetic_frame(ts, hands=self.hands["on"], w=rgb.shape[1], h=rgb.shape[0])

    def close(self):
        pass


def make_bg(script, on_phrase=None, camera_factory=None):
    rec = MockRecognizer(labels=("ME", "HAVE", "IDEA", "THANKYOU", "HELLO"))
    clock, hands = Clock(), {"on": False}
    cams: list[ScriptedCamera] = []

    def factory():
        cam = ScriptedCamera(script, rec, clock, hands)
        cams.append(cam)
        return cam

    bg = BackgroundRecognizer(Settings(phrases_path=PHRASES), rec, on_phrase=on_phrase,
                              camera_factory=camera_factory or factory,
                              extractor_factory=lambda: ToggleExtractor(hands),
                              fps=500, clock=clock)
    return bg, cams


def wait_for(cond, timeout=10.0):
    t0 = time.time()
    while time.time() - t0 < timeout:
        if cond():
            return True
        time.sleep(0.01)
    return False


# ---- background capture ----

def test_background_recognizes_a_sentence_and_hands_it_to_output():
    phrases: list[tuple[str, list[str]]] = []
    bg, cams = make_bg(sentence_script(["ME", "HAVE", "IDEA"]),
                       on_phrase=lambda e, g: phrases.append((e, g)) or True)
    bg.start()
    try:
        assert wait_for(lambda: len(cams) >= 1 and cams[0].i >= len(cams[0].script))
        assert wait_for(lambda: bg.status()["history"])
        st = bg.status()
        assert phrases == [("I have an idea.", ["ME", "HAVE", "IDEA"])]
        assert st["history"][0]["english"] == "I have an idea." and st["history"][0]["sent"]
        assert st["running"] and st["recognition"]["last_sign"] == "IDEA"
    finally:
        bg.stop()
    assert cams[0].released and not bg.running
    assert bg.status()["camera"]["state"] == "off"


def test_background_never_outputs_partial_or_unmatched_signs():
    phrases = []
    bg, cams = make_bg(sentence_script(["HELLO"]), on_phrase=lambda e, g: phrases.append(e))
    bg.start()
    try:
        assert wait_for(lambda: cams and cams[0].i >= len(cams[0].script))
        time.sleep(0.2)
        assert phrases == [] and bg.status()["history"] == []
        assert bg.status()["recognition"]["last_sign"] == "HELLO"
    finally:
        bg.stop()


def test_camera_open_failure_is_reported_and_retried():
    calls = []

    def broken():
        calls.append(1)
        raise RuntimeError(CAMERA_HELP)

    bg, _ = make_bg([], camera_factory=broken)
    bg.start()
    try:
        assert wait_for(lambda: bg.status()["camera"]["state"] == "error")
        st = bg.status()
        assert "Privacy & Security" in st["camera"]["error"] and st["running"]
    finally:
        bg.stop()
    assert len(calls) >= 1


def test_camera_that_stops_sending_frames_is_reopened():
    bg, cams = make_bg([(None, False)] * 5)
    bg.start()
    try:
        assert wait_for(lambda: len(cams) >= 2, timeout=8)
        assert cams[0].released
    finally:
        bg.stop()


def test_background_requires_a_loaded_model():
    class NotLoaded(MockRecognizer):
        @property
        def loaded(self):
            return False

    bg = BackgroundRecognizer(Settings(), NotLoaded())
    with pytest.raises(RuntimeError):
        bg.start()


# ---- API: Connect to Zoom screen ----

class Zoom:
    def __init__(self, status=200, exc: Exception | None = None, last_seq: str | None = None):
        self.status, self.exc, self.last_seq = status, exc, last_seq
        self.posts: list[httpx.Request] = []

    def __call__(self, request):
        if request.method == "GET":
            return httpx.Response(200, text=self.last_seq) if self.last_seq else httpx.Response(404)
        self.posts.append(request)
        if self.exc:
            raise self.exc
        return httpx.Response(self.status, text="2026-11-14T12:00:00")


@pytest.fixture
def api():
    zoom = Zoom()
    svc = MeetingOutput(FakeTTS(), FakePlayer(), FakeMic(),
                        zoom_factory=lambda url: ZoomCaptionClient(url, transport=httpx.MockTransport(zoom)))
    rec = MockRecognizer()
    app = create_app(recognizer=rec, meeting_output=svc)
    from app.api.background import make_on_phrase
    bg, cams = make_bg(sentence_script(["ME", "HAVE", "IDEA"], rest=150), on_phrase=make_on_phrase(app))
    app.state.background = bg
    with TestClient(app) as c:
        yield c, svc, bg, cams, zoom
    bg.stop()
    svc.close()


def test_start_runs_capture_and_turns_on_voice_and_captions(api):
    c, svc, bg, cams, zoom = api
    assert c.post("/api/meeting/zoom-token", json={"token_url": TOKEN}, headers=UI).status_code == 200
    st = c.post("/api/background/start", headers=UI).json()
    assert st["capture"]["running"]
    assert st["meeting"]["config"]["enabled"] and st["meeting"]["config"]["captions"]
    assert wait_for(lambda: bg.status()["history"])
    (item,) = wait_done(svc)
    assert item.text == "I have an idea." and item.speech == "sent" and item.caption == "sent"
    assert zoom.posts[0].content == b"[SignBridge] I have an idea."
    st = c.post("/api/background/stop", headers=UI).json()
    assert not st["capture"]["running"] and not st["meeting"]["config"]["enabled"]


def test_muted_output_keeps_recognizing_but_sends_nothing(api):
    c, svc, bg, cams, zoom = api
    c.post("/api/background/start", headers=UI)
    c.post("/api/meeting/mute", headers=UI)          # Ctrl+Shift+M / menu bar "Stop sending"
    assert wait_for(lambda: bg.status()["history"])
    assert bg.status()["history"][0]["sent"] is False
    assert list(svc.log) == [] and zoom.posts == []


def test_start_rejects_other_origins(api):
    c, *_ = api
    r = c.post("/api/background/start", headers={"Origin": "https://evil.example"})
    assert r.status_code == 403


# ---- caption errors ----

@pytest.mark.parametrize("code,needle", [(403, "expired"), (401, "expired"), (404, "does not recognise"),
                                         (400, "breakout"), (500, "Zoom's caption service")])
def test_caption_http_errors_are_explained(code, needle):
    z = Zoom(status=code)
    c = ZoomCaptionClient(TOKEN, transport=httpx.MockTransport(z))
    with pytest.raises(CaptionError) as e:
        c.post("Hi.")
    assert needle in str(e.value) and c.last_error == str(e.value) and c.seq == 0
    if code in (400, 401, 403, 404):
        assert "Copy the API token" in str(e.value)
        assert len(z.posts) == 1            # pointless to retry a rejected token
    else:
        assert len(z.posts) == 2


def test_caption_network_error_is_explained():
    c = ZoomCaptionClient(TOKEN, transport=httpx.MockTransport(Zoom(exc=httpx.ConnectError("down"))))
    with pytest.raises(CaptionError, match="internet connection"):
        c.post("Hi.")


def test_caption_success_clears_previous_error():
    z = Zoom(status=403)
    c = ZoomCaptionClient(TOKEN, transport=httpx.MockTransport(z))
    with pytest.raises(CaptionError):
        c.post("Hi.")
    z.status = 200
    c.post("Hi.")
    assert c.last_error is None and c.delivered == 1 and c.last_ok_at is not None


def test_caption_seq_continues_after_zoom_last_seq():
    z = Zoom(last_seq="41")
    c = ZoomCaptionClient(TOKEN, transport=httpx.MockTransport(z))
    c.post("Hi.")
    assert "seq=42" in str(z.posts[0].url)


def test_failed_caption_shows_in_status_and_voice_still_goes_out(api):
    c, svc, bg, cams, zoom = api
    zoom.status = 403
    c.post("/api/meeting/zoom-token", json={"token_url": TOKEN}, headers=UI)
    c.post("/api/background/start", headers=UI)
    (item,) = wait_done(svc)
    assert item.speech == "sent" and item.caption.startswith("failed:")
    st = c.get("/api/background/status").json()
    assert "expired" in st["meeting"]["zoom"]["last_error"]


def test_test_caption_endpoint(api):
    c, svc, bg, cams, zoom = api
    assert c.post("/api/background/test-caption", headers=UI).status_code == 400   # no token yet
    c.post("/api/meeting/zoom-token", json={"token_url": TOKEN}, headers=UI)
    r = c.post("/api/background/test-caption", headers=UI)
    assert r.status_code == 200 and r.json()["meeting"]["zoom"]["delivered"] == 1
    zoom.status = 403
    r = c.post("/api/background/test-caption", headers=UI)
    assert r.status_code == 502 and "Copy the API token" in r.json()["detail"]


# ---- menu-bar indicator text ----

def test_statusbar_summary_states():
    from app.statusbar import summarize

    assert summarize(None)[0] == "○ SignBridge"
    st = {"capture": {"running": True, "camera": {"state": "on", "fps": 14.8, "error": None},
                      "recognition": {"state": "no_hands", "shoulders_visible": True, "pending": []},
                      "history": [{"english": "I have an idea."}]},
          "meeting": {"config": {"enabled": True, "captions": True},
                      "virtual_mic": {"active": True, "device_name": "BlackHole 2ch"},
                      "zoom": {"connected": True, "delivered": 2, "last_ok_at": 5}}}
    title, lines = summarize(st)
    assert title == "● SignBridge"
    assert lines == ["Camera: on (15 fps)", "Recognition: ready", "Voice: speaking into BlackHole 2ch",
                     "Captions: sending (2 delivered)", "Last: “I have an idea.”"]
    st["meeting"]["config"]["enabled"] = False
    assert summarize(st)[0] == "⏸ SignBridge"
    st["meeting"]["zoom"].update(last_error="Zoom rejected the caption token (HTTP 403)", last_error_at=9)
    title, lines = summarize(st)
    assert title == "⚠ SignBridge" and lines[3].startswith("Captions: FAILING")
    st["capture"]["camera"] = {"state": "error", "fps": 0, "error": "Could not open the camera."}
    assert "Could not open" in summarize(st)[1][0]


def test_preview_only_while_running():
    bg, cams = make_bg([(None, True)] * 400)
    assert bg.preview_jpeg() is None
    bg.start()
    try:
        assert wait_for(lambda: bg.preview_jpeg() is not None)
        assert bg.preview_jpeg()[:2] == b"\xff\xd8"
    finally:
        bg.stop()
    assert bg.preview_jpeg() is None


def test_preview_refused_to_other_websites(api):
    c, *_ = api
    assert c.get("/api/background/preview.jpg", headers={"Sec-Fetch-Site": "cross-site"}).status_code == 403
    assert c.get("/api/background/preview.jpg").status_code == 404   # camera off
