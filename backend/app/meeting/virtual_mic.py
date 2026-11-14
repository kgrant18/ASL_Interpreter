"""PipeWire/PulseAudio virtual microphone managed through `pactl`.

    null sink  "signbridge_speech"  (TTS is played here; nothing reaches the speakers)
      -> monitor -> remap source "signbridge_mic"  (appears as a microphone in apps)

Modules are user-level and not persistent: they disappear on logout/reboot or when
removed from the UI / `scripts/virtual_mic.sh down`.
"""

from __future__ import annotations

import logging
import shutil
import subprocess

logger = logging.getLogger(__name__)

SINK = "signbridge_speech"
SOURCE = "signbridge_mic"
SINK_DESC = "SignBridge_Speech_Output"
SOURCE_DESC = "SignBridge_Virtual_Microphone"


class VirtualMicError(RuntimeError):
    pass


def _pactl(*args: str, timeout: float = 5.0) -> str:
    if shutil.which("pactl") is None:
        raise VirtualMicError("pactl not found (PipeWire/PulseAudio tools are required)")
    try:
        out = subprocess.run(["pactl", *args], capture_output=True, text=True,
                             timeout=timeout, check=True)
    except subprocess.CalledProcessError as exc:
        raise VirtualMicError(f"pactl {' '.join(args)} failed: {exc.stderr.strip()}") from exc
    except subprocess.TimeoutExpired as exc:
        raise VirtualMicError("pactl timed out") from exc
    return out.stdout


def _names(kind: str) -> set[str]:
    return {line.split("\t")[1] for line in _pactl("list", "short", kind).splitlines()
            if "\t" in line}


def status() -> dict:
    try:
        sinks, sources = _names("sinks"), _names("sources")
    except VirtualMicError as exc:
        return {"available": False, "active": False, "error": str(exc)}
    active = SINK in sinks and SOURCE in sources
    return {"available": True, "active": active, "sink": SINK, "source": SOURCE,
            "device_name": SOURCE_DESC.replace("_", " "), "error": None}


def _modules() -> list[tuple[str, str]]:
    out = []
    for line in _pactl("list", "short", "modules").splitlines():
        parts = line.split("\t")
        if len(parts) >= 3 and (f"sink_name={SINK}" in parts[2] or f"source_name={SOURCE}" in parts[2]):
            out.append((parts[0], parts[1]))
    return out


def create() -> dict:
    s = status()
    if not s["available"]:
        raise VirtualMicError(s["error"])
    if SINK not in _names("sinks"):
        _pactl("load-module", "module-null-sink", f"sink_name={SINK}",
               f"sink_properties=device.description={SINK_DESC}")
    if SOURCE not in _names("sources"):
        _pactl("load-module", "module-remap-source", f"master={SINK}.monitor",
               f"source_name={SOURCE}", f"source_properties=device.description={SOURCE_DESC}")
    logger.info("virtual microphone ready (%s)", SOURCE)
    return status()


def remove() -> dict:
    # remap source first (it depends on the sink monitor)
    mods = sorted(_modules(), key=lambda m: m[1] != "module-remap-source")
    for idx, _ in mods:
        _pactl("unload-module", idx)
    logger.info("virtual microphone removed")
    return status()
