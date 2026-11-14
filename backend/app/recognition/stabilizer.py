"""Prediction stabilization: voting + hysteresis + per-event duplicate suppression.

A sign is *emitted* (captioned / spoken) once when:
  * its model score >= `threshold` in at least `votes_needed` of the last
    `vote_window` predictions,
  * it is the top label in the most recent prediction,
  * it is not currently "latched".

After emission the label is latched. It unlatches (allowing the same sign to be
emitted again) only after a meaningful separation: `release_count` consecutive
predictions where its score < `release_threshold` (e.g. the signer lowered their
hands, or signed something else). A short global refractory gap prevents two
different labels firing from one ambiguous motion.
"""

from __future__ import annotations

from collections import deque
from dataclasses import dataclass, field


@dataclass
class StabilizerConfig:
    threshold: float = 0.7
    vote_window: int = 3
    votes_needed: int = 2
    release_threshold: float = 0.3
    release_count: int = 3
    refractory_ms: int = 700
    # A repeat of the *same* sign must be based on evidence that does not overlap
    # the previous event's window (~ the 1.6 s recognition window).
    same_label_gap_ms: int = 1500


@dataclass
class Observation:
    timestamp_ms: int
    label: str | None        # top label; None = no signer / unknown
    score: float             # score of top label
    scores: dict[str, float] = field(default_factory=dict)


@dataclass
class StableEvent:
    label: str
    score: float
    timestamp_ms: int


class PredictionStabilizer:
    def __init__(self, config: StabilizerConfig | None = None):
        self.config = config or StabilizerConfig()
        self.reset()

    def reset(self) -> None:
        self._history: deque[Observation] = deque(maxlen=self.config.vote_window)
        self._latched: dict[str, int] = {}  # label -> consecutive low-score count
        self._last_emit_ms: int | None = None
        self._last_emit_by_label: dict[str, int] = {}

    @property
    def latched(self) -> set[str]:
        return set(self._latched)

    def update(self, obs: Observation) -> StableEvent | None:
        cfg = self.config
        self._history.append(obs)

        # Update latches (hysteresis release).
        for label in list(self._latched):
            s = obs.scores.get(label, 0.0) if obs.label is not None else 0.0
            if s < cfg.release_threshold:
                self._latched[label] += 1
                if self._latched[label] >= cfg.release_count:
                    del self._latched[label]
            else:
                self._latched[label] = 0

        if obs.label is None or obs.score < cfg.threshold:
            return None
        if obs.label in self._latched:
            return None
        votes = sum(1 for o in self._history
                    if o.label is not None and o.scores.get(obs.label, 0.0) >= cfg.threshold)
        if votes < cfg.votes_needed:
            return None
        if (self._last_emit_ms is not None
                and obs.timestamp_ms - self._last_emit_ms < cfg.refractory_ms):
            return None
        prev_same = self._last_emit_by_label.get(obs.label)
        if prev_same is not None and obs.timestamp_ms - prev_same < cfg.same_label_gap_ms:
            return None

        recent = [o.scores.get(obs.label, 0.0) for o in self._history]
        score = sum(recent) / len(recent)
        self._latched[obs.label] = 0
        self._last_emit_ms = obs.timestamp_ms
        self._last_emit_by_label[obs.label] = obs.timestamp_ms
        return StableEvent(label=obs.label, score=score, timestamp_ms=obs.timestamp_ms)
