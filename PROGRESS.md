# SignBridge progress log

**Current phase:** 9, meeting output + vocabulary expansion.
- Meeting output is done.
- v2 vocabulary: done and improved. 161 signs trained, 132 enabled, using a 5-seed ensemble at threshold 0.6. Correct first caption on held-out signers rose from 54.6 % to 65.6 %. It is opt-in with `SIGNBRIDGE_MODEL=v2`; v1 (87.4 %) stays the default.

## Phase 10 (2026-11-14): macOS + supported phrases (default)
- macOS (Apple Silicon): `setup.sh` skips Linux CUDA wheels; training on MPS, live inference on CPU (~1.6 ms vs 7.4 ms on MPS per window).
- Meeting voice on macOS: Piper (or `say`) played into BlackHole 2ch via PortAudio; verified by recording BlackHole's input during playback; 80 % peak headroom.
- Default model `SIGNBRIDGE_MODEL=phrases`: 15 ASL Citizen signs (+1.5k other-sign pool) for 5 supported phrases, fine-tuned with supplementary recordings; phrase matcher (`app/recognition/phrases.py`, `phrases.json`). v1/v2/v3 unchanged and selectable.
- Not in ASL Citizen: EXPLAIN, PART, PRESENT, ANYTHING (ANY used as a variant of SOMETHING).
- Sentence replay (spliced held-out clips through the live session): 0 wrong sentences; 1 false sentence in 32 min of other-sign clips; 0 in idle takes.
- Bugs fixed: pose collapse when the signer is too close (now rejected as "no signer"); rest padding assumed clips start at t=0.

## Completed
| Phase | Work |
|---|---|
| 1 Env + model | Ubuntu 26.04, system Python 3.14 (too new for MediaPipe/PyTorch), so a conda Python 3.12 is used for `backend/.venv`. RTX 4050 + CUDA 13.2, with PyTorch 2.15 using the GPU. Model research is in `docs/MODEL_DECISION.md`; ASL Citizen was selected (user approved its license). |
| 2 Capture + transport | getUserMedia / getDisplayMedia, rVFC frame loop, 640 px JPEG, binary WS frames, 1-in-flight backpressure, server latest-frame mailbox |
| 3 Recognition | 1,434 clips downloaded by HTTP range; MediaPipe hand+pose landmarks; body-relative features; BiGRU trained in 3 min; validation-gated vocabulary (19 signs) |
| 4 Captions + audio | Stabilizer (2/3 votes @0.7, hysteresis release, same-sign 1.5 s gap, 0.7 s refractory); captions; speech queue, mute, rate, voice, test, stop; history; transcript download |
| 5 UI | Header/status, video panel with overlay, interpretation panel, settings drawer, vocabulary panel, About with disclaimer, empty and error states, dark/light |
| 6 Testing | 38 backend + 13 frontend automated tests; streaming evaluation on held-out signers; WebSocket replay; browser E2E with real model output |
| 7 Demo | `docs/DEMO_GUIDE.md`, `make demo` (real inference on held-out clips), clearly labeled simulated mode |
| 8 Stabilize | Fixed the issues below; docs written |
| 9b Vocabulary v2 | 6,938 ASL Citizen clips (161 signs + 2,000 other-sign clips); 5 min GPU training; held-out test: 71.2 % central acc (162 classes), 54.6 % streaming correct-first, 2.9 % wrong-first, 4.7 % false activation; `make train-v2`; `SIGNBRIDGE_MODEL` selector |
| 9c v2 accuracy | Diagnosed that missing captions came from the replay harness (tight clips: inference started after the sign) and fixed it with rest padding. Stabilizer sweep showed the vote rule was not the bottleneck. 5-seed ensemble chosen at threshold 0.6 on validation, which beats the single model at 0.7 on every metric there. Server reads the recommended threshold per model, and the UI follows it unless the user changed it. Test results: 65.6 % correct-first (was 54.6 %), 4.2 % wrong, 6.8 % false activation, 132 signs. |
| 9d v3 curated | Live testing showed v2 was finicky. Cause measured: low confidence headroom (correct sign scores ≥0.9 in 36 % of clips vs 69 % for v1), not sensitivity to framing/speed/handedness. Built v3: 51 signs picked on validation only, trained without excluded look-alikes as negatives (two variants compared on validation). Test: 78.7 % correct-first, 1.3 % wrong, 7.5 % false activation, 50 enabled. `SIGNBRIDGE_MODEL=v3`, `make train-v3`. v1 stays default. |
| 9 Meeting output | Piper TTS → PipeWire virtual microphone; Zoom third-party caption API client; off-by-default master switch, LIVE badge, Ctrl+Shift+M stop, `[SignBridge]` prefix; phrase-after-pause send mode; typed messages; `scripts/virtual_mic.sh`; docs/MEETING_OUTPUT.md |

## Bugs found and fixed during verification
- WebSocket handler cancellation leaked sessions and MediaPipe instances on disconnect. Close is now synchronous in `finally`; tests ran green 10× in a row.
- Stale frames could be re-classified after a pause. The buffer is now cleared when the signer leaves the frame, and same-sign repeats need non-overlapping evidence.
- `dev.sh` orphaned the Vite process on Ctrl+C. Vite is now exec'd directly and child processes are killed.
- The vocabulary panel could show "Model unavailable" after a reconnect race. Loading now retries and has a loading state.
- Status overlay was stale while the backend was down. It is cleared and shows "Paused".
- The WebSocket accepted any web origin (CORS doesn't cover WS). An Origin allow-list was added.
- Moving the project folder left `.gitignore` behind, so licensed data and weights would have been committed. It was restored into the repo, and a `git add -n .` dry run is clean.
- Meeting output: items dropped by mute were never marked finished. Fixed, with a test.
- Meeting output: the worker thread wasn't joined on shutdown, which crashed onnxruntime at exit ("terminate called…"). It is now joined.
- `mediapipe` already ships `opencv-contrib-python`; a duplicate `opencv-python-headless` was removed.

## Tests passing
- `make test-backend`: **61 passed** (meeting output, ensemble averaging, label mismatch, replay padding, model selector) (mocked model, clearly separated from real evaluation)
- `make test-frontend`: **22 passed** (meeting output, model-recommended threshold); `npm run build` and `tsc -b` are clean
- `make evaluate` (v1): test signers 81.8 % central accuracy, 87.4 % streaming correct-first (padded replay), 9.8 % false activation
- v2 ensemble: 74.0 % central accuracy over 162 classes, 65.6 % streaming correct-first, 6.8 % false activation

## Features actually working (verified)
- Real ASL inference end to end over WebSocket and in the browser UI (held-out signer clips)
- Duplicate suppression; repeat after a pause; unknown-sign rejection
- Stop releases capture; auto-reconnect plus session resume after a backend restart
- Permission-denied and capture-cancelled states; model-unavailable error; simulated-mode labeling

- Virtual microphone: Piper speech played by the backend service is recorded back out of `signbridge_mic` (non-silent, correct timing). Synthesis takes ~0.2 s.

## Not yet verified (needs a person at the machine)
- v3 live consistency. Offline numbers did not predict how v2 felt live.
- Zoom actually showing our captions (needs a live meeting with a host token) and Zoom hearing the virtual mic.
- Live webcam signing by a human. The agent's browser pane blocks camera access.
- Capturing a real Meet/Zoom/Teams window. The pane blocks getDisplayMedia.
- Audible speech. The pane has no TTS voices. The OS has speech-dispatcher + espeak-ng, so Chrome should work; check with Settings → Test speech.

## Known blockers
None for the code. Model weights are local only (license); a new machine needs `make train`.
