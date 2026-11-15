# Rehearsal checklist

Run through this the evening before and again ~30 minutes before presenting, on the
same Mac, camera, seat and lighting you'll present with.

Zoom setup (host settings, caption token, participant captions, 2-minute test): [ZOOM_SETUP.md](ZOOM_SETUP.md).
The default screen is **Connect to Zoom** (backend camera, works minimized). The steps below about
"Start interpreting" / "Send to meeting" apply to the in-browser fallback at `#/browser`.

## 1. Start the app (2 min)
- [ ] In **Terminal**: `./scripts/dev.sh`, then open **http://localhost:5173** in Chrome. Menu bar shows `○ SignBridge`.
- [ ] Header shows **Backend connected**; the **Supported phrases** panel lists all five phrases.
- [ ] **Settings → Test speech** is audible on your speakers.
- [ ] Close other apps that might grab the camera exclusively (FaceTime, Photo Booth). Zoom and Chrome can share the camera on macOS.

## 2. Lighting and framing (3 min)
- [ ] Light from the front (window or lamp behind the laptop, not behind you). No strong backlight.
- [ ] Plain, uncluttered background; avoid clothing that matches your skin tone or the background.
- [ ] Head, shoulders and both hands in frame with room above your head; elbows visible when your hands are raised. Sit ~1 m from the camera.
- [ ] Start interpreting: the landmark overlay draws both hands and your shoulders, and FPS stays around 13–15.
- [ ] Hands resting in your lap → status shows *No hands detected* / *Watching for signs*, nothing is captioned.

## 3. BlackHole + Zoom (5 min)
- [ ] `./scripts/virtual_mic.sh status` → `active: BlackHole 2ch`.
- [ ] Zoom → **Settings → Audio**:
  - Microphone: **BlackHole 2ch**
  - Untick **Automatically adjust microphone volume**
  - **Suppress background noise: Low**
  - Speaker: your normal output
- [ ] In Zoom's audio settings click **Test Mic**, then run `./scripts/virtual_mic.sh test` in a terminal: Zoom's input meter moves.
- [ ] SignBridge → **Send to meeting**: Voice card says *Ready … "BlackHole 2ch"*, **Speak into the call** is on.
- [ ] Click **Start sending to call** (red LIVE badge). Type "Testing" in the message box → it is heard on a second device in the meeting (phone with sound on, or a teammate).
- [ ] **Ctrl+Shift+M** stops sending (badge disappears). Turn it back on before presenting.
- [ ] Optional: in the meeting the browser speaks locally too; mute **Speech on** in the Interpretation panel if the room hears it twice.

## 4. Sentence check (10 min)
Sign each sentence at a natural pace, keeping your hands up between the signs of one sentence and lowering them at the end. Wait for the caption before the next sentence.

| # | Sign | Expect caption | Try 1 | Try 2 | Try 3 |
|---|---|---|---|---|---|
| 1 | HELLO NICE MEET YOU | Hello, it's nice to meet you. | | | |
| 2 | ME MISS SOMETHING | Did I miss anything? | | | |
| 3 | ME HAVE IDEA | I have an idea. | | | |
| 4 | ME CAN SHOW THIS | I can show this. | | | |
| 5 | THANKYOU | Thank you for listening. | | | |

For every try check:
- [ ] The **English sentence** is the large caption and the recognized signs appear underneath.
- [ ] It is **spoken once** (locally, and in Zoom when sending is on), and **one** history entry is added.
- [ ] Repeating the same sentence within ~6 s does not speak it again.
- [ ] A random gesture, scratching your face or talking with your hands speaks nothing.

If a sentence fails twice in a row:
- Look at the gloss line under the caption / the *Latest sign* card to see which sign is being missed.
- Sign that sign slightly bigger and slower, facing the camera; lower the threshold one step in **Settings → Advanced** if signs show *below threshold*.

## 5. Just before presenting
- [ ] **Settings → Clear session** so history starts empty.
- [ ] Zoom microphone still on **BlackHole 2ch**, SignBridge **Start sending to call** on.
- [ ] Laptop on power, notifications off (Focus mode), other heavy apps closed.
- [ ] Fallback: if the camera or lighting fails, type the sentence into **Send to meeting** to keep the call going.
