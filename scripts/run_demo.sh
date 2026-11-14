#!/usr/bin/env bash
# Real-inference demo without a camera: streams genuine ASL Citizen *test-signer*
# clips (never seen in training) through the running backend, exactly as the
# browser would, and prints the model's actual captions.
#
# Requires: ./scripts/dev.sh (or the backend) running, and clips downloaded via
# `make train` (they stay local; the dataset license forbids redistribution).
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT/backend"

curl -sf http://127.0.0.1:8000/health >/dev/null || { echo "Backend not running — start ./scripts/dev.sh first."; exit 1; }
[[ -f data/asl_citizen/manifest.csv ]] || { echo "ASL Citizen clips not downloaded — run 'make train' first."; exit 1; }

SIGNS="${*:-HELLO PLEASE HELP HELP WATER SORRY WHERE YES NO _UNKNOWN}"
.venv/bin/python - "$SIGNS" <<'EOF' | tr '\n' '\0' | xargs -0 .venv/bin/python ../scripts/replay_clip.py --rest 1.0
import sys, pandas as pd
m = pd.read_csv("data/asl_citizen/manifest.csv")
t = m[m.split == "test"]
p = t.participant.value_counts().index[0]
s = t[t.participant == p]
for g in sys.argv[1].split():
    rows = s[s.label == g]
    if len(rows):
        print("data/asl_citizen/videos/" + rows.video.iloc[0])
EOF
