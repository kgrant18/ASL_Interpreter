# Future work

**Near term**
- **More vocabulary:** the pipeline scales by adding glosses to `TARGET_GLOSSES` and running `make train`. ASL Citizen has 2,731 signs. Use the full train split (not a 24-sign subset) with a larger unknown pool.
- **Personal calibration:** record 5–10 examples per sign in-app and fine-tune the last layer for the current user, kept local.
- **Better negatives:** add everyday non-sign motion (talking with your hands, adjusting glasses) to the unknown class to reduce false activations.
- **Calibrated confidence:** temperature scaling on validation signers, so scores can be read as probabilities.
- **Hand-raise segmentation:** detect sign onset and offset to adapt the window length per sign.

**Medium term**
- **Continuous recognition:** a CTC or transformer model over sliding windows (e.g. trained on How2Sign or OpenASL), plus a separate English generation layer that is clearly marked as interpretation.
- **Facial grammar:** add FaceLandmarker blendshapes (eyebrows for questions, head shake for negation).
- **Fingerspelling** with a dedicated model (Google's ASL Fingerspelling data).
- **Signer selection:** multi-person pose tracking with a click-to-select signer in meeting mode.

**Product**
- Virtual microphone + Zoom captions are done (docs/MEETING_OUTPUT.md). Next: Windows/macOS virtual devices (VB-Cable / BlackHole), a Meet/Teams caption path, and an LLM-free grammar layer for phrase mode trained on ASL gloss→English pairs.
- Two-way mode: speech-to-text captions for the signer.
- Packaging as a desktop app or browser extension.
- Accessibility review and co-design with Deaf users and interpreters.
