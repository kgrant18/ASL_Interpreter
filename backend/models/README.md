# Model artifacts

| File | Source | In git? |
|---|---|---|
| `mediapipe/hand_landmarker.task` | Google MediaPipe (Apache-2.0), downloaded by `scripts/setup.sh` | no (re-downloadable) |
| `mediapipe/pose_landmarker_lite.task` | Google MediaPipe (Apache-2.0), downloaded by `scripts/setup.sh` | no |
| `signgru.pt` | Trained locally by `make train` on ASL Citizen | **no**: derived from data licensed for non-commercial research with no redistribution |
| `signgru_eval.json` | Written by `training/evaluate.py`; decides which signs are enabled | yes (metrics only, no data) |

To rebuild `signgru.pt`: `make train` (≈25 min: ~800 MB download, landmark extraction, 3 min training on GPU or ~15 min on CPU, then evaluation).
