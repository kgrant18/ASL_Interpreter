# Known limitations

## Recognition
- **Isolated signs only.** Supports 19 signs. Signing a sentence will at best caption the supported words it notices. It is not translation.
- **Not modeled:** grammar, facial expressions (non-manual markers), mouthing, fingerspelling, classifiers, role shift and spatial reference.
- **Variants:** one citation form per English label, as it appears in ASL Citizen. Regional or personal variants may not be recognized.
- **Small training set:** about 15 training clips per sign. Held-out accuracy is reported over 11 unseen signers, but a new signer with a different camera or lighting may see lower performance.
- **Misses are more common than wrong captions:** on held-out signers, about 1 in 4 enabled-sign clips produced no caption. Wrong first captions were rare (5 of 234).
- **False activations:** 9 % of clips of *other* ASL signs triggered a caption. Ordinary gestures (scratching your face, waving) may also occasionally match.
- **Held poses:** a hand held *still* at a sign's location can be read as that sign. For example, resting fingers on the chin can read as WATER. Repeats of the same caption are limited to one per ~1.5 s, but lower your hands between signs.
- **Weakest enabled signs:** SIGN, YES and STOP have the lowest precision on test (58–67 %).
- **Uncalibrated scores:** the scores shown are softmax model scores, not probabilities of being right.

## Capture
- **One signer.** In gallery view, MediaPipe may pick any person or none. Pin or spotlight the signer.
- **Meeting video quality:** compression, low resolution and a small tile reduce accuracy.
- **Browser support:** screen capture depends on the browser and OS. On Linux/Wayland the picker may only offer tabs or screens.
- **Pane testing:** camera and screen capture can't be exercised inside the Claude desktop app's Browser pane. Use a normal browser.

## Audio
- Meeting output (virtual microphone + Zoom captions) is Linux-only (PipeWire/PulseAudio). Zoom's caption API was implemented to its documented format but has not been verified in a live Zoom meeting. See [MEETING_OUTPUT.md](MEETING_OUTPUT.md).
- Recognition mistakes are sent to the call when meeting output is on. Phrase mode shows the pending signs so they can be discarded, but nothing is reviewed automatically.
- Phrase mode joins sign glosses word for word; it is not a grammatical ASL→English translation.
- Voices depend on the browser and OS. Chrome on Linux needs `speech-dispatcher`.

## Engineering
- Single-process backend, intended for one local user. No authentication; it binds to 127.0.0.1.
- The model weights cannot be redistributed (ASL Citizen license), so each machine must run `make train` once (~25 min).
