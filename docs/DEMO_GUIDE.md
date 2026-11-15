# Three-minute demo guide

## Before you present (10 min)
1. `./scripts/dev.sh`, then open http://localhost:5173 in **Chrome**. Check that the header says "Backend connected" and the vocabulary shows 19 signs.
2. **Settings → Test speech:** confirm you hear "SignBridge audio is ready."
3. Rehearse 4–5 of the most reliable signs: **PLEASE, SORRY, NO, MORE, WATER, WHERE, FINISH** (≥ 9/12 on held-out signers). Optional: HELLO.
4. Light your face and hands from the front. Use a plain background. Frame yourself from the waist up.
5. For the meeting segment, open a Google Meet in a tab with a second device (or a teammate) signing, and pin that tile.
6. **Fallback:** run `make demo` in a terminal. It streams *held-out test-signer* clips through the same backend and prints real captions. This is real inference on recordings, not a simulation.

## Script

**0:00–0:20 · Problem**
"Video conferencing has made remote communication easier, but accessibility barriers remain. SignBridge explores how computer vision can help bridge communication between ASL users and English-speaking participants."

**0:20–0:40 · Product**
"SignBridge is a meeting companion that watches a selected video source, recognizes supported ASL signs, and converts them into English captions and spoken audio." Point at the "supported vocabulary" subtitle and the vocabulary panel.

**0:40–1:10 · Start a session**
Select Webcam, click **Start Interpreting**, and show the preview with the landmark overlay, FPS and latency pills.

**1:10–1:50 · Live recognition**
Sign PLEASE, lower your hands, sign WATER, lower your hands, then sign WATER again. Show:
- the large caption and the speech;
- exactly one history entry per sign (12+ overlapping windows → one event);
- the repeat producing a *new* entry after the pause;
- a random gesture or an unsupported sign giving "No supported sign recognized", with nothing spoken.

**1:50–2:15 · Into the call**
Beforehand, create the virtual microphone and select **SignBridge Virtual Microphone** as the mic in Zoom on the signer's laptop. Have a second device in the meeting, with its sound on, facing the audience. If you have a caption token, connect it.
- Click **Start sending to call** and point at the red LIVE badge.
- Sign WHERE, then the next sign, and lower your hands. The pending line shows the signs, and the phrase is spoken in Zoom on the second device, with a matching caption.
- Press **Ctrl+Shift+M** to show the instant stop.

**2:15–2:40 · How it works**
- Browser capture → 640 px JPEG over a WebSocket, with at most one frame in flight
- MediaPipe hands + pose → body-relative features → 1.6 s window → bidirectional GRU
- Stabilizer (votes + hysteresis) → caption → speech
- Trained on ASL Citizen; **87 % of signs captioned correctly on 11 signers it never saw** (20-sign model; the 50-sign model gets 79 %)
- "This recognizes isolated signs, which is not the same as full ASL interpretation."

**2:40–3:00 · Future**
Larger vocabulary, continuous recognition, facial grammar, better signer independence, two-way accessibility. Close with: "SignBridge is an early step toward more accessible video communication."

## Plan B (camera/lighting trouble)
- Run `make demo` in a terminal next to the app. It is real model output on held-out ASL recordings.
- If the model is unavailable: Settings → Advanced → Recognition mode → **Simulated demo**. The UI shows **SIMULATED DEMO** badges; say so out loud.

## Manual test checklist
| # | Check | Result (2026-11-14) |
|---|---|---|
| 1 | Clean start with `./scripts/dev.sh`; header says "Backend connected" | ✅ |
| 2 | Vocabulary panel lists 19 validated signs with held-out accuracy | ✅ |
| 3 | Real model captions through the browser (canvas stream of test-signer clips) | ✅ 4/4, one history entry each |
| 4 | Repeat of the same sign after a pause → new event | ✅ (HELLO ×2) |
| 5 | Unsupported sign → no caption | ✅ (WebSocket replay) |
| 6 | Stop releases the media track (`readyState: ended`) | ✅ |
| 7 | Backend killed mid-session → banner, "Reconnecting"; restarted → session resumes and captions continue | ✅ |
| 8 | Camera permission denied → explanatory empty state | ✅ |
| 9 | Screen sharing cancelled → explanatory empty state | ✅ |
| 10 | Ctrl+C on dev.sh stops both servers, no orphans | ✅ |
| 11 | **Webcam with a live human signer** | ⏳ needs a real camera (blocked in the agent's browser) |
| 12 | **Meeting capture of a real Meet/Zoom window** | ⏳ needs a real browser |
| 13 | **Audible speech** | ⏳ the agent's browser has no TTS voices; verify with Settings → Test speech |
