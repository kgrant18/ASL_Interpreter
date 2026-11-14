# SignBridge progress log

**Current phase:** 9, meeting output + vocabulary expansion.
- Meeting output is done.
- v2 vocabulary: 161 signs, landmark extraction running. It is trained to separate weights and swapped in only if it passes held-out evaluation.

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
| 9 Meeting output | Piper TTS → PipeWire virtual microphone; Zoom third-party caption API client; off-by-default master switch, LIVE badge, Ctrl+Shift+M stop, `[SignBridge]` prefix; phrase-after-pause send mode; typed messages; `scripts/virtual_mic.sh`; docs/MEETING_OUTPUT.md |

## Bugs found and fixed during verification
- WebSocket handler cancellation leaked sessions and MediaPipe instances on disconnect. Close is now synchronous in `finally`; tests ran green 10× in a row.
- Stale frames could be re-classified after a pause. The buffer is now cleared when the signer leaves the frame, and same-sign repeats need non-overlapping evidence.
- `dev.sh` orphaned the Vite process on Ctrl+C. Vite is now exec'd directly and child processes are killed.
- The vocabulary panel could show "Model unavailable" after a reconnect race. Loading now retries and has a loading state.
- Status overlay was stale while the backend was down. It is cleared and shows "Paused".
- The WebSocket accepted any web origin (CORS doesn't cover WS). An Origin allow-list was added.
- Meeting output: items dropped by mute were never marked finished. Fixed, with a test.
- Meeting output: the worker thread wasn't joined on shutdown, which crashed onnxruntime at exit ("terminate called…"). It is now joined.
- `mediapipe` already ships `opencv-contrib-python`; a duplicate `opencv-python-headless` was removed.

## Tests passing
- `make test-backend`: **52 passed** (14 new for meeting output: Zoom format/seq/retry, mute, refusals, origin) (mocked model, clearly separated from real evaluation)
- `make test-frontend`: **20 passed** (7 new: off by default, per-sign, phrase, simulated never sent, mute shortcut, typed); `npm run build` and `tsc -b` are clean
- `make evaluate`: test signers 81.8 % central accuracy, 74.4 % streaming correct-first, 9.1 % false activation on unsupported signs

## Features actually working (verified)
- Real ASL inference end to end over WebSocket and in the browser UI (held-out signer clips)
- Duplicate suppression; repeat after a pause; unknown-sign rejection
- Stop releases capture; auto-reconnect plus session resume after a backend restart
- Permission-denied and capture-cancelled states; model-unavailable error; simulated-mode labeling

- Virtual microphone: Piper speech played by the backend service is recorded back out of `signbridge_mic` (non-silent, correct timing). Synthesis takes ~0.2 s.

## Not yet verified (needs a person at the machine)
- Zoom actually showing our captions (needs a live meeting with a host token) and Zoom hearing the virtual mic.
- Live webcam signing by a human. The agent's browser pane blocks camera access.
- Capturing a real Meet/Zoom/Teams window. The pane blocks getDisplayMedia.
- Audible speech. The pane has no TTS voices. The OS has speech-dispatcher + espeak-ng, so Chrome should work; check with Settings → Test speech.

## Known blockers
None for the code. Model weights are local only (license); a new machine needs `make train`.
