"""LandmarkTemporalRecognizer: real inference with the trained SignGRU model."""

from __future__ import annotations

import json
import logging
import threading
import time
from pathlib import Path

import numpy as np

from .base import RawPrediction, SignRecognizer, VocabularyEntry
from .vocabulary import SIGNS, english_for

logger = logging.getLogger(__name__)

UNKNOWN = "_UNKNOWN"


class LandmarkTemporalRecognizer(SignRecognizer):
    def __init__(self, weights: Path, eval_report: Path | None = None,
                 device: str = "auto"):
        self.weights = Path(weights)
        self.eval_report = Path(eval_report) if eval_report else None
        self.requested_device = device
        self._model = None
        self._labels: list[str] = []
        self._enabled: set[str] = set()
        self._eval: dict = {}
        self._meta: dict = {}
        self._device = "cpu"
        self._lock = threading.Lock()
        self.load_error: str | None = None

    @property
    def loaded(self) -> bool:
        return self._model is not None

    @property
    def labels(self) -> list[str]:
        return list(self._labels)

    @property
    def window_s(self) -> float:
        return float(self._meta.get("window_s", 1.6))

    def load(self) -> None:
        try:
            import torch

            from .model import SignGRU

            if not self.weights.exists():
                raise FileNotFoundError(f"model weights not found: {self.weights}")
            if self.requested_device == "auto":
                self._device = "cuda" if torch.cuda.is_available() else "cpu"
            else:
                self._device = self.requested_device
            ckpt = torch.load(self.weights, map_location="cpu", weights_only=False)
            model = SignGRU(ckpt["feature_dim"], len(ckpt["labels"]),
                            hidden=ckpt.get("hidden", 128), proj=ckpt.get("proj", 192))
            model.load_state_dict(ckpt["state_dict"])
            model.eval().to(self._device)
            self._labels = list(ckpt["labels"])
            self._meta = {k: v for k, v in ckpt.items() if k != "state_dict"}
            self._load_eval()
            self._model = model
            self._torch = torch
            # warm-up
            self.predict(np.zeros((ckpt["seq_len"], ckpt["feature_dim"]), np.float32))
            logger.info("loaded %s on %s; enabled=%s", self.weights.name, self._device,
                        sorted(self._enabled))
        except Exception as exc:
            self._model = None
            self.load_error = str(exc)
            logger.error("model load failed: %s", exc)

    def _load_eval(self) -> None:
        targets = [l for l in self._labels if l != UNKNOWN]
        if self.eval_report and self.eval_report.exists():
            self._eval = json.loads(self.eval_report.read_text())
            self._enabled = set(self._eval.get("enabled", [])) & set(targets)
        else:
            # Without a held-out evaluation we cannot vouch for any sign.
            self._eval = {}
            self._enabled = set()
            logger.warning("no evaluation report; all signs disabled until evaluated")

    def predict(self, window: np.ndarray) -> RawPrediction:
        if self._model is None:
            raise RuntimeError("model not loaded")
        torch = self._torch
        t0 = time.perf_counter()
        with self._lock, torch.no_grad():
            x = torch.from_numpy(np.asarray(window, np.float32))[None].to(self._device)
            probs = torch.softmax(self._model(x), -1)[0].cpu().numpy()
        ms = (time.perf_counter() - t0) * 1000
        scores = {l: float(p) for l, p in zip(self._labels, probs)}
        enabled_scores = {l: s for l, s in scores.items() if l in self._enabled}
        # Probability mass of the unknown class and of non-validated classes counts
        # as "not a supported sign".
        unknown = 1.0 - sum(enabled_scores.values())
        if enabled_scores:
            top = max(enabled_scores, key=enabled_scores.get)
            if enabled_scores[top] > unknown:
                return RawPrediction(top, enabled_scores[top], enabled_scores, unknown, ms)
        return RawPrediction(None, unknown, enabled_scores, unknown, ms)

    def get_vocabulary(self) -> list[VocabularyEntry]:
        per_class = self._eval.get("per_class", {})
        out = []
        for label in self._labels:
            if label == UNKNOWN:
                continue
            info = SIGNS.get(label)
            pc = per_class.get(label, {})
            enabled = label in self._enabled
            if not self._eval:
                status = "Not evaluated"
            elif enabled:
                status = "Validated on held-out signers"
            else:
                status = "Disabled: below held-out accuracy bar"
            out.append(VocabularyEntry(
                label=label, english=english_for(label),
                description=info.description if info else "",
                enabled=enabled, validation=status,
                test_accuracy=pc.get("accuracy"), test_samples=pc.get("n"),
            ))
        out.sort(key=lambda e: (not e.enabled, e.label))
        return out

    def get_metadata(self) -> dict:
        info = self._meta.get("train_info", {})
        return {
            "name": "SignGRU landmark temporal classifier",
            "version": self._meta.get("version", "unknown"),
            "loaded": self.loaded,
            "load_error": self.load_error,
            "device": self._device,
            "mode": "live",
            "recognition": "isolated signs, limited vocabulary",
            "supported_class_count": len(self._enabled),
            "trained_class_count": len([l for l in self._labels if l != UNKNOWN]),
            "window_seconds": self.window_s,
            "dataset": info.get("dataset"),
            "evaluation": {k: self._eval.get(k) for k in
                           ("test_central_accuracy", "test_clips", "test_signers",
                            "streaming", "enable_rule") if k in self._eval},
            "limitations": [
                "Recognizes isolated signs from a small vocabulary only; not continuous ASL translation.",
                "Uses hands and upper-body landmarks; facial grammar is not modeled.",
                "Scores are uncalibrated softmax model scores, not certainty estimates.",
                "One visible signer at a time.",
                "Trained on ASL Citizen webcam recordings; accuracy varies with lighting, framing and signer.",
            ],
        }
