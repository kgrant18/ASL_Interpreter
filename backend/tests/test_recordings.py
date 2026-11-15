"""Local recorder: record session over the WebSocket, storage, counts, delete-last."""

from __future__ import annotations

import json
import struct

import numpy as np
import pytest
from fastapi.testclient import TestClient

from app import recordings
from app.main import create_app
from app.services import interpretation
from app.vision.serialization import unpack
from tests.conftest import FakeExtractor, MockRecognizer, jpeg_bytes, synthetic_frame

UI = {"Origin": "http://localhost:5173"}


@pytest.fixture(autouse=True)
def tmp_store(tmp_path, monkeypatch):
    monkeypatch.setattr(recordings, "LANDMARK_DIR", tmp_path / "landmarks")
    monkeypatch.setattr(recordings, "INDEX", tmp_path / "local" / "recordings.csv")
    monkeypatch.setattr(interpretation, "LandmarkExtractor", FakeExtractor)
    return tmp_path


@pytest.fixture
def client():
    with TestClient(create_app(MockRecognizer())) as c:
        yield c


def _frame(seq: int) -> bytes:
    return struct.pack("<Id", seq, seq * 67.0) + jpeg_bytes()


def _recv_until(ws, kind: str, limit: int = 200) -> dict:
    for _ in range(limit):
        msg = json.loads(ws.receive_text())
        if msg["type"] == kind:
            return msg
    raise AssertionError(f"no {kind}")


def _take(ws, sid: str, label: str, frames: int, start: int = 1) -> dict:
    ws.send_text(json.dumps({"type": "record.begin", "session_id": sid, "label": label}))
    for i in range(start, start + frames):
        ws.send_bytes(_frame(i))
        _recv_until(ws, "processing.status")  # one frame in flight, like the browser
    ws.send_text(json.dumps({"type": "record.end", "session_id": sid}))
    return _recv_until(ws, "record.saved")


def test_record_session_saves_landmarks_never_runs_model(client, tmp_store):
    sid = "record-session-1"
    with client.websocket_connect("/ws/interpret") as ws:
        ws.send_text(json.dumps({"type": "session.start", "session_id": sid, "mode": "record"}))
        assert _recv_until(ws, "session.started")["mode"] == "record"
        saved = _take(ws, sid, "NICE", 12)
        assert saved["ok"] and saved["count"] == 1 and saved["frames"] == 12
        saved = _take(ws, sid, "NICE", 10, start=20)
        assert saved["count"] == 2
    assert client.app.state.recognizer.calls == 0
    files = sorted((tmp_store / "landmarks").glob("local-NICE-*.npz"))
    assert len(files) == 2
    frames = unpack(np.load(files[0]))
    assert len(frames) == 12 and frames[0].has_hands
    assert recordings.counts() == {"NICE": 2}
    assert client.get("/api/recordings").json() == {"counts": {"NICE": 2}}


def test_take_without_hands_is_rejected(client, monkeypatch):
    monkeypatch.setattr(interpretation, "LandmarkExtractor", lambda: FakeExtractor(hands=False))
    sid = "record-session-2"
    with client.websocket_connect("/ws/interpret") as ws:
        ws.send_text(json.dumps({"type": "session.start", "session_id": sid, "mode": "record"}))
        _recv_until(ws, "session.started")
        saved = _take(ws, sid, "MISS", 12)
    assert not saved["ok"] and "no hands" in saved["message"]
    assert recordings.counts() == {}


def test_idle_takes_allowed_without_hands():
    frames = [synthetic_frame(i * 67, hands=False) for i in range(20)]
    assert recordings.save("_IDLE", frames)["count"] == 1


def test_invalid_label_and_discard(client):
    sid = "record-session-3"
    with client.websocket_connect("/ws/interpret") as ws:
        ws.send_text(json.dumps({"type": "session.start", "session_id": sid, "mode": "record"}))
        _recv_until(ws, "session.started")
        ws.send_text(json.dumps({"type": "record.begin", "session_id": sid, "label": "../etc"}))
        assert _recv_until(ws, "error")["code"] == "invalid_label"
        ws.send_text(json.dumps({"type": "record.begin", "session_id": sid, "label": "YOU"}))
        for i in range(1, 10):
            ws.send_bytes(_frame(i))
            _recv_until(ws, "processing.status")
        ws.send_text(json.dumps({"type": "record.end", "session_id": sid, "discard": True}))
        ws.send_text(json.dumps({"type": "ping"}))
        assert _recv_until(ws, "pong")
    assert recordings.counts() == {}


def test_delete_last(client, tmp_store):
    for _ in range(3):
        recordings.save("ME", [synthetic_frame(i * 67) for i in range(10)])
    r = client.post("/api/recordings/delete-last", json={"label": "ME"}, headers=UI)
    assert r.json() == {"counts": {"ME": 2}}
    assert len(list((tmp_store / "landmarks").glob("local-ME-*.npz"))) == 2
    assert client.post("/api/recordings/delete-last", json={"label": "IDEA"}, headers=UI).status_code == 404
    assert client.post("/api/recordings/delete-last", json={"label": "ME"},
                       headers={"Origin": "https://evil.example"}).status_code == 403


def test_collapsed_pose_is_rejected():
    """Shoulders detected a few hundredths apart (signer too close / mis-detected)."""
    frames = []
    for i in range(20):
        f = synthetic_frame(i * 67)
        f.pose[11, :2] = [1.32, 0.69]
        f.pose[12, :2] = [1.33, 0.70]
        frames.append(f)
    with pytest.raises(recordings.RecordingError, match="shoulders not detected"):
        recordings.save("NICE", frames)
    assert recordings.counts() == {}


def test_collapsed_pose_is_not_a_usable_body_live():
    from app.vision.normalization import body_reference

    f = synthetic_frame(0)
    assert body_reference([f]) is not None
    f.pose[11, :2] = [1.32, 0.69]
    f.pose[12, :2] = [1.33, 0.70]
    assert body_reference([f]) is None


def test_saved_take_times_start_at_zero(tmp_store):
    frames = [synthetic_frame(57_000 + i * 67) for i in range(10)]
    info = recordings.save("IDEA", frames)
    saved = unpack(np.load(tmp_store / "landmarks" / info["file"]))
    assert saved[0].timestamp_ms == 0 and saved[-1].timestamp_ms == 9 * 67


def test_rest_padding_is_relative_to_clip_start():
    from training.evaluate import with_rest

    frames = [synthetic_frame(57_000 + i * 67) for i in range(10)]
    out = with_rest(frames, pre_ms=1500, post_ms=1000)
    ts = [f.timestamp_ms for f in out]
    assert ts == sorted(ts) and max(b - a for a, b in zip(ts, ts[1:])) <= 100
