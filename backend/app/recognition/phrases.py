"""Phrase matcher: maps a stream of recognized signs to a fixed set of English sentences.

Tolerant by design (pointing signs such as ME / YOU / THIS are easy to miss), but it
never produces anything outside the configured sentences:

* A phrase matches when, among the signs recognized in the last `window_s` seconds,
  an in-order subsequence covers at least half of the phrase's signs AND all but one
  of its non-pointing ("core") signs (at least one core sign). Per-phrase
  `min_signs` / `min_core` override this.
* A complete match fires immediately; a sufficient partial match fires once no new
  sign has arrived for `settle_ms`.
* A fired sentence is not repeated within `repeat_cooldown_s`, its leftover signs are
  ignored for `trailing_ms`, and all pending signs are consumed.
"""

from __future__ import annotations

import json
import math
from dataclasses import dataclass, field
from functools import lru_cache
from pathlib import Path


@dataclass(frozen=True)
class Phrase:
    id: str
    english: str
    signs: tuple[str, ...]          # canonical glosses, in signing order
    min_signs: int
    min_core: int


@dataclass
class PhraseMatch:
    phrase: Phrase
    glosses: list[str]              # canonical glosses actually recognized, in order
    score: float                    # mean model score of the matched signs
    complete: bool


@dataclass
class _Event:
    gloss: str
    score: float
    ts: int


@dataclass
class PhraseSet:
    phrases: list[Phrase]
    aliases: dict[str, str]         # model label -> canonical gloss
    window_ms: int = 7000
    settle_ms: int = 1500
    repeat_cooldown_ms: int = 6000
    trailing_ms: int = 3000
    pointing: frozenset[str] = field(default_factory=frozenset)

    @classmethod
    def from_dict(cls, d: dict) -> "PhraseSet":
        pointing = frozenset(d.get("pointing", []))
        aliases = {label: canon for canon, labels in d.get("aliases", {}).items() for label in labels}
        phrases = []
        for p in d["phrases"]:
            signs = tuple(p["signs"])
            core = [s for s in signs if s not in pointing]
            phrases.append(Phrase(
                id=p["id"], english=p["english"], signs=signs,
                min_signs=p.get("min_signs", math.ceil(len(signs) / 2)),
                min_core=p.get("min_core", max(1, len(core) - 1) if core else 0),
            ))
        return cls(phrases, aliases, int(d.get("window_s", 7) * 1000), int(d.get("settle_ms", 1500)),
                   int(d.get("repeat_cooldown_s", 6) * 1000), int(d.get("trailing_ms", 3000)), pointing)

    def canonical(self, label: str) -> str:
        return self.aliases.get(label, label)

    @property
    def glosses(self) -> set[str]:
        return {s for p in self.phrases for s in p.signs}


@lru_cache(maxsize=8)
def load_phrase_set(path: Path) -> PhraseSet:
    return PhraseSet.from_dict(json.loads(Path(path).read_text()))


def _best_subsequence(events: list[_Event], signs: tuple[str, ...]) -> list[int]:
    """Indices into `events` of the longest in-order match of `signs` (LCS)."""
    n, m = len(events), len(signs)
    dp = [[0] * (m + 1) for _ in range(n + 1)]
    for i in range(n - 1, -1, -1):
        for j in range(m - 1, -1, -1):
            dp[i][j] = (1 + dp[i + 1][j + 1] if events[i].gloss == signs[j]
                        else max(dp[i + 1][j], dp[i][j + 1]))
    out, i, j = [], 0, 0
    while i < n and j < m:
        if events[i].gloss == signs[j] and dp[i][j] == 1 + dp[i + 1][j + 1]:
            out.append(i)
            i, j = i + 1, j + 1
        elif dp[i + 1][j] >= dp[i][j + 1]:
            i += 1
        else:
            j += 1
    return out


class PhraseMatcher:
    """Per-session state. Feed stable sign events with `add`, call `tick` every frame."""

    def __init__(self, phrase_set: PhraseSet):
        self.set = phrase_set
        self.events: list[_Event] = []
        self._last_fired: dict[str, int] = {}
        self._trailing: tuple[frozenset[str], int] | None = None

    @property
    def pending(self) -> list[str]:
        return [e.gloss for e in self.events]

    def reset(self) -> None:
        self.events.clear()
        self._trailing = None

    def add(self, label: str, score: float, ts: int) -> PhraseMatch | None:
        gloss = self.set.canonical(label)
        if gloss not in self.set.glosses:
            return None
        if self._trailing and gloss in self._trailing[0] and ts < self._trailing[1]:
            return None  # leftover sign of the sentence that was just spoken
        self.events.append(_Event(gloss, score, ts))
        self._expire(ts)
        best = self._best(ts)
        return self._fire(best, ts) if best and best.complete else None

    def tick(self, ts: int) -> PhraseMatch | None:
        self._expire(ts)
        if not self.events or ts - self.events[-1].ts < self.set.settle_ms:
            return None
        best = self._best(ts)
        if best is None:
            return None
        return self._fire(best, ts)

    def _expire(self, ts: int) -> None:
        self.events = [e for e in self.events if ts - e.ts <= self.set.window_ms]

    def _candidates(self, ts: int) -> list[PhraseMatch]:
        out = []
        for p in self.set.phrases:
            last = self._last_fired.get(p.id)
            if last is not None and ts - last < self.set.repeat_cooldown_ms:
                continue
            idx = _best_subsequence(self.events, p.signs)
            matched = [self.events[i] for i in idx]
            core = sum(e.gloss not in self.set.pointing for e in matched)
            if len(matched) >= p.min_signs and core >= p.min_core and matched:
                out.append(PhraseMatch(p, [e.gloss for e in matched],
                                       sum(e.score for e in matched) / len(matched),
                                       complete=len(matched) == len(p.signs)))
        return out

    def _best(self, ts: int) -> PhraseMatch | None:
        cands = self._candidates(ts)
        if not cands:
            return None
        return max(cands, key=lambda c: (len(c.glosses) / len(c.phrase.signs), len(c.glosses), c.score))

    def _fire(self, match: PhraseMatch, ts: int) -> PhraseMatch:
        self._last_fired[match.phrase.id] = ts
        self._trailing = (frozenset(match.phrase.signs), ts + self.set.trailing_ms)
        self.events.clear()
        return match
