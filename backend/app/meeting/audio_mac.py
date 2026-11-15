"""macOS playback of synthesized speech to named CoreAudio devices (PortAudio).

Used for the BlackHole virtual microphone and the optional local monitor. Audio is
resampled to each device's native rate and duplicated to its channel count, and
playback can be interrupted between ~40 ms blocks (mute / Ctrl+Shift+M).
"""

from __future__ import annotations

import io
import threading
import wave

import numpy as np

_active = 0
_active_lock = threading.Lock()


def active_streams() -> int:
    return _active


def _decode(wav: bytes) -> tuple[np.ndarray, int]:
    with wave.open(io.BytesIO(wav)) as w:
        sr, ch, width = w.getframerate(), w.getnchannels(), w.getsampwidth()
        raw = w.readframes(w.getnframes())
    if width != 2:
        raise ValueError(f"expected 16-bit WAV, got {8 * width}-bit")
    x = np.frombuffer(raw, np.int16).astype(np.float32) / 32768.0
    if ch > 1:
        x = x.reshape(-1, ch).mean(1)
    return x, sr


def _resample(x: np.ndarray, sr: int, target: int) -> np.ndarray:
    if sr == target or len(x) == 0:
        return x
    n = int(round(len(x) * target / sr))
    return np.interp(np.linspace(0, len(x) - 1, n), np.arange(len(x)), x).astype(np.float32)


def _device_index(name: str | None) -> int | None:
    import sounddevice as sd

    if name is None:
        return None  # system default output
    for i, d in enumerate(sd.query_devices()):
        if d["name"] == name and d["max_output_channels"] > 0:
            return i
    raise RuntimeError(f"audio device not found: {name}")


class MacAudioPlayer:
    """Same interface as the Linux AudioPlayer: play(wav, targets) / stop() / available()."""

    BLOCK_S = 0.04
    MAX_PEAK = 0.8

    def __init__(self):
        self._stop = threading.Event()

    @staticmethod
    def available() -> bool:
        try:
            import sounddevice  # noqa: F401
            return True
        except Exception:
            return False

    def play(self, wav: bytes, targets: list[str | None]) -> None:
        global _active
        import sounddevice as sd

        x, sr = _decode(wav)
        peak = float(np.abs(x).max()) if len(x) else 0.0
        if peak > self.MAX_PEAK:  # headroom so meeting apps don't clip synthetic speech
            x = x * (self.MAX_PEAK / peak)
        self._stop.clear()
        errors: list[str] = []

        def run(target: str | None) -> None:
            global _active
            try:
                idx = _device_index(target)
                info = sd.query_devices(idx if idx is not None else sd.default.device[1])
                rate = int(info["default_samplerate"])
                ch = min(2, int(info["max_output_channels"]))
                y = _resample(x, sr, rate)
                y = np.repeat(y[:, None], ch, axis=1)
                block = int(rate * self.BLOCK_S)
                with sd.OutputStream(device=idx, samplerate=rate, channels=ch, dtype="float32") as s:
                    for i in range(0, len(y), block):
                        if self._stop.is_set():
                            break
                        s.write(y[i:i + block])
            except Exception as exc:
                errors.append(f"{target or 'default output'}: {exc}")
            finally:
                with _active_lock:
                    _active -= 1

        threads = []
        for t in targets:
            with _active_lock:
                _active += 1
            th = threading.Thread(target=run, args=(t,), daemon=True)
            th.start()
            threads.append(th)
        for th in threads:
            th.join(timeout=60)
        if errors:
            raise RuntimeError("; ".join(errors)[:300])

    def stop(self) -> None:
        self._stop.set()
