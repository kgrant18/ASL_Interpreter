#!/usr/bin/env bash
# Create/remove the "SignBridge Virtual Microphone" (PipeWire or PulseAudio).
# The UI can do the same from "Send to meeting". Devices vanish on logout/reboot.
#   ./scripts/virtual_mic.sh up | down | status | test
set -euo pipefail
SINK=signbridge_speech
SRC=signbridge_mic
have() { pactl list short "$1" | cut -f2 | grep -qx "$2"; }
case "${1:-status}" in
  up)
    have sinks "$SINK" || pactl load-module module-null-sink sink_name=$SINK sink_properties=device.description=SignBridge_Speech_Output >/dev/null
    have sources "$SRC" || pactl load-module module-remap-source master=$SINK.monitor source_name=$SRC source_properties=device.description=SignBridge_Virtual_Microphone >/dev/null
    echo "Ready. In Zoom/Meet/Teams choose microphone: SignBridge Virtual Microphone" ;;
  down)
    pactl list short modules | grep -E "source_name=$SRC|sink_name=$SINK" | sort -r -k2 | cut -f1 | while read -r m; do pactl unload-module "$m"; done
    echo "Removed." ;;
  status)
    if have sinks "$SINK" && have sources "$SRC"; then echo "active"; else echo "not set up"; fi ;;
  test)
    have sinks "$SINK" || { echo "run '$0 up' first"; exit 1; }
    f="$(mktemp --suffix=.wav)"; trap 'rm -f "$f"' EXIT
    "$(dirname "$0")/../backend/.venv/bin/python" -c "
import sys,wave; from piper import PiperVoice
v=PiperVoice.load('$(dirname "$0")/../backend/models/piper/en_US-ljspeech-medium.onnx')
with wave.open(sys.argv[1],'wb') as w: v.synthesize_wav('This is the SignBridge virtual microphone.', w)" "$f"
    pw-play --target $SINK "$f" && echo "Played a test sentence into the virtual microphone." ;;
  *) echo "usage: $0 up|down|status|test"; exit 2 ;;
esac
