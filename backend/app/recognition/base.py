"""Recognition interface."""

from __future__ import annotations

from abc import ABC, abstractmethod
from dataclasses import dataclass, field

import numpy as np


@dataclass
class VocabularyEntry:
    label: str
    english: str
    description: str
    enabled: bool
    validation: str            # human-readable validation status
    test_accuracy: float | None = None
    test_samples: int | None = None


@dataclass
class RawPrediction:
    """Model output for one window. Scores are softmax model scores (uncalibrated)."""

    label: str | None              # top *enabled* label, or None for unknown
    score: float
    scores: dict[str, float] = field(default_factory=dict)  # enabled labels only
    unknown_score: float = 0.0
    inference_ms: float = 0.0


class SignRecognizer(ABC):
    @abstractmethod
    def load(self) -> None: ...

    @abstractmethod
    def predict(self, window: np.ndarray) -> RawPrediction: ...

    @abstractmethod
    def get_vocabulary(self) -> list[VocabularyEntry]: ...

    @abstractmethod
    def get_metadata(self) -> dict: ...

    @property
    @abstractmethod
    def loaded(self) -> bool: ...
