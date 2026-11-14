# Architecture

```
Browser (React + Vite)                                   Backend (FastAPI, 127.0.0.1:8000)
───────────────────────                                  ─────────────────────────────────
getUserMedia / getDisplayMedia                           WS /ws/interpret  (one Connection per socket)
  → <video> preview (+ landmark overlay canvas)            reader: text → control msgs (pydantic-validated)
  → FrameTransport                                                  binary → 1-slot "latest frame" mailbox
      requestVideoFrameCallback (setTimeout fallback)      processor task (one frame at a time, in a thread):
      throttle to target FPS (15)                            decode JPEG (cv2) → LandmarkExtractor (MediaPipe
      downscale ≤640px, JPEG q=0.72                            hands + pose, VIDEO mode, per session)
      ≤1 frame in flight (wait for ack, 1.5 s timeout)       → TemporalBuffer (1.8 s, ≤90 frames)
      binary: u32 seq | f64 capture_ms | JPEG               → every 120 ms: window_tensor (body-relative,
  ← JSON events (filtered by session_id)                       24 steps by time) → SignGRU → probabilities
      processing.status   (ack + landmarks + perf)           → enabled-sign filter (non-validated mass → unknown)
      recognition.partial / .unknown / .result               → PredictionStabilizer (votes, hysteresis,
  → caption, history, speech queue (speechSynthesis)            same-sign gap, refractory)
                                                           ← JSON events
                                                         GET /health, /api/model, /api/vocabulary

  → useMeetingOutput (off by default; never simulated)   /api/meeting/*  → MeetingOutput (worker thread, queue ≤8)
      per-sign, or phrase-after-pause (composePhrase)        ├ Zoom CC client: POST token&seq=N&lang (text/plain)
      typed messages, Ctrl+Shift+M mute                      └ Piper TTS → pw-play → null sink → remap source
                                                               ("SignBridge Virtual Microphone", via pactl)
```

## Key design decisions

- **One feature pipeline.** `app/vision/landmarks.py` and `normalization.py` are imported by both the training scripts and the server. The offline evaluation replays landmarks through the live `LiveInterpretationSession.process_landmarks`, so the reported metrics come from the deployed code path.
- **Backpressure on both ends.** The browser sends the next frame only after the previous one is acknowledged (`processing.status`). The server keeps only the newest unprocessed frame, and replaced frames are counted as `dropped_frames`. Queues are bounded, so memory doesn't grow over a long session.
- **Session isolation.** Each `session.start` creates a fresh session object: its own MediaPipe instances, buffer, stabilizer, sequence counter and timing. The client generates a UUID `session_id`, and both sides drop messages from other sessions. Frame sequence numbers must increase.
- **Live vs simulated are separate classes.** `SimulatedInterpretationSession` never calls the model, and every message it sends has `simulated: true`.
- **Recognition vs language are separate.** Class labels map to fixed English glosses in `recognition/vocabulary.py`. No LLM sentence generation.
- **Cleanup.** Stopping, replacing a session or disconnecting closes the MediaPipe tasks synchronously, and is safe even mid-frame because the extractor has its own lock. The browser stops all `MediaStreamTrack`s on Stop, on unmount, and when the browser ends capture.
- **Errors.** Every error message is a structured `{type:"error", code, message, recoverable}` with no tracebacks. Malformed or oversized frames get an error and processing continues. The WebSocket enforces an Origin allow-list, because CORS doesn't cover WebSockets.

## Protocol

See `backend/app/schemas/messages.py` (pydantic) and `frontend/src/types/interpretation.ts`.

| Direction | Message |
|---|---|
| C→S | `session.start` {session_id, source, mode: live\|simulated, target_fps, enable_landmarks, enable_tts, threshold} |
| C→S | `session.stop`, `config.update` {threshold?, enable_landmarks?}, `ping` |
| C→S | binary frame: `<I d` header (seq, capture ms) + JPEG |
| S→C | `session.started`, `session.stopped`, `processing.status` (per frame), `recognition.partial`, `recognition.unknown`, `recognition.result` (stable event, once per sign), `error` |

## Repository layout

```
backend/app/{main,config}.py      FastAPI app, settings (SIGNBRIDGE_* env vars)
backend/app/api/                  HTTP routes, WebSocket endpoint
backend/app/vision/               landmarks, normalization, temporal buffer, (de)serialization
backend/app/recognition/          model, inference wrapper, stabilizer, vocabulary
backend/app/services/             per-session interpretation pipelines (live / simulated)
backend/training/                 download_clips → prepare_data → train → evaluate
frontend/src/hooks/               useVideoCapture, useWebSocket, useSpeechSynthesis, useInterpretation
frontend/src/services/            REST client, frame transport
frontend/src/components/          UI
scripts/                          setup.sh, dev.sh, check_environment.py, run_demo.sh, replay_clip.py
```
