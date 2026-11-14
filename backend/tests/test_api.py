"""HTTP + WebSocket tests with a mocked recognizer and fake landmark extractor."""

import json
import struct

import pytest
from fastapi.testclient import TestClient

from app.main import create_app
from app.schemas.messages import SessionStart
from app.services import interpretation
from app.services.interpretation import LiveInterpretationSession, SimulatedInterpretationSession
from app.config import Settings
from tests.conftest import FakeExtractor, MockRecognizer, jpeg_bytes, synthetic_frame

CREATED: list[FakeExtractor] = []


@pytest.fixture(autouse=True)
def fake_extractor(monkeypatch):
    CREATED.clear()

    def factory():
        e = FakeExtractor()
        CREATED.append(e)
        return e

    monkeypatch.setattr(interpretation, "LandmarkExtractor", factory)


@pytest.fixture
def rec():
    return MockRecognizer()


@pytest.fixture
def client(rec):
    with TestClient(create_app(rec)) as c:
        yield c


def frame(seq, ms, data=None):
    return struct.pack("<Id", seq, ms) + (data if data is not None else jpeg_bytes())


def wait_all_closed(timeout=3.0):
    """Server-side cleanup runs after the client closes; wait for it."""
    import time
    deadline = time.time() + timeout
    while not (CREATED and all(e.closed for e in CREATED)) and time.time() < deadline:
        time.sleep(0.02)
    return bool(CREATED) and all(e.closed for e in CREATED)


def start(ws, sid="session-aaaa", **kw):
    ws.send_text(json.dumps({"type": "session.start", "session_id": sid, **kw}))
    return json.loads(ws.receive_text())


# ---------------- HTTP ----------------
def test_health(client):
    r = client.get("/health")
    assert r.status_code == 200 and r.json()["status"] == "ok"


def test_model_metadata(client):
    j = client.get("/api/model").json()
    assert j["loaded"] is True and j["name"] == "mock"


def test_vocabulary(client):
    j = client.get("/api/vocabulary").json()
    assert [v["label"] for v in j["supported"]] == ["HELLO", "YES"]


def test_cors_restricted(client):
    r = client.get("/health", headers={"Origin": "http://evil.example"})
    assert "access-control-allow-origin" not in r.headers
    r = client.get("/health", headers={"Origin": "http://localhost:5173"})
    assert r.headers.get("access-control-allow-origin") == "http://localhost:5173"


# ---------------- WebSocket ----------------
def test_session_start_and_frame_ack(client):
    with client.websocket_connect("/ws/interpret") as ws:
        msg = start(ws)
        assert msg["type"] == "session.started" and msg["mode"] == "live"
        ws.send_bytes(frame(1, 1000))
        status = json.loads(ws.receive_text())
        assert status["type"] == "processing.status"
        assert status["sequence"] == 1 and status["session_id"] == "session-aaaa"
        assert status["landmarks"]["left_hand"] is not None


def test_stable_recognition_flow(client, rec):
    rec.next_label, rec.next_score = "HELLO", 0.95
    results = []
    with client.websocket_connect("/ws/interpret") as ws:
        start(ws)
        # Messages for frame i arrive after status(i) and before status(i+1), so wait
        # for each frame's ack before sending the next (as the browser does).
        for i in range(40):
            ws.send_bytes(frame(i + 1, 1000 + i * 66))
            while True:
                m = json.loads(ws.receive_text())
                if m["type"] == "recognition.result":
                    results.append(m)
                if m["type"] == "processing.status" and m["sequence"] == i + 1:
                    break
        ws.send_text(json.dumps({"type": "session.stop", "session_id": "session-aaaa"}))
        while (m := json.loads(ws.receive_text()))["type"] != "session.stopped":
            if m["type"] == "recognition.result":
                results.append(m)
    assert len(results) == 1  # duplicate suppression across many windows
    assert results[0]["prediction"]["label"] == "HELLO"
    assert results[0]["prediction"]["is_stable"] is True
    assert results[0].get("simulated") is False


def test_invalid_config_rejected(client):
    with client.websocket_connect("/ws/interpret") as ws:
        msg = start(ws, target_fps=999)
        assert msg["type"] == "error" and msg["code"] == "invalid_config"


def test_malformed_messages(client):
    with client.websocket_connect("/ws/interpret") as ws:
        ws.send_text("not json")
        assert json.loads(ws.receive_text())["code"] == "invalid_message"
        ws.send_text(json.dumps({"type": "bogus"}))
        assert json.loads(ws.receive_text())["code"] == "unknown_message"
        start(ws)
        ws.send_bytes(frame(1, 10, b"not a jpeg"))
        err = json.loads(ws.receive_text())
        assert err["code"] == "invalid_frame"
        assert "Traceback" not in err["message"]
        ws.send_bytes(b"\x00\x01")
        assert json.loads(ws.receive_text())["code"] == "invalid_frame"


def test_oversized_frame(client):
    with client.websocket_connect("/ws/interpret") as ws:
        start(ws)
        ws.send_bytes(frame(1, 10, b"\xff\xd8" + b"0" * 1_100_000))
        assert json.loads(ws.receive_text())["code"] == "frame_too_large"


def test_frames_before_start_ignored_and_stop(client):
    with client.websocket_connect("/ws/interpret") as ws:
        ws.send_bytes(frame(1, 10))
        msg = start(ws)
        assert msg["type"] == "session.started"
        ws.send_text(json.dumps({"type": "session.stop", "session_id": "session-aaaa"}))
        stopped = json.loads(ws.receive_text())
        assert stopped["type"] == "session.stopped"
    assert wait_all_closed()


def test_new_session_replaces_old(client):
    with client.websocket_connect("/ws/interpret") as ws:
        start(ws, sid="session-one1")
        msg = start(ws, sid="session-two2")
        assert msg["session_id"] == "session-two2"
        ws.send_bytes(frame(1, 10))
        assert json.loads(ws.receive_text())["session_id"] == "session-two2"
    assert len(CREATED) == 2 and wait_all_closed()


def test_disconnect_releases_session(client):
    with client.websocket_connect("/ws/interpret") as ws:
        start(ws)
        ws.send_bytes(frame(1, 10))
        ws.receive_text()
    assert wait_all_closed()


def test_model_unavailable(monkeypatch):
    class Unloaded(MockRecognizer):
        @property
        def loaded(self):
            return False
    with TestClient(create_app(Unloaded())) as c:
        with c.websocket_connect("/ws/interpret") as ws:
            assert start(ws)["code"] == "model_unavailable"
            # simulated mode still works and is labeled
            assert start(ws, mode="simulated")["mode"] == "simulated"


# ---------------- sessions ----------------
def _cfg(sid="session-iso1", **kw):
    return SessionStart(type="session.start", session_id=sid, **kw)


def test_session_isolation(rec):
    s1 = LiveInterpretationSession(_cfg("session-a1"), Settings(), rec, extractor_factory=FakeExtractor)
    s2 = LiveInterpretationSession(_cfg("session-b2"), Settings(), rec, extractor_factory=FakeExtractor)
    rec.next_label, rec.next_score = "HELLO", 0.95
    ev1 = [m for i in range(40) for m in s1.process_landmarks(i, synthetic_frame(i * 66))
           if m["type"] == "recognition.result"]
    assert len(ev1) == 1
    assert len(s2.buffer) == 0 and s2.stabilizer.latched == set()
    ev2 = [m for i in range(40) for m in s2.process_landmarks(i, synthetic_frame(i * 66))
           if m["type"] == "recognition.result"]
    assert len(ev2) == 1 and ev2[0]["session_id"] == "session-b2"


def test_no_hands_never_runs_model(rec):
    s = LiveInterpretationSession(_cfg(), Settings(), rec, extractor_factory=FakeExtractor)
    rec.next_label, rec.next_score = "HELLO", 0.99
    msgs = [m for i in range(40) for m in s.process_landmarks(i, synthetic_frame(i * 66, hands=False))]
    assert rec.calls == 0
    assert all(m["type"] == "processing.status" for m in msgs)
    assert {m["state"] for m in msgs} == {"no_hands"}


def test_unknown_reported_not_emitted(rec):
    s = LiveInterpretationSession(_cfg(), Settings(), rec, extractor_factory=FakeExtractor)
    rec.next_label = None
    msgs = [m for i in range(40) for m in s.process_landmarks(i, synthetic_frame(i * 66))]
    types = {m["type"] for m in msgs}
    assert "recognition.unknown" in types and "recognition.result" not in types


def test_simulated_session_is_labeled():
    s = SimulatedInterpretationSession(_cfg(mode="simulated"), Settings(), extractor_factory=FakeExtractor)
    out = [m for i in range(80) for m in s.process_frame(i, i * 66, jpeg_bytes())]
    results = [m for m in out if m["type"] == "recognition.result"]
    assert results and all(r["simulated"] is True for r in results)


def test_websocket_rejects_foreign_origin(client):
    from starlette.websockets import WebSocketDisconnect
    with pytest.raises(WebSocketDisconnect):
        with client.websocket_connect("/ws/interpret", headers={"Origin": "http://evil.example"}) as ws:
            ws.receive_text()
    with client.websocket_connect("/ws/interpret", headers={"Origin": "http://localhost:5173"}) as ws:
        assert start(ws)["type"] == "session.started"
