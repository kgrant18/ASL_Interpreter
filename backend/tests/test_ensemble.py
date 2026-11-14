"""Ensemble inference and the evaluation replay's rest padding."""

from __future__ import annotations

import json

import numpy as np
import pytest
import torch

from app.recognition.inference import LandmarkTemporalRecognizer, ensemble_members
from app.recognition.model import SignGRU
from app.vision.landmarks import FrameLandmarks
from app.vision.normalization import FEATURE_DIM, SEQ_LEN

LABELS = ["HELLO", "WATER", "_UNKNOWN"]


def save(path, seed, labels=LABELS):
    torch.manual_seed(seed)
    m = SignGRU(FEATURE_DIM, len(labels), hidden=16, proj=24)
    torch.save({"state_dict": m.state_dict(), "labels": labels, "feature_dim": FEATURE_DIM,
                "seq_len": SEQ_LEN, "hidden": 16, "proj": 24, "window_s": 1.6}, path)
    return m


def test_members_discovered(tmp_path):
    for n in ["m.pt", "m_s1.pt", "m_s2.pt", "other.pt", "m_eval.json"]:
        (tmp_path / n).write_bytes(b"")
    assert [p.name for p in ensemble_members(tmp_path / "m.pt")] == ["m.pt", "m_s1.pt", "m_s2.pt"]


def test_ensemble_averages_probabilities(tmp_path):
    a, b = save(tmp_path / "m.pt", 0), save(tmp_path / "m_s1.pt", 1)
    ev = tmp_path / "eval.json"
    ev.write_text(json.dumps({"enabled": ["HELLO", "WATER"], "recommended_threshold": 0.6}))
    rec = LandmarkTemporalRecognizer(ensemble_members(tmp_path / "m.pt"), ev, device="cpu")
    rec.load()
    assert rec.loaded and rec.get_metadata()["ensemble_size"] == 2
    assert rec.get_metadata()["recommended_threshold"] == 0.6
    x = np.random.default_rng(0).normal(size=(SEQ_LEN, FEATURE_DIM)).astype(np.float32)
    with torch.no_grad():
        t = torch.from_numpy(x)[None]
        expect = (torch.softmax(a.eval()(t), -1) + torch.softmax(b.eval()(t), -1))[0].numpy() / 2
    p = rec.predict(x)
    assert p.scores["HELLO"] == pytest.approx(float(expect[0]), abs=1e-5)
    assert p.scores["WATER"] == pytest.approx(float(expect[1]), abs=1e-5)


def test_ensemble_rejects_mismatched_labels(tmp_path):
    save(tmp_path / "m.pt", 0)
    save(tmp_path / "m_s1.pt", 1, labels=["A", "B", "_UNKNOWN"])
    rec = LandmarkTemporalRecognizer(ensemble_members(tmp_path / "m.pt"), None, device="cpu")
    rec.load()
    assert not rec.loaded and "labels differ" in rec.load_error


def test_with_rest_pads_with_handless_pose_frames():
    from training.evaluate import with_rest

    pose = np.zeros((33, 4), np.float32)
    hand = np.zeros((21, 3), np.float32)
    frames = [FrameLandmarks(0, pose=pose), FrameLandmarks(67, pose=pose, right_hand=hand),
              FrameLandmarks(134, pose=pose, right_hand=hand)]
    out = with_rest(frames, pre_ms=670, post_ms=335)
    ts = [f.timestamp_ms for f in out]
    assert ts == sorted(ts)
    pre = [f for f in out if f.timestamp_ms < 670]
    post = [f for f in out if f.timestamp_ms > 134 + 670]
    assert len(pre) == 10 and len(post) == 5
    assert all(f.pose is not None and not f.has_hands for f in pre + post)
    assert sum(f.has_hands for f in out) == 2
    assert with_rest([FrameLandmarks(0)]) == [FrameLandmarks(0)]  # no pose -> unchanged


def test_subset_glosses_parsing(tmp_path):
    from training.subset_manifest import read_glosses

    f = tmp_path / "g.txt"
    f.write_text("# comment HELLO\nHELLO YES\n\nWATER\n")
    assert read_glosses(f) == ["HELLO", "YES", "WATER"]


@pytest.mark.parametrize("name,weights", [("v1", "signgru.pt"), ("v2", "signgru_v2.pt"),
                                           ("v3", "signgru_v3.pt"), ("bogus", "signgru.pt")])
def test_model_selector(monkeypatch, name, weights):
    import importlib

    import app.config as cfg

    monkeypatch.setenv("SIGNBRIDGE_MODEL", name)
    try:
        assert importlib.reload(cfg).Settings().model_path.name == weights
    finally:
        monkeypatch.delenv("SIGNBRIDGE_MODEL")
        importlib.reload(cfg)
