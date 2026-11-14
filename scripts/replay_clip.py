#!/usr/bin/env python3
"""Stream a local video file to a running SignBridge backend, exactly like the browser.

Frames are resized to <=640px, JPEG-encoded, framed with the same binary header, sent
one at a time (waiting for each ack), and real model results are printed. Use it to
validate the live pipeline end-to-end on genuine ASL recordings (e.g. ASL Citizen
test-signer clips that stay on this machine).

    backend/.venv/bin/python scripts/replay_clip.py path/to/clip.mp4 [more.mp4 ...]
"""

from __future__ import annotations

import argparse
import asyncio
import json
import struct
import sys
import time
import uuid

import cv2
import websockets


async def replay(url: str, paths: list[str], fps: float, rest_s: float) -> int:
    async with websockets.connect(url, max_size=2**22) as ws:
        sid = str(uuid.uuid4())
        await ws.send(json.dumps({"type": "session.start", "session_id": sid,
                                  "source": "webcam", "mode": "live", "target_fps": fps}))
        started = json.loads(await ws.recv())
        if started["type"] != "session.started":
            print("failed to start:", started)
            return 1
        seq, t_ms, emitted = 0, 1000.0, []
        lat = []
        for path in paths:
            cap = cv2.VideoCapture(path, cv2.CAP_FFMPEG)
            src_fps = cap.get(cv2.CAP_PROP_FPS) or 30
            step = max(1, round(src_fps / fps))
            frames, i = [], 0
            while True:
                ok, bgr = cap.read()
                if not ok:
                    break
                if i % step == 0:
                    frames.append(bgr)
                i += 1
            cap.release()
            if not frames:
                print(f"{path}: could not read video, skipped")
                continue
            # pause between clips: neutral frames with nobody in view
            # (repeating a real frame would show a frozen hand, which is not a pause)
            rest = frames[0].copy()
            rest[:] = 128
            frames = frames + [rest] * int(rest_s * fps)
            got = []
            for bgr in frames:
                seq += 1
                t_ms += 1000 / fps
                ok, jpg = cv2.imencode(".jpg", bgr, [cv2.IMWRITE_JPEG_QUALITY, 72])
                sent = time.perf_counter()
                await ws.send(struct.pack("<Id", seq, t_ms) + jpg.tobytes())
                while True:
                    msg = json.loads(await ws.recv())
                    if msg["type"] == "recognition.result":
                        got.append((msg["prediction"]["label"], msg["prediction"]["score"]))
                    if msg["type"] == "processing.status" and msg["sequence"] == seq:
                        lat.append((time.perf_counter() - sent) * 1000)
                        break
            name = path.rsplit("/", 1)[-1]
            print(f"{name:50s} -> {got if got else 'no supported sign recognized'}")
            emitted.append(got)
        await ws.send(json.dumps({"type": "session.stop", "session_id": sid}))
        lat.sort()
        print(f"frames={seq} median round-trip={lat[len(lat)//2]:.1f} ms "
              f"p95={lat[int(len(lat)*0.95)]:.1f} ms")
    return 0


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("paths", nargs="+")
    ap.add_argument("--url", default="ws://127.0.0.1:8000/ws/interpret")
    ap.add_argument("--fps", type=float, default=15)
    ap.add_argument("--rest", type=float, default=1.0, help="seconds of rest after each clip")
    a = ap.parse_args()
    return asyncio.run(replay(a.url, a.paths, a.fps, a.rest))


if __name__ == "__main__":
    sys.exit(main())
