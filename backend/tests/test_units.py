"""Unit tests for normalization, buffering and stabilization (no model, no MediaPipe)."""

import numpy as np
import pytest

from app.recognition.stabilizer import Observation, PredictionStabilizer, StabilizerConfig
from app.vision.normalization import (
    FEATURE_DIM, HAND_DIM, SEQ_LEN, body_reference, frame_features, mirror_features,
    resample_by_time, window_tensor,
)
from app.vision.temporal_buffer import TemporalBuffer
from tests.conftest import synthetic_frame


# ---------------- normalization ----------------
def test_feature_dimension():
    f = synthetic_frame(0)
    ref = body_reference([f])
    assert frame_features(f, ref).shape == (FEATURE_DIM,)


def test_translation_and_scale_invariance():
    a = synthetic_frame(0)
    b = synthetic_frame(0, dx=0.2)  # signer moved right
    fa = frame_features(a, body_reference([a]))
    fb = frame_features(b, body_reference([b]))
    np.testing.assert_allclose(fa, fb, atol=1e-5)

    c = synthetic_frame(0)
    c.pose[:, :2] *= 2.0  # closer to the camera
    for arr in (c.left_hand, c.right_hand):
        arr *= 2.0
    fc = frame_features(c, body_reference([c]))
    np.testing.assert_allclose(fa, fc, atol=1e-4)


def test_missing_hands_are_explicit():
    f = synthetic_frame(0, hands=False)
    feats = frame_features(f, body_reference([f]))
    assert feats[0] == 0 and feats[HAND_DIM] == 0          # presence flags off
    assert not feats[:2 * HAND_DIM].any()                  # no fake coordinates
    assert feats[2 * HAND_DIM] == 1                        # pose present


def test_no_pose_means_no_window():
    frames = [synthetic_frame(t, pose=False) for t in range(0, 1600, 66)]
    assert body_reference(frames) is None
    assert window_tensor(frames) is None


def test_window_shape_and_time_resampling():
    frames = [synthetic_frame(t) for t in range(0, 1600, 66)]
    w = window_tensor(frames)
    assert w.shape == (SEQ_LEN, FEATURE_DIM)
    # frame-rate independence: 10 fps vs 30 fps give the same static window
    w10 = window_tensor([synthetic_frame(t) for t in range(0, 1600, 100)], 0, 1500)
    w30 = window_tensor([synthetic_frame(t) for t in range(0, 1600, 33)], 0, 1500)
    np.testing.assert_allclose(w10, w30, atol=1e-5)


def test_resample_keeps_presence_binary():
    times = np.array([0, 100, 200, 300], float)
    feats = np.array([[1.0], [0.0], [1.0], [0.0]])
    out = resample_by_time(times, feats, 0, 300, 13)
    assert set(np.unique(out)) <= {0.0, 1.0}


def test_mirror_is_involution():
    rng = np.random.default_rng(0)
    x = rng.normal(size=(SEQ_LEN, FEATURE_DIM)).astype(np.float32)
    np.testing.assert_allclose(mirror_features(mirror_features(x)), x, atol=1e-6)


# ---------------- temporal buffer ----------------
def test_buffer_is_bounded_by_time_and_count():
    b = TemporalBuffer(window_ms=1000, max_frames=10)
    for t in range(0, 5000, 50):
        b.append(synthetic_frame(t))
    assert len(b) <= 10
    assert b.span_ms <= 1000


def test_buffer_drops_out_of_order_and_resets():
    b = TemporalBuffer(window_ms=1000)
    b.append(synthetic_frame(100))
    b.append(synthetic_frame(50))
    b.append(synthetic_frame(100))
    assert len(b) == 1
    b.clear()
    assert len(b) == 0


# ---------------- stabilizer ----------------
def obs(t, label, score):
    scores = {"HELLO": 0.0, "YES": 0.0}
    if label:
        scores[label] = score
    return Observation(t, label, score, scores)


def run(stab, seq):
    return [e.label for e in (stab.update(o) for o in seq) if e]


def test_single_event_for_repeated_predictions():
    stab = PredictionStabilizer(StabilizerConfig(threshold=0.7, vote_window=3, votes_needed=2))
    seq = [obs(t * 120, "HELLO", 0.9) for t in range(12)]  # same sign over 12 windows
    assert run(stab, seq) == ["HELLO"]


def test_repeat_allowed_after_release():
    stab = PredictionStabilizer(StabilizerConfig(threshold=0.7, vote_window=3, votes_needed=2,
                                                 release_count=3, refractory_ms=0))
    seq = [obs(t * 120, "HELLO", 0.9) for t in range(5)]
    seq += [obs(600 + t * 120, None, 0.0) for t in range(8)]   # hands down ~1 s
    seq += [obs(1600 + t * 120, "HELLO", 0.9) for t in range(5)]
    assert run(stab, seq) == ["HELLO", "HELLO"]


def test_no_repeat_without_separation():
    stab = PredictionStabilizer(StabilizerConfig(release_count=3, refractory_ms=0))
    seq = [obs(0, "HELLO", 0.9), obs(120, "HELLO", 0.9), obs(240, None, 0.0),
           obs(360, "HELLO", 0.9), obs(480, "HELLO", 0.9)]
    assert run(stab, seq) == ["HELLO"]


def test_low_confidence_and_unknown_never_emit():
    stab = PredictionStabilizer(StabilizerConfig(threshold=0.7))
    seq = [obs(t * 120, "HELLO", 0.5) for t in range(10)] + [obs(2000 + t, None, 0.95) for t in range(10)]
    assert run(stab, seq) == []


def test_single_spike_does_not_emit():
    stab = PredictionStabilizer(StabilizerConfig(threshold=0.7, vote_window=3, votes_needed=2))
    seq = [obs(0, None, 0), obs(120, "YES", 0.95), obs(240, None, 0), obs(360, None, 0)]
    assert run(stab, seq) == []


def test_same_sign_needs_non_overlapping_evidence():
    stab = PredictionStabilizer(StabilizerConfig(release_count=1, refractory_ms=0,
                                                 same_label_gap_ms=1500))
    seq = [obs(0, "HELLO", 0.9), obs(120, "HELLO", 0.9), obs(240, None, 0.0),
           obs(360, "HELLO", 0.9), obs(480, "HELLO", 0.9)]       # released, but too soon
    seq += [obs(2000, "HELLO", 0.9), obs(2120, "HELLO", 0.9)]   # later: genuine repeat
    assert run(stab, seq) == ["HELLO", "HELLO"]


def test_different_signs_both_emit():
    stab = PredictionStabilizer(StabilizerConfig(refractory_ms=300))
    seq = [obs(t * 120, "HELLO", 0.9) for t in range(4)] + [obs(600 + t * 120, "YES", 0.9) for t in range(4)]
    assert run(stab, seq) == ["HELLO", "YES"]


def test_reset_clears_latch():
    stab = PredictionStabilizer(StabilizerConfig(refractory_ms=0))
    run(stab, [obs(0, "HELLO", 0.9), obs(120, "HELLO", 0.9)])
    assert "HELLO" in stab.latched
    stab.reset()
    assert stab.latched == set()
    assert run(stab, [obs(240, "HELLO", 0.9), obs(360, "HELLO", 0.9)]) == ["HELLO"]


@pytest.mark.parametrize("bad", [b"", b"notajpeg", b"\xff\xd8garbage"])
def test_decode_rejects_invalid_frames(bad):
    from app.services.interpretation import FrameError, decode_jpeg
    with pytest.raises(FrameError):
        decode_jpeg(bad, 1920 * 1080)
