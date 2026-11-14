# SignBridge

**Live ASL recognition, supported vocabulary.** SignBridge is a meeting companion. It watches your webcam or a Google Meet, Zoom or Teams window you pick, recognizes a validated set of **19 isolated American Sign Language signs**, and turns them into English captions and local speech.

> SignBridge is an experimental ASL recognition prototype supporting a limited vocabulary. It is not a substitute for a qualified interpreter, particularly in medical, legal, emergency, or other high-stakes settings.

The recognizer is real, not scripted. A small temporal neural network reads MediaPipe hand and upper-body landmarks. It was trained on genuine ASL from the [ASL Citizen](https://www.microsoft.com/en-us/research/project/asl-citizen/) dataset and evaluated on **11 signers it never saw during training** (see [docs/EVALUATION.md](docs/EVALUATION.md)). It does **not** translate continuous ASL.

## Features (all implemented and tested)

- **Two video sources:** webcam (`getUserMedia`) or a meeting tab, window or screen (`getDisplayMedia`).
- **Real-time pipeline:** browser frames are downscaled to 640 px, JPEG-encoded and streamed over a WebSocket with backpressure (at most one frame in flight, stale frames dropped). The backend runs MediaPipe landmarks, then a 1.6 s temporal window, then the SignGRU classifier, then a stabilizer.
- **Honest output:** a sign is captioned only when it is stable. Duplicates are suppressed, and repeats are allowed after a pause. If no sign is confident, the app shows "No supported sign recognized" and never guesses.
- **Captions and speech:** a large live caption, plus speech through the Web Speech API. Speech has a queue with no overlap, mute, rate and voice controls, a test button and a stop button.
- **History:** one entry per recognized sign, with timestamp, model score and speech status. Transcripts can be downloaded.
- **Landmark overlay,** with live FPS, processing time and round-trip latency.
- **Supported-vocabulary panel:** lists only signs validated on held-out signers, with descriptions and held-out accuracy. Trained-but-disabled signs are listed separately.
- **Resilience:** the app reconnects automatically after a backend restart and resumes the session. It handles a denied camera, cancelled screen sharing, an unplugged camera or "Stop sharing", a missing model, malformed frames and oversized payloads.
- **Clearly labeled Simulated Demo mode:** scripted captions to show the UI and speech when the model isn't available. Every element is marked **SIMULATED DEMO**.
- **Privacy:** frames go only to the backend on `127.0.0.1`. Nothing is recorded, logged or uploaded.
- Settings drawer, dark and light theme, keyboard navigation, and status that never relies on color alone.

## Requirements

| | |
|---|---|
| OS | Ubuntu Linux (developed on 26.04). macOS should work but is untested. |
| Python | **3.10–3.12** for the MediaPipe and PyTorch wheels. `setup.sh` finds one or creates a conda env. |
| Node.js | 20+ (developed on 24) |
| Browser | Recent Chrome or Edge (recommended) or Firefox, at `http://localhost:5173` |
| GPU | Optional. The model is tiny, and CPU inference is fine. CUDA is used automatically if PyTorch sees a GPU. |
| Speech on Linux | Chrome uses `speech-dispatcher`: `sudo apt install speech-dispatcher espeak-ng` |

## Installation

```bash
./scripts/setup.sh
```

This creates `backend/.venv` from the pinned `backend/requirements.lock`, installs the frontend packages, downloads the MediaPipe models and prints an environment report.

### Model

The trained weights are not distributed: they are derived from ASL Citizen, whose license forbids redistributing the data. To build them locally (about 25 minutes; downloads about 800 MB of selected clips by HTTP range requests from Microsoft's server):

```bash
make train      # download → landmarks → fit → evaluate
```

Using ASL Citizen means accepting the [Microsoft Research License Terms](https://www.microsoft.com/en-us/research/project/asl-citizen/dataset-license/): **non-commercial research use only, no redistribution**. Everything stays git-ignored under `backend/data/` and `backend/models/`.

## Running locally

```bash
./scripts/dev.sh
```

Then open **http://localhost:5173**. The backend runs on `http://localhost:8000` (`/health`, `/api/model`, `/api/vocabulary`, `WS /ws/interpret`). Ctrl+C stops both servers. Both bind to `127.0.0.1` only.

## Using webcam mode

1. Choose **Webcam** and click **Start Interpreting**, then allow camera access.
2. Sit so your **head, shoulders and both hands** are in frame, with even lighting.
3. Sign one supported word, such as HELLO, PLEASE or WATER, then **lower your hands briefly**.
4. The caption appears and is spoken once, and a history entry is added. To repeat a word, lower your hands for about a second, then sign it again.
5. Click **Stop** to release the camera.

## Using meeting mode

1. Join your call in another tab or app and **pin or spotlight the signer** so they fill much of the view.
2. In SignBridge choose **Meeting window**, click **Start Interpreting**, and pick that tab or window in the browser dialog.
3. Captions and local speech work as in webcam mode.
4. Only one visible signer is supported. With a gallery view of several people, recognition is unreliable.

## Sending your signs into a call

If **you** are the signer, SignBridge can deliver what it recognizes, or what you type, to the other participants:
- spoken by an offline voice through a **SignBridge Virtual Microphone** that you select in Zoom, Meet or Teams;
- and/or as **Zoom closed captions** through Zoom's third-party caption API token.

Open **Send to meeting**, create the virtual microphone, optionally paste a Zoom caption token, then click **Start sending to call**. It is off by default, a red LIVE badge shows while it's on, and **Ctrl+Shift+M** stops it instantly. Simulated output is never sent. Full setup and safety notes are in [docs/MEETING_OUTPUT.md](docs/MEETING_OUTPUT.md).

## Supported vocabulary

**Enabled (19):** FINISH, FRIEND, HELLO, HELP, LEARN, LOVE, MEET, MORE, NAME, NO, PLEASE, SIGN, SORRY, STOP, UNDERSTAND, WAIT, WATER, WHERE, YES.

**Trained but disabled (5):** AGAIN, BYE, GOOD, NICE, THANKYOU. They failed the validation gate, or for GOOD, failed on test. Everything else is rejected as "no supported sign".

## Model information

| | |
|---|---|
| Architecture | Per-frame features (151-D: two hands' body-relative wrist position, palm-normalized hand shape, and 9 upper-body/face points) → velocity concat → 2-layer bidirectional GRU → mean+max pooling → 25 classes (24 signs + explicit `_UNKNOWN`) |
| Input | 24 time steps resampled **by time** over a 1.6 s window, so it doesn't depend on frame rate |
| Data | ASL Citizen: 863 train/val clips (41 signers) plus about 700 "other sign" clips for the unknown class |
| Held-out test | 566 clips from 11 unseen signers: **81.8 %** central-window top-1 accuracy; in streaming replay through the live code path, **74.4 %** of enabled-sign clips are captioned correctly first, and 9.1 % of unsupported-sign clips trigger a caption |
| Latency | ~35 ms backend processing per frame; ~50 ms median browser↔backend round trip (local) |

Details: [docs/MODEL_DECISION.md](docs/MODEL_DECISION.md) and [docs/EVALUATION.md](docs/EVALUATION.md). Scores in the UI are **uncalibrated model scores**, not certainties.

## Testing

```bash
make test              # backend (pytest, 38 tests) + frontend (vitest, 13 tests)
make test-backend
make test-frontend
make check             # environment report
make demo              # real-inference replay of held-out test-signer clips (backend running)
```

Unit tests use a **mocked** recognizer and a fake landmark extractor to test the software plumbing. Real recognition quality is measured separately by `training/evaluate.py`. Manual browser checks are listed in [docs/DEMO_GUIDE.md](docs/DEMO_GUIDE.md#manual-test-checklist).

## Troubleshooting

| Problem | Fix |
|---|---|
| **Camera permission denied** | Click the camera icon in the address bar → Allow, then Start again. Close other apps using the camera (Zoom/Meet can lock it). |
| **Screen capture cancelled / blank** | Click Start and pick the window again. On Wayland, Chrome may only offer whole screens or tabs; a **tab** works best for Meet. |
| **"Backend disconnected"** | Run `./scripts/dev.sh`. The app reconnects by itself. Check `curl localhost:8000/health`. |
| **Model unavailable** | Run `make train`, or check that `backend/models/signgru.pt` and `signgru_eval.json` exist. Use Simulated Demo meanwhile. |
| **CUDA not used** | Optional. Check `make check`. To force CPU: `SIGNBRIDGE_DEVICE=cpu ./scripts/dev.sh`. |
| **MediaPipe install fails** | You're probably on Python 3.13+. Use 3.12: `SIGNBRIDGE_PYTHON=python3.12 ./scripts/setup.sh` (or let setup create the conda env). |
| **No audio** | Click **Settings → Test speech**. On Linux install `speech-dispatcher espeak-ng` and restart Chrome. Captions still work when muted. |
| **Signs not recognized** | Fill the frame with head, shoulders and hands. Sign at a natural pace, one word at a time, and lower your hands between words. Try lowering the threshold in Settings → Advanced. |
| **Browser compatibility** | Chrome and Edge are fully supported. Firefox works, but `requestVideoFrameCallback` falls back to timers. Safari is untested. The app must be opened on `localhost` (a secure context) for capture to work. |

## Limitations

- **Limited vocabulary:** 19 isolated signs. This is not continuous ASL translation, grammar, fingerspelling or classifiers.
- **No facial grammar:** only a few face points from the pose model are used.
- **Sensitive to conditions:** lighting, framing, camera angle, motion blur and a compressed meeting video all reduce accuracy.
- **Signer variation:** accuracy was measured on 11 held-out ASL Citizen signers. Your signing, regional variants and speed may differ.
- **Local speech only:** meeting participants won't hear it unless your speakers are picked up.
- **One signer at a time,** with no automatic signer selection.

More in [docs/LIMITATIONS.md](docs/LIMITATIONS.md). Architecture: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md). Roadmap: [docs/FUTURE_WORK.md](docs/FUTURE_WORK.md).
