"""macOS menu-bar indicator for SignBridge (stays visible while Zoom is in front).

    python -m app.statusbar        (scripts/dev.sh starts it automatically on macOS)

Polls the local backend once a second. The title shows the overall state:
    ● SignBridge   live: recognizing and sending to the call
    ⏸ SignBridge   recognizing, but sending is stopped
    ⚠ SignBridge   camera / voice / captions problem
    ○ SignBridge   not started
The menu shows camera, recognition, voice and caption status plus Stop sending / Resume.
"""

from __future__ import annotations

import json
import os
import urllib.error
import urllib.request
import webbrowser

BACKEND = os.environ.get("SIGNBRIDGE_BACKEND", "http://127.0.0.1:8000")
APP_URL = os.environ.get("SIGNBRIDGE_APP_URL", "http://localhost:5173")


def _call(path: str, post: bool = False) -> dict | None:
    req = urllib.request.Request(BACKEND + path, method="POST" if post else "GET",
                                 data=b"{}" if post else None,
                                 headers={"Content-Type": "application/json"} if post else {})
    try:
        with urllib.request.urlopen(req, timeout=2) as r:
            return json.loads(r.read().decode())
    except (urllib.error.URLError, TimeoutError, ValueError, OSError):
        return None


def summarize(st: dict | None) -> tuple[str, list[str]]:
    """(title, menu lines) for a /api/background/status snapshot. Pure, for tests."""
    if not st:
        return "○ SignBridge", ["SignBridge is not running (start ./scripts/dev.sh)"]
    cap, mt = st["capture"], st.get("meeting") or {}
    cam = cap["camera"]
    rec = cap["recognition"]
    cfg = mt.get("config", {})
    mic = mt.get("virtual_mic", {})
    zoom = mt.get("zoom", {})
    sending = bool(cfg.get("enabled"))

    if not cap["running"]:
        cam_line = "Camera: off"
    elif cam["state"] == "on":
        cam_line = f"Camera: on ({round(cam['fps'])} fps)"
    else:
        cam_line = f"Camera: {cam['state']}" + (f" – {cam['error']}" if cam.get("error") else "")
    if not cap["running"] or cam["state"] != "on":
        rec_line = "Recognition: off"
    elif rec["state"] == "no_signer":
        rec_line = "Recognition: no one in view"
    elif not rec.get("shoulders_visible"):
        rec_line = "Recognition: move back (shoulders not in frame)"
    else:
        pend = " ".join(rec.get("pending") or [])
        rec_line = "Recognition: ready" + (f" ({pend})" if pend else "")
    if not mic.get("active"):
        voice_line = "Voice: BlackHole not found"
    else:
        voice_line = (f"Voice: speaking into {mic.get('device_name') or 'BlackHole'}" if sending
                      else "Voice: not sending")
    last_err = zoom.get("last_error")
    failing = bool(last_err) and (zoom.get("last_ok_at") or 0) < (zoom.get("last_error_at") or 0)
    if not zoom.get("connected"):
        cc_line = "Captions: no token"
    elif failing:
        cc_line = "Captions: FAILING – " + last_err[:90]
    elif sending and cfg.get("captions"):
        cc_line = f"Captions: sending ({zoom.get('delivered', 0)} delivered)"
    else:
        cc_line = "Captions: not sending"
    hist = cap.get("history") or []
    last = f"Last: “{hist[0]['english']}”" if hist else "Last: –"

    problem = (cap["running"] and cam["state"] == "error") or failing or not mic.get("active")
    if problem:
        icon = "⚠"
    elif not cap["running"]:
        icon = "○"
    elif sending:
        icon = "●"
    else:
        icon = "⏸"
    return f"{icon} SignBridge", [cam_line, rec_line, voice_line, cc_line, last]


def main() -> None:  # pragma: no cover - needs the macOS UI
    import rumps

    class StatusApp(rumps.App):
        def __init__(self):
            super().__init__("○ SignBridge", quit_button=None)
            self.lines = [rumps.MenuItem(f"line{i}") for i in range(5)]
            self.stop_item = rumps.MenuItem("Stop sending to the call", callback=self.on_mute)
            self.resume_item = rumps.MenuItem("Resume sending", callback=self.on_resume)
            self.start_item = rumps.MenuItem("Start", callback=self.on_start)
            self.menu = [*self.lines, None, self.stop_item, self.resume_item, self.start_item,
                         rumps.MenuItem("Open SignBridge", callback=lambda _: webbrowser.open(APP_URL)),
                         None, rumps.MenuItem("Quit indicator", callback=rumps.quit_application)]
            self.state: dict | None = None
            self.timer = rumps.Timer(self.refresh, 1)
            self.timer.start()

        def refresh(self, _=None):
            self.state = _call("/api/background/status")
            title, lines = summarize(self.state)
            self.title = title
            for item, text in zip(self.lines, lines):
                item.title = text
                item.set_callback(None)
            running = bool(self.state and self.state["capture"]["running"])
            sending = bool(self.state and (self.state.get("meeting") or {}).get("config", {}).get("enabled"))
            self.stop_item.set_callback(self.on_mute if sending else None)
            self.resume_item.set_callback(self.on_resume if running and not sending else None)
            self.start_item.set_callback(self.on_start if self.state and not running else None)

        def on_mute(self, _):
            _call("/api/meeting/mute", post=True)
            self.refresh()

        def on_resume(self, _):
            connected = bool(self.state and self.state["meeting"]["zoom"]["connected"])
            req = urllib.request.Request(
                BACKEND + "/api/meeting/config", method="POST",
                data=json.dumps({"enabled": True, "speech": True, "captions": connected}).encode(),
                headers={"Content-Type": "application/json"})
            try:
                urllib.request.urlopen(req, timeout=2).read()
            except (urllib.error.URLError, OSError):
                pass
            self.refresh()

        def on_start(self, _):
            _call("/api/background/start", post=True)
            self.refresh()

    StatusApp().run()


if __name__ == "__main__":  # pragma: no cover
    main()
