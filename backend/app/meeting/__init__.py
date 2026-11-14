"""Meeting output: send SignBridge captions to other call participants.

Two independent channels, both off by default and both opt-in from the UI:
  * speech  -> Piper TTS played into a PipeWire/PulseAudio virtual microphone
               ("SignBridge Virtual Microphone") that the user selects in Zoom/Meet/Teams
  * captions -> Zoom's third-party closed-caption API (meeting host shares an API token)
"""
