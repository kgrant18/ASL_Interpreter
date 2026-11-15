"""Runtime configuration (environment variables with SIGNBRIDGE_ prefix)."""

from __future__ import annotations

import os
from dataclasses import dataclass, field
from pathlib import Path

BACKEND_DIR = Path(__file__).resolve().parents[1]


def _env(name: str, default: str) -> str:
    return os.environ.get(f"SIGNBRIDGE_{name}", default)


# SIGNBRIDGE_MODEL selects weights, evaluation report and (optionally) a phrase set:
#   phrases (default) - phrase-sign model + phrase matcher (app/recognition/phrases.json)
#   v1 (20 signs), v2 (161 trained, ensemble), v3 (51 curated signs) - per-sign captions
_MODEL_FILES = {"phrases": ("signgru_phrases.pt", "signgru_phrases_eval.json", "phrases.json"),
                "v1": ("signgru.pt", "signgru_eval.json", None),
                "v2": ("signgru_v2.pt", "signgru_v2_eval.json", None),
                "v3": ("signgru_v3.pt", "signgru_v3_eval.json", None)}
DEFAULT_MODEL = "phrases"
_MODEL = _MODEL_FILES.get(os.environ.get("SIGNBRIDGE_MODEL", DEFAULT_MODEL),
                          _MODEL_FILES[DEFAULT_MODEL])


def _phrases_default() -> Path | None:
    # SIGNBRIDGE_PHRASES=<path> overrides; SIGNBRIDGE_PHRASES= (empty) disables.
    env = os.environ.get("SIGNBRIDGE_PHRASES")
    if env is not None:
        return Path(env) if env else None
    return BACKEND_DIR / "app" / "recognition" / _MODEL[2] if _MODEL[2] else None


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
    tts_engine: str = field(default_factory=lambda: _env("TTS", "auto"))  # auto | piper | say
    phrases_path: Path | None = field(default_factory=_phrases_default)
    device: str = field(default_factory=lambda: _env("DEVICE", "auto"))  # auto | cpu | cuda | mps
    max_frame_bytes: int = field(default_factory=lambda: int(_env("MAX_FRAME_BYTES", str(1_000_000))))
    max_frame_pixels: int = 1920 * 1080
    # Run the classifier at most this often (ms); frames still update the buffer.
    inference_interval_ms: int = field(default_factory=lambda: int(_env("INFER_MS", "120")))


settings = Settings()
