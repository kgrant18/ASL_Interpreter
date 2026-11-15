"""REST API for the "Connect to Zoom" screen: background capture + meeting output together."""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Request, Response

from ..capture.background import BackgroundRecognizer
from ..meeting.zoom_cc import CaptionError
from .meeting import _svc, same_origin_only

router = APIRouter(prefix="/api/background")


def _bg(request: Request) -> BackgroundRecognizer:
    bg = getattr(request.app.state, "background", None)
    if bg is None:
        raise HTTPException(503, "background capture unavailable")
    return bg


def make_on_phrase(app):
    """Recognized sentence -> meeting output (voice + captions), when sending is on."""

    def on_phrase(english: str, glosses: list[str]) -> bool:
        svc = getattr(app.state, "meeting", None)
        if svc is None or not svc.config.enabled:
            return False
        try:
            svc.send(english, "recognition")
            return True
        except (PermissionError, OverflowError, ValueError):
            return False

    return on_phrase


def _status(request: Request) -> dict:
    out = {"capture": _bg(request).status()}
    svc = getattr(request.app.state, "meeting", None)
    out["meeting"] = svc.status() if svc is not None else None
    return out


@router.get("/status")
def status(request: Request) -> dict:
    return _status(request)


@router.post("/start", dependencies=[Depends(same_origin_only)])
def start(request: Request) -> dict:
    bg, svc = _bg(request), _svc(request)
    try:
        bg.start()
    except RuntimeError as exc:
        raise HTTPException(503, str(exc)) from exc
    svc.update(enabled=True, speech=True, captions=svc.zoom is not None)
    return _status(request)


@router.post("/stop", dependencies=[Depends(same_origin_only)])
def stop(request: Request) -> dict:
    _svc(request).mute()
    _bg(request).stop()
    return _status(request)


@router.post("/test-caption", dependencies=[Depends(same_origin_only)])
def test_caption(request: Request) -> dict:
    svc = _svc(request)
    try:
        svc.test_caption()
    except LookupError as exc:
        raise HTTPException(400, str(exc)) from exc
    except CaptionError as exc:
        raise HTTPException(502, str(exc)) from exc
    return _status(request)


@router.get("/preview.jpg")
def preview(request: Request) -> Response:
    # Camera frames are only for the SignBridge page itself, never for other websites.
    if request.headers.get("sec-fetch-site") == "cross-site":
        raise HTTPException(403, "not allowed")
    jpg = _bg(request).preview_jpeg()
    if jpg is None:
        raise HTTPException(404, "camera is off")
    return Response(jpg, media_type="image/jpeg", headers={"Cache-Control": "no-store"})


@router.get("/landmarks")
def landmarks(request: Request) -> dict:
    """Latest landmarks for the framing overlay (read-only; same privacy rule as the preview)."""
    if request.headers.get("sec-fetch-site") == "cross-site":
        raise HTTPException(403, "not allowed")
    return {"landmarks": _bg(request).landmarks()}
