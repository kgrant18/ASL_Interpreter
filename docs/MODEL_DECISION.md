# Model decision

## Summary

**Selected:** a landmark-based temporal classifier (SignGRU) trained locally on a **24-sign subset of ASL Citizen**, using the dataset's official **signer-independent** splits. The fallback architecture from the brief (§6) was used because no off-the-shelf pretrained ASL word model met the requirements.

## Candidates considered (≈45 min of research)

| Candidate | Weights? | ASL? | License | Verdict |
|---|---|---|---|---|
| **Google ISLR "asl-signs" (Kaggle, 250 signs, MediaPipe landmarks)** | Competition solutions exist; data needs a Kaggle login and rule acceptance | Yes | CC-BY 4.0 data; solutions vary | Blocked: needs credentials. No HF mirror found. |
| **WLASL** (2,000 glosses) | Some I3D/Pose-TGCN checkpoints | Yes | C-UDA (research) | Many source YouTube URLs are dead. Its RGB/pose models use a preprocessing that doesn't match webcam MediaPipe. Too risky in 24 h. |
| **MS-ASL** | No official weights | Yes | Research only | Videos must be scraped from YouTube. |
| **How2Sign** | No word-level classifier | Continuous ASL | Research | Wrong task (sentence-level) and far too large. |
| **ASL Citizen** (83k videos, 2,731 signs, 52 signers) | Baseline code, no convenient weights | **Yes, isolated signs from webcam recordings** | Microsoft Research License (non-commercial research, no redistribution) | **Selected for data.** The official zip supports HTTP byte ranges, so individual clips can be downloaded. |
| HF `SorensenAI/asl-citizen-poses` | Derived pose files | Yes | Unstated (derived from ASL Citizen) | No splits/signer IDs, so it can't support signer-independent evaluation. Not used. |
| HF `danielelvs/multilingual-islr-mediapipe` | Landmarks | **No** (Libras, ISL, KSL) | MIT | Not ASL, so rejected. |
| HF ASL alphabet image sets | n/a | Fingerspelling only | Various | Not conversational signs, so rejected. |

No pretrained candidate could be loaded and verified on webcam-style input within the time limit. So the plan became: genuine labeled ASL data, the same MediaPipe pipeline offline and live, and a small classifier.

## Why ASL Citizen fits

- **Real ASL from 52 Deaf/hard-of-hearing and fluent signers**, recorded on **consumer webcams** at 640×480/30 fps, which matches SignBridge's input exactly.
- **Official signer-independent splits** (train 35 signers, val 6, test 11), so held-out numbers mean "new person".
- Selective download: `training/download_clips.py` uses `remotezip` to fetch just 1,434 of the 83,399 clips (~800 MB of the 46 GB archive).
- **License:** Microsoft Research License Terms. Non-commercial research use; the data or modifications must not be redistributed. The user approved its use for this hackathon. Data and weights are git-ignored and stay local.

## Approach

1. **Landmarks:** MediaPipe Tasks `HandLandmarker` (2 hands) + `PoseLandmarker` lite, in VIDEO mode, on frames resized to ≤640 px at ~15 FPS. The same `LandmarkExtractor` class runs offline and live. Hands are assigned to the signer's left/right by distance to the pose wrists.
2. **Normalization** (`app/vision/normalization.py`):
   - The origin is the window-median shoulder midpoint, and the unit is the median shoulder width.
   - Hand shape is relative to the wrist and scaled by palm size.
   - Missing parts are zeros plus an explicit presence flag.
   - Windows are resampled by **time** onto 24 steps.
3. **Classifier** (`app/recognition/model.py`): features + velocities → Linear(192) → 2-layer BiGRU(128) → mean+max pooling → 25 logits (24 signs + `_UNKNOWN`).
4. **Training** (`training/train.py`): class-balanced batches; window lengths 1.1–2.1 s; mirror augmentation, so left- and right-dominant signers are both covered; rotation/scale/shift; and dropped detections. The `_UNKNOWN` class contains about 700 clips of *other* ASL signs plus partial windows. Checkpoints are selected on validation balanced accuracy. Training takes 3 minutes on an RTX 4050.
5. **Vocabulary gate** (`training/evaluate.py`): a sign is enabled only if, on **validation signers** in streaming replay, recall ≥ 0.5 and precision ≥ 0.6. GOOD passed that gate (on 3–4 clips) but went 1/12 on test, so it was manually disabled. This only removes a claim.
6. **Stabilizer** parameters (2-of-3 votes, threshold 0.7, 120 ms inference interval) were tuned on **validation signers only**.

## Evidence that inference works

- Held-out **test** signers (566 clips, 11 people): **81.8 %** central-window top-1 accuracy over 25 classes.
- **Streaming replay** feeds cached landmarks frame-by-frame through the live `LiveInterpretationSession` code. Each clip is padded with 1.5 s of rest before the sign and 1 s after, so the replay starts the way a live session does. **87.4 %** of the 246 enabled-sign clips are captioned correctly first. Wrong first captions are rare (2.0 %); most failures are "no caption". 9.8 % of 276 unsupported-sign clips triggered some caption. The earlier unpadded replay gave 74.4 %; it undercounted because inference began only after the sign was nearly over.
- **v2** (161 signs, 132 enabled, 5-seed ensemble, threshold 0.6): 65.6 % correct-first, 4.2 % wrong-first, 6.8 % false activation on the same test signers. See EVALUATION_v2.md.
- **Live WebSocket replay** (`scripts/replay_clip.py`) sent JPEG frames of test-signer clips to the running server. Every enabled-sign clip tried (23 trials covering 15 different signs) was captioned with the right sign. A repeated sign produced two events after a pause, and unsupported signs were rejected.
- **Browser end-to-end:** a canvas stream playing test clips went through the real UI. HELLO, PLEASE, WATER and HELLO each produced exactly one caption and history entry.

The full per-sign table is in [EVALUATION.md](EVALUATION.md), regenerated by `make evaluate`.

## Limitations of this choice

- About 15 training clips per sign. Accuracy on new signers, cameras and lighting will vary.
- Isolated citation-form signs only. Signs embedded in continuous signing look different (coarticulation).
- Face and mouth morphemes are not modeled beyond 5 pose face points.
- Softmax scores are not calibrated.
