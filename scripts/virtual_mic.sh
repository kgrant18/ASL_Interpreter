#!/usr/bin/env bash
# Create/remove the "SignBridge Virtual Microphone" (PipeWire or PulseAudio).
# The UI can do the same from "Send to meeting". Devices vanish on logout/reboot.
#   ./scripts/virtual_mic.sh up | down | status | test
set -euo pipefail
if [[ "$(uname -s)" == "Darwin" ]]; then
  # macOS: BlackHole (brew install blackhole-2ch) is the virtual microphone.
  cd "$(dirname "$0")/../backend"
  case "${1:-status}" in
    up|down)
      echo "On macOS the virtual microphone is BlackHole (installed once with: brew install blackhole-2ch)."
      echo "In Zoom choose Microphone: BlackHole 2ch." ;;
    status)
      .venv/bin/python -c "from app.meeting import virtual_mic as v; s=v.status(); print('active: '+s['device_name'] if s['active'] else s['error'])" ;;
    test)
      .venv/bin/python -c "
from app.config import settings
from app.meeting import virtual_mic
from app.meeting.audio_mac import MacAudioPlayer
from app.meeting.tts import make_tts
s = virtual_mic.status()
if not s['active']: raise SystemExit(s['error'])
t = make_tts(settings.tts_voice_path, settings.tts_engine)
MacAudioPlayer().play(t.synthesize('This is the SignBridge virtual microphone.'), [s['target']] + ([None] if '${2:-}' == 'monitor' else []))
print('Played a test sentence into', s['target'], '(' + t.engine + ' voice)')" ;;
    *) echo "usage: $0 status|test [monitor]"; exit 2 ;;
  esac
  exit 0
fi
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
