"""SignBridge FastAPI application."""

from __future__ import annotations

import logging
import os
from contextlib import asynccontextmanager

os.environ.setdefault("GLOG_minloglevel", "2")  # quiet MediaPipe/LiteRT logs

from fastapi import FastAPI  # noqa: E402
from fastapi.middleware.cors import CORSMiddleware  # noqa: E402

from .api import meeting, routes, websocket  # noqa: E402
from .config import settings  # noqa: E402
from .meeting.service import MeetingOutput  # noqa: E402
from .meeting.tts import PiperTTS  # noqa: E402
from .recognition.inference import LandmarkTemporalRecognizer  # noqa: E402

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")


@asynccontextmanager
async def lifespan(app: FastAPI):
    rec = getattr(app.state, "recognizer", None)
    if rec is None:
        rec = LandmarkTemporalRecognizer(settings.model_path, settings.eval_path, settings.device)
        rec.load()
        app.state.recognizer = rec
    own_meeting = getattr(app.state, "meeting", None) is None
    if own_meeting:
        app.state.meeting = MeetingOutput(PiperTTS(settings.tts_voice_path))
    yield
    if own_meeting:
        app.state.meeting.close()
        app.state.meeting = None


def create_app(recognizer=None, meeting_output=None) -> FastAPI:
    app = FastAPI(title="SignBridge", version="0.2.0", lifespan=lifespan)
    app.state.recognizer = recognizer
    app.state.meeting = meeting_output
    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origins,
        allow_methods=["GET", "POST"],
        allow_headers=["*"],
    )
    app.include_router(routes.router)
    app.include_router(meeting.router)
    app.include_router(websocket.router)
    return app


app = create_app()


if __name__ == "__main__":
    import uvicorn

    uvicorn.run("app.main:app", host=settings.host, port=settings.port, ws_max_size=2_000_000)
