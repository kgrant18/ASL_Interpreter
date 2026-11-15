"""Phrase matcher: tolerant in-order matching, timing, cooldowns, and session output."""

from __future__ import annotations

from pathlib import Path

import pytest

from app.config import BACKEND_DIR, Settings
from app.recognition.phrases import PhraseMatcher, load_phrase_set
from app.schemas.messages import SessionStart
from app.services.interpretation import LiveInterpretationSession
from tests.conftest import FakeExtractor, MockRecognizer, synthetic_frame

PHRASES = BACKEND_DIR / "app" / "recognition" / "phrases.json"
SENTENCES = {
    "greeting": "Hello, it's nice to meet you.",
    "missed": "Did I miss anything?",
    "idea": "I have an idea.",
    "show": "I can show this.",
    "thanks": "Thank you for listening.",
}


@pytest.fixture
def matcher():
    return PhraseMatcher(load_phrase_set(PHRASES))


def feed(m: PhraseMatcher, labels: list[str], start: int = 0, gap: int = 900, settle: bool = True):
    """Add signs `gap` ms apart; then let the settle time pass. Returns fired matches."""
    fired, t = [], start
    for lab in labels:
        r = m.add(lab, 0.9, t)
        if r:
            fired.append((r, t))
        for dt in range(100, gap, 100):  # frames between signs
            r = m.tick(t + dt)
            if r:
                fired.append((r, t + dt))
        t += gap
    if settle:
        for dt in range(0, 4000, 100):
            r = m.tick(t + dt)
            if r:
                fired.append((r, t + dt))
    return fired


def test_config_has_the_five_supported_sentences(matcher):
    assert {p.id: p.english for p in matcher.set.phrases} == SENTENCES


@pytest.mark.parametrize("signs,phrase", [
    (["HELLO", "NICE", "MEET", "YOU"], "greeting"),
    (["ME", "MISS", "SOMETHING"], "missed"),
    (["ME", "MISS", "ANY"], "missed"),             # ANY(THING) variant
    (["ME", "HAVE", "IDEA"], "idea"),
    (["ME", "CAN1", "SHOW", "THIS"], "show"),      # CAN1 is the model label for CAN
    (["THANKYOU"], "thanks"),
])
def test_complete_sentences_fire_immediately(matcher, signs, phrase):
    fired = feed(matcher, signs, settle=False)
    assert len(fired) == 1
    match, t = fired[0]
    assert match.phrase.id == phrase and match.complete
    assert t == (len(signs) - 1) * 900          # on the last sign, no settle wait


@pytest.mark.parametrize("signs,phrase", [
    (["HELLO", "MEET", "YOU"], "greeting"),        # NICE missed
    (["HELLO", "MEET"], "greeting"),
    (["MISS", "SOMETHING"], "missed"),             # ME (pointing) missed
    (["HAVE", "IDEA"], "idea"),
    (["CAN1", "SHOW"], "show"),                     # ME and THIS missed
    (["ME", "SHOW"], "show"),
])
def test_tolerant_partial_matches_fire_after_a_pause(matcher, signs, phrase):
    fired = feed(matcher, signs)
    assert [m.phrase.id for m, _ in fired] == [phrase]
    match, t = fired[0]
    assert not match.complete and match.glosses == [matcher.set.canonical(s) for s in signs]
    assert t - (len(signs) - 1) * 900 >= matcher.set.settle_ms


@pytest.mark.parametrize("signs", [
    ["ME"], ["YOU"], ["THIS"], ["ME", "THIS"],      # pointing signs alone
    ["HELLO"], ["HELLO", "YOU"],                    # greeting needs 2 core signs
    ["IDEA"], ["SHOW"], ["MISS"],                   # one sign of a multi-sign sentence
    ["WATER", "PLEASE"],                            # signs outside every sentence
])
def test_never_speaks_partial_or_unmatched_sequences(matcher, signs):
    assert feed(matcher, signs) == []


def test_order_matters(matcher):
    assert feed(matcher, ["IDEA", "HAVE"]) == []


def test_signs_must_fall_within_the_window(matcher):
    window = matcher.set.window_ms
    assert matcher.add("HAVE", 0.9, 0) is None
    assert matcher.tick(window + 1) is None          # HAVE expires before IDEA arrives
    assert matcher.add("IDEA", 0.9, window + 2) is None
    assert all(matcher.tick(window + 2 + dt) is None for dt in range(0, 4000, 100))


def test_sentence_spoken_once_with_cooldown(matcher):
    first = feed(matcher, ["THANKYOU"], start=0)
    again = feed(matcher, ["THANKYOU"], start=2000)          # within the cooldown
    later = feed(matcher, ["THANKYOU"], start=2000 + matcher.set.repeat_cooldown_ms)
    assert len(first) == 1 and again == [] and len(later) == 1


def test_trailing_sign_after_early_fire_is_consumed(matcher):
    fired = feed(matcher, ["ME", "CAN1", "SHOW"], gap=900)    # fires after the pause
    assert [m.phrase.id for m, _ in fired] == ["show"]
    t = fired[0][1] + 200
    assert matcher.add("THIS", 0.9, t) is None and matcher.pending == []
    # a different sentence right after still works
    later = feed(matcher, ["HAVE", "IDEA"], start=t + 500)
    assert [m.phrase.id for m, _ in later] == ["idea"]


def test_shared_pointing_sign_picks_the_right_sentence(matcher):
    fired = feed(matcher, ["ME", "HAVE", "IDEA"], settle=False)
    assert fired[0][0].phrase.id == "idea"


# ---- live session output (mocked model) ----

def _session(rec):
    cfg = SessionStart(type="session.start", session_id="phrase-session", enable_landmarks=False)
    settings = Settings(phrases_path=PHRASES)
    return LiveInterpretationSession(cfg, settings, rec, extractor_factory=FakeExtractor)


def _sign(sess, rec, label, t0, seq0):
    """Hold `label` for ~1 s, then lower hands for ~1 s (releases the stabilizer)."""
    msgs, seq, t = [], seq0, t0
    rec.next_label, rec.next_score = label, 0.95
    for _ in range(15):
        msgs += sess.process_landmarks(seq, synthetic_frame(t))
        seq, t = seq + 1, t + 67
    rec.next_label = None
    for _ in range(15):
        msgs += sess.process_landmarks(seq, synthetic_frame(t, hands=False))
        seq, t = seq + 1, t + 67
    return msgs, t, seq


def test_session_emits_signs_silently_and_one_sentence_result():
    rec = MockRecognizer(labels=("ME", "HAVE", "IDEA", "THANKYOU"))
    sess = _session(rec)
    msgs, t, seq = [], 0, 0
    for _ in range(25):  # signer resting in frame first
        msgs += sess.process_landmarks(seq, synthetic_frame(t, hands=False))
        seq, t = seq + 1, t + 67
    for lab in ("ME", "HAVE", "IDEA"):
        m, t, seq = _sign(sess, rec, lab, t, seq)
        msgs += m
    signs = [m["label"] for m in msgs if m["type"] == "recognition.sign"]
    results = [m for m in msgs if m["type"] == "recognition.result"]
    assert signs == ["ME", "HAVE", "IDEA"]
    assert len(results) == 1
    r = results[0]
    assert r["prediction"]["english"] == "I have an idea."
    assert r["glosses"] == ["ME", "HAVE", "IDEA"] and r["phrase_id"] == "idea"
    sess.close()


def test_session_without_phrase_set_keeps_per_sign_results():
    rec = MockRecognizer(labels=("HELLO", "YES"))
    cfg = SessionStart(type="session.start", session_id="sign-session", enable_landmarks=False)
    sess = LiveInterpretationSession(cfg, Settings(phrases_path=None), rec,
                                     extractor_factory=FakeExtractor)
    assert sess.phrases is None
    msgs, t, seq = [], 0, 0
    for _ in range(25):
        msgs += sess.process_landmarks(seq, synthetic_frame(t, hands=False))
        seq, t = seq + 1, t + 67
    m, _, _ = _sign(sess, rec, "HELLO", t, seq)
    assert [x["prediction"]["label"] for x in m if x["type"] == "recognition.result"] == ["HELLO"]
    assert not any(x["type"] == "recognition.sign" for x in m)


def test_vocabulary_api_lists_supported_phrases(monkeypatch):
    from fastapi.testclient import TestClient

    import app.config as config
    from app.main import create_app

    monkeypatch.setattr(config.settings, "phrases_path", PHRASES)
    with TestClient(create_app(MockRecognizer())) as c:
        v = c.get("/api/vocabulary").json()
    assert [p["english"] for p in v["phrases"]] == list(SENTENCES.values())
    assert v["phrases"][3]["glosses"] == ["ME", "CAN", "SHOW", "THIS"]


def test_vocabulary_api_without_phrase_set():
    from fastapi.testclient import TestClient

    from app.main import create_app

    with TestClient(create_app(MockRecognizer())) as c:
        assert c.get("/api/vocabulary").json()["phrases"] == []
