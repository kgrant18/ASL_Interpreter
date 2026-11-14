"""Runtime configuration (environment variables with SIGNBRIDGE_ prefix)."""

from __future__ import annotations

import os
from dataclasses import dataclass, field
from pathlib import Path

BACKEND_DIR = Path(__file__).resolve().parents[1]


def _env(name: str, default: str) -> str:
    return os.environ.get(f"SIGNBRIDGE_{name}", default)


# SIGNBRIDGE_MODEL=v1 (20 signs), v2 (161 trained, ensemble) or v3 (51 curated signs).
_MODEL_FILES = {"v1": ("signgru.pt", "signgru_eval.json"),
                "v2": ("signgru_v2.pt", "signgru_v2_eval.json"),
                "v3": ("signgru_v3.pt", "signgru_v3_eval.json")}
_MODEL = _MODEL_FILES.get(os.environ.get("SIGNBRIDGE_MODEL", "v1"), _MODEL_FILES["v1"])


@dataclass
class Settings:
    host: str = field(default_factory=lambda: _env("HOST", "127.0.0.1"))
    port: int = field(default_factory=lambda: int(_env("PORT", "8000")))
    cors_origins: list[str] = field(default_factory=lambda: _env(
        "CORS_ORIGINS", "http://localhost:5173,http://127.0.0.1:5173").split(","))
    model_path: Path = field(default_factory=lambda: Path(_env(
        "MODEL_PATH", str(BACKEND_DIR / "models" / _MODEL[0]))))
    eval_path: Path = field(default_factory=lambda: Path(_env(
        "EVAL_PATH", str(BACKEND_DIR / "models" / _MODEL[1]))))
    tts_voice_path: Path = field(default_factory=lambda: Path(_env(
        "TTS_VOICE", str(BACKEND_DIR / "models" / "piper" / "en_US-ljspeech-medium.onnx"))))
    device: str = field(default_factory=lambda: _env("DEVICE", "auto"))
    max_frame_bytes: int = field(default_factory=lambda: int(_env("MAX_FRAME_BYTES", str(1_000_000))))
    max_frame_pixels: int = 1920 * 1080
    # Run the classifier at most this often (ms); frames still update the buffer.
    inference_interval_ms: int = field(default_factory=lambda: int(_env("INFER_MS", "120")))


settings = Settings()
