# SignBridge

**Live ASL recognition, supported phrases.** SignBridge is a meeting companion. It watches your webcam or a Google Meet, Zoom or Teams window you pick, recognizes a set of **supported ASL phrases** built from validated signs, and turns them into English captions and speech, locally or into your call.

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
| OS | macOS on Apple Silicon, or Ubuntu Linux (originally developed on 26.04) |
| Python | **3.10–3.12** for the MediaPipe and PyTorch wheels. `setup.sh` finds one (on macOS: `brew install python@3.12`) or creates a conda env. |
| Node.js | 20+ (developed on 24) |
| Browser | Recent Chrome or Edge (recommended) or Firefox, at `http://localhost:5173` |
| GPU | Optional. The model is tiny. Live inference runs on CPU (fastest for one window at a time); training uses CUDA or Apple MPS automatically when available. |
| Speech into a call | macOS: [BlackHole](https://github.com/ExistentialAudio/BlackHole) (`brew install blackhole-2ch`). Linux: PipeWire/PulseAudio. |
| Speech on Linux | Chrome uses `speech-dispatcher`: `sudo apt install speech-dispatcher espeak-ng` |

## Installation

```bash
./scripts/setup.sh
```

This creates `backend/.venv` from the pinned `backend/requirements.lock` (on macOS the Linux-only CUDA wheels are skipped), installs the frontend packages, downloads the MediaPipe models and the Piper voice, checks for the virtual-microphone device and prints an environment report.

### Model

The trained weights are not distributed: they are derived from ASL Citizen, whose license forbids redistributing the data. To build the default model locally (about 30–45 minutes on an M-series Mac; downloads about 1.1 GB of selected clips by HTTP range requests from Microsoft's server):

```bash
make train-phrases   # download → landmarks → fit → evaluate (writes models/signgru_phrases.*)
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
3. Sign one of the supported phrases at a natural pace, then **lower your hands**.
4. The English sentence appears as the caption, with the recognized signs underneath, and is spoken once. A history entry is added. Signs that don't complete a supported phrase are never spoken.
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

Open **Send to meeting**, set up the virtual microphone (macOS: install BlackHole and pick **BlackHole 2ch** as the microphone in Zoom; Linux: click *Create*), optionally paste a Zoom caption token, then click **Start sending to call**. It is off by default, a red LIVE badge shows while it's on, and **Ctrl+Shift+M** stops it instantly. Simulated output is never sent. Full setup and safety notes are in [docs/MEETING_OUTPUT.md](docs/MEETING_OUTPUT.md).

## Supported phrases

| Phrase | Signs (in order) |
|---|---|
| "Hello, it's nice to meet you." | HELLO NICE MEET YOU |
| "Did I miss anything?" | ME MISS SOMETHING (or ANY) |
| "I have an idea." | ME HAVE IDEA |
| "I can show this." | ME CAN SHOW THIS |
| "Thank you for listening." | THANKYOU |

Matching is tolerant: a phrase is recognized when at least half of its signs, including all but one of its content signs, appear in order within 7 seconds. Pointing signs (ME, YOU, THIS) may be missed. A complete phrase is spoken at once; a partial one after a 2.5 s pause. The same phrase is not repeated within 6 s, and signs that don't complete a phrase are never spoken. Phrases are defined in `backend/app/recognition/phrases.json`.

### Other models (opt-in, per-sign captions)

The per-sign models from earlier versions remain available with `SIGNBRIDGE_MODEL`:

```bash
SIGNBRIDGE_MODEL=v1 ./scripts/dev.sh
```

v1: BYE, FINISH, FRIEND, HELLO, HELP, LEARN, LOVE, MEET, MORE, NAME, NO, PLEASE, SIGN, SORRY, STOP, UNDERSTAND, WAIT, WATER, WHERE, YES.

| | v1 | v3 (curated) | v2 (largest) |
|---|---|---|---|
| Enabled signs | 20 | **50** | 132 |
| Correct first caption | **87.4 %** | 78.7 % | 65.6 % |
| Wrong first caption | 2.0 % | **1.3 %** | 4.2 % |
| No caption (needs a repeat) | **10.6 %** | 20.0 % | 30.2 % |
| Caption fired on an unsupported sign | 9.8 % | 7.5 % | **6.8 %** |
| Train with | `make train` | `make train-v3` | `make train-v2` |

All numbers are from the same 11 held-out test signers, replayed through the live pipeline with rest before and after each sign. Details: [v1](docs/EVALUATION.md), [v3](docs/EVALUATION_v3.md), [v2](docs/EVALUATION_v2.md).

- **v1** is the most consistent on its 20 signs.
- **v3** keeps v1's signs (except BYE, which failed its gate) and adds 31 meeting-oriented signs: YOU, KNOW, HAVE, SEE, TELL, SHOW, WORK, MEETING, INTERPRETER, DEAF, HEARING, TEACHER, FAMILY, TIME, LATER, MORNING, HOME, COMPUTER, COFFEE, FREE, BUSY, READY, NICE, OK, NOT, NOTHING, VOICE, WILL, HOW, WHAT, TALK. The signs were picked on validation signers only: 100 % validation recall, high confidence, no strong look-alike. The 31 new signs score 78.9 % on test.
- **v2** covers the most signs but is the least consistent; a 5-model ensemble at threshold 0.6. `make train-v2` downloads ~4 GB and takes ~1.5 h; `make train-v3` reuses that data and takes ~6 min.

On the 19 signs v1 and v3 share, v1 is still better (86.8 % vs 78.2 %). v3's losses are almost all "no caption", concentrated in YES, WHERE, MEET and FRIEND.

Labels with a number, such as `WHAT2` or `DEAF1`, are specific ASL variants of that English word, as numbered in ASL Citizen.

## Model information

| | |
|---|---|
| Architecture | Per-frame features (151-D: two hands' body-relative wrist position, palm-normalized hand shape, and 9 upper-body/face points) → velocity concat → 2-layer bidirectional GRU → mean+max pooling → 25 classes (24 signs + explicit `_UNKNOWN`) |
| Input | 24 time steps resampled **by time** over a 1.6 s window, so it doesn't depend on frame rate |
| Data | ASL Citizen: 863 train/val clips (41 signers) plus about 700 "other sign" clips for the unknown class |
| Held-out test | 566 clips from 11 unseen signers: **81.8 %** central-window top-1 accuracy; in streaming replay through the live code path, **87.4 %** of enabled-sign clips are captioned correctly first (clips padded with rest, as in live use), and 9.8 % of unsupported-sign clips trigger a caption |
| Latency | ~35 ms backend processing per frame; ~50 ms median browser↔backend round trip (local) |

Details: [docs/MODEL_DECISION.md](docs/MODEL_DECISION.md) and [docs/EVALUATION.md](docs/EVALUATION.md). Scores in the UI are **uncalibrated model scores**, not certainties.

## Testing

```bash
make test              # backend (pytest, 115 tests) + frontend (vitest, 28 tests)
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
| **Model unavailable** | Run `make train-phrases`, or check that `backend/models/signgru_phrases.pt` and `signgru_phrases_eval.json` exist. Use Simulated Demo meanwhile. |
| **GPU not used** | Optional; live inference is fastest on CPU. To force a device: `SIGNBRIDGE_DEVICE=cpu|mps|cuda ./scripts/dev.sh`. |
| **Zoom doesn't hear SignBridge (macOS)** | `./scripts/virtual_mic.sh status` should say `active: BlackHole 2ch`. If BlackHole was just installed, restart the Mac. In Zoom pick **BlackHole 2ch** as the microphone, then click **Start sending to call** in SignBridge. `./scripts/virtual_mic.sh test` plays a test sentence into it. |
| **MediaPipe install fails** | You're probably on Python 3.13+. Use 3.12: `SIGNBRIDGE_PYTHON=python3.12 ./scripts/setup.sh` (or let setup create the conda env). |
| **No audio** | Click **Settings → Test speech**. On Linux install `speech-dispatcher espeak-ng` and restart Chrome. Captions still work when muted. |
| **Signs not recognized** | Fill the frame with head, shoulders and hands. Sign at a natural pace, one word at a time, and lower your hands between words. Try lowering the threshold in Settings → Advanced. |
| **Browser compatibility** | Chrome and Edge are fully supported. Firefox works, but `requestVideoFrameCallback` falls back to timers. Safari is untested. The app must be opened on `localhost` (a secure context) for capture to work. |

## Limitations

- **Limited vocabulary:** a small set of supported phrases built from isolated signs. This is not continuous ASL translation, grammar, fingerspelling or classifiers.
- **No facial grammar:** only a few face points from the pose model are used, so question faces (e.g. for "Did I miss anything?") are not read.
- **Sensitive to conditions:** lighting, framing, camera angle, motion blur and a compressed meeting video all reduce accuracy.
- **Signer variation:** accuracy was measured on 11 held-out ASL Citizen signers. Your signing, regional variants and speed may differ.
- **Speech into a call** needs the virtual microphone (BlackHole on macOS, PipeWire on Linux) and the *Send to meeting* switch.
- **One signer at a time,** with no automatic signer selection.

More in [docs/LIMITATIONS.md](docs/LIMITATIONS.md). Architecture: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md). Roadmap: [docs/FUTURE_WORK.md](docs/FUTURE_WORK.md).
