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

- v2 (161 signs, 132 enabled) has about 15 training clips per sign. On held-out signers its first caption is correct for 65.6 % of enabled-sign clips. Most misses are silence (30 %) rather than a wrong sign (4 %). Validation signers score higher (83 %), so v2 still has a signer-generalization gap that more data would close.
- v3 (51 curated signs, 50 enabled) sits between v1 and v2: 78.7 % correct first caption on held-out signers. It is weaker than v1 on some shared signs (YES 5/10, WHERE 8/13, MEET 6/10 on test, against 9/10, 12/13 and 9/10 for v1). More signs mean less confidence per sign, and v1's level was not recovered.
- v3 was trained without the excluded v2 look-alike signs as negatives. That raised confidence on HELLO, LEARN and MEET, but it means signs v3 doesn't know trigger a false caption more often than with the stricter variant (11 % vs 6 % on validation; 7.5 % on the test "other signs" pool).
- A more confident model is not proven to be more consistent live. The offline benchmark did not predict v2's live finickiness, so v3 needs a live check too.
- v2's enabled set was chosen on only 3–4 validation clips per sign, so some enabled signs will be weak and some disabled ones would actually work.
- The streaming metrics pad each test clip with 1.5 s of rest before the sign and 1 s after, built from the signer's own pose. This mimics a signer who is already on camera. Before this change the replay began predicting only once the sign was nearly over. The v1 numbers were re-measured with the same padding.

## Supported phrases
- Phrases are matched from recognized signs; a sentence is spoken only when enough of its signs appear in order, so a missed content sign means no sentence (never a partial one).
- The matcher cannot tell a statement from a question: facial grammar is not modeled.
- Several phrases share ME; it is treated as optional, so a phrase needs its content signs.

## Capture
- **One signer.** In gallery view, MediaPipe may pick any person or none. Pin or spotlight the signer.
- **Meeting video quality:** compression, low resolution and a small tile reduce accuracy.
- **Browser support:** screen capture depends on the browser and OS. On Linux/Wayland the picker may only offer tabs or screens.
- **Pane testing:** camera and screen capture can't be exercised inside the Claude desktop app's Browser pane. Use a normal browser.

## Audio
- Meeting output (virtual microphone + Zoom captions) works on Linux (PipeWire/PulseAudio) and macOS (BlackHole). Zoom's caption API was implemented to its documented format but has not been verified in a live Zoom meeting. See [MEETING_OUTPUT.md](MEETING_OUTPUT.md).
- Recognition mistakes are sent to the call when meeting output is on. Phrase mode shows the pending signs so they can be discarded, but nothing is reviewed automatically.
- Phrase mode joins sign glosses word for word; it is not a grammatical ASL→English translation.
- Voices depend on the browser and OS. Chrome on Linux needs `speech-dispatcher`.

## Engineering
- Single-process backend, intended for one local user. No authentication; it binds to 127.0.0.1.
- The model weights cannot be redistributed (ASL Citizen license), so each machine must run `make train` once (~25 min).
