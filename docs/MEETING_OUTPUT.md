# Sending SignBridge output into a call

The signer runs SignBridge on **their own computer** while they are in the call. Recognized signs, and anything the signer types, reach the other participants in two independent ways. Both are opt-in.

| Channel | How it reaches the call | Works with |
|---|---|---|
| **Voice** | Piper TTS (offline) is played into a virtual audio device. The meeting app then uses the **SignBridge Virtual Microphone** as its microphone. | Zoom, Google Meet, Teams, Discord, or anything else that lets you pick a mic |
| **Captions** | Text is POSTed to Zoom's third-party closed-caption API. Participants see it in Zoom's caption area. | Zoom only. The host must allow it. |

```
signs → SignBridge UI ──POST /api/meeting/send──▶ backend MeetingOutput queue
                                                 ├─ Zoom: POST <token>&seq=N&lang=en-US (text/plain)
                                                 └─ Piper TTS → pw-play → null sink "signbridge_speech"
                                                                   └─ monitor → remap source "signbridge_mic"
                                                                               = "SignBridge Virtual Microphone"
```

## Setup (macOS, BlackHole)

```
recognized sentence → POST /api/meeting/send → MeetingOutput queue
                      └─ Piper TTS (or macOS `say`) → PortAudio → "BlackHole 2ch" output
                                                       └─ BlackHole loopback → "BlackHole 2ch" input = Zoom microphone
```

1. Install BlackHole once: `brew install blackhole-2ch` (asks for your password), then **restart the Mac** so Core Audio loads the driver.
2. Check it: `./scripts/virtual_mic.sh status` prints `active: BlackHole 2ch`; `./scripts/virtual_mic.sh test` plays a sentence into it (`test monitor` also plays it on your speakers).
3. In Zoom: **Settings → Audio → Microphone → BlackHole 2ch**.
   - Untick **Automatically adjust microphone volume**, and set **Suppress background noise** to **Low** (synthetic speech can otherwise be gated or clipped).
   - Speaker stays your normal output, so you still hear the other participants.
   - BlackHole carries only SignBridge's voice. Your real microphone is not in the call while BlackHole is selected; switch back in Zoom when you want to talk.
4. In SignBridge open **Send to meeting**: the Voice card says *Ready … “BlackHole 2ch”*. Leave **Speak into the call** on; turn on **Also play on my speakers** if you want to hear exactly what the call hears.
5. Click **Start sending to call** (red LIVE badge). **Ctrl+Shift+M** stops it instantly.

Voices: the default is the offline Piper voice (`en_US-ljspeech-medium`). `SIGNBRIDGE_TTS=say` uses the macOS system voice instead (pick one with `SIGNBRIDGE_SAY_VOICE=Samantha`). Speech is played at up to 80 % of full scale so Zoom does not clip it. A different loopback device can be used with `SIGNBRIDGE_MIC_DEVICE=<name substring>`.

## Setup (Linux, PipeWire or PulseAudio)

1. Run `./scripts/setup.sh`. It downloads the Piper voice (`en_US-ljspeech-medium`, trained on public-domain LJ Speech).
2. In SignBridge open **Send to meeting** and click **Create "SignBridge Virtual Microphone"**. You can also run `./scripts/virtual_mic.sh up`.
   - The device is user-level and temporary. It is gone after logout. Remove it from the UI or with `./scripts/virtual_mic.sh down`.
   - `./scripts/virtual_mic.sh test` plays a sentence into it.
3. Point your meeting app at the device. In Zoom: **Settings → Audio → Microphone → SignBridge Virtual Microphone**.
   - Turn off Zoom's "automatically adjust microphone volume" and set background-noise suppression to **Low**. Otherwise Zoom may clip synthetic speech.
   - In Meet or Teams, pick the same device in their audio settings.
4. **Zoom captions** (optional; the host does this):
   1. Enable *Closed captioning* and *Allow use of caption API token to integrate with 3rd-party closed captioning services* in the Zoom web settings.
   2. In the meeting, open **Captions → Set up manual captioner / Use a third-party CC service → Copy the API token**.
   3. Paste the token into **Send to meeting → Zoom captions → Connect**, then switch on **Post captions**.
   - The token stays in backend memory only and is never written to disk or logged. It expires when the meeting ends.
5. Click **Start sending to call**.

## Safety controls

- **Off by default.** The master switch is off on every app start, and nothing reaches the call until you turn it on.
- **Visible state.** A red **LIVE TO CALL** badge shows in the header and on the panel whenever output is on.
- **Instant stop.** Press **Ctrl+Shift+M** or use the *Stop sending* button. This drops queued items and cuts off the sentence currently playing.
- **Simulated output is never sent.** The UI blocks it, and the backend refuses `simulated: true` with a 400.
- **Caption prefix.** Off by default, so captions read as the signer's own words. `caption_prefix: true` adds `[SignBridge]` in front of captions (never spoken).
- **Delivery log.** "Sent to call" shows each item with its voice and caption status (sent / off / failed, with the reason).
- **Origin check.** State-changing endpoints reject other web origins with a 403. The backend binds to 127.0.0.1.

## Send modes

- **Each sign.** Every recognized sign is spoken or captioned as soon as it is recognized.
- **Supported phrases.** When the model has a phrase set (the default), each matched sentence is sent as soon as it is recognized, in either mode; individual signs are never sent.
- **Phrase after pause** (per-sign models). Signs collect in a pending line that shows the raw signs and the English, for example `WHERE BATHROOM → "Where bathroom?"`. The phrase is sent after a pause, 2 s by default and adjustable in Settings, or when you lower your hands out of frame. You can **Send now** or **Discard**.
  - The phrase is a word-for-word gloss with fixed-up punctuation. It is **not** ASL→English translation: ASL grammar, word order and facial markers are not modeled.
  - Showing the pending line lets the signer catch a misrecognized sign before it is sent.
- **Typed messages.** The text box speaks or captions anything typed. This is the fallback for signs outside the vocabulary.

## API

| Method | Path | Body |
|---|---|---|
| GET | `/api/meeting/status` | none |
| POST | `/api/meeting/config` | `{enabled?, speech?, captions?, caption_prefix?, local_monitor?}` |
| POST | `/api/meeting/mute` | `{}` |
| POST | `/api/meeting/zoom-token` | `{token_url}` (null disconnects) |
| POST | `/api/meeting/virtual-mic` | `{action: "create" \| "remove"}` |
| POST | `/api/meeting/send` | `{text, source: "recognition" \| "typed" \| "test", simulated: false}` |

## Verified vs. not verified

**Verified on this machine:**
- Speech from the backend is recorded back out of `signbridge_mic` (non-silent, correct duration).
- Synthesis takes about 0.2 s per sentence once the voice is loaded.
- Create/remove of the device works.
- Unit and API tests cover the Zoom request format and `seq` handling, mute, and refusals.

**Not verified** (needs a real meeting):
- That Zoom accepts and shows our captions. The format follows Zoom's support article and community examples, but the API's behavior can change, and some accounts disable it.
- How each meeting app's noise suppression treats the synthetic voice.

macOS uses BlackHole (above). Windows would need VB-Cable; not implemented.
