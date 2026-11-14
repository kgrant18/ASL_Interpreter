"""REST API for meeting output (virtual microphone + Zoom captions)."""

from __future__ import annotations

from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, Field

from ..config import settings
from ..meeting import virtual_mic
from ..meeting.zoom_cc import ZoomTokenError

router = APIRouter(prefix="/api/meeting")


def same_origin_only(request: Request) -> None:
    """State-changing calls must come from the SignBridge UI (or a local, non-browser tool)."""
    origin = request.headers.get("origin")
    if origin is not None and origin not in settings.cors_origins:
        raise HTTPException(403, "origin not allowed")


def _svc(request: Request):
    svc = getattr(request.app.state, "meeting", None)
    if svc is None:
        raise HTTPException(503, "meeting output unavailable")
    return svc


class ConfigUpdate(BaseModel):
    enabled: bool | None = None
    speech: bool | None = None
    captions: bool | None = None
    caption_prefix: bool | None = None
    local_monitor: bool | None = None


class ZoomToken(BaseModel):
    token_url: str | None = Field(default=None, max_length=2048)


class SendRequest(BaseModel):
    text: str = Field(min_length=1, max_length=300)
    source: Literal["recognition", "typed", "test"]
    simulated: bool = False


class MicAction(BaseModel):
    action: Literal["create", "remove"]


@router.get("/status")
def status(request: Request) -> dict:
    return _svc(request).status()


@router.post("/config", dependencies=[Depends(same_origin_only)])
def update_config(body: ConfigUpdate, request: Request) -> dict:
    svc = _svc(request)
    if body.captions and svc.zoom is None:
        raise HTTPException(400, "paste a Zoom caption API token first")
    svc.update(**body.model_dump())
    return svc.status()


@router.post("/mute", dependencies=[Depends(same_origin_only)])
def mute(request: Request) -> dict:
    svc = _svc(request)
    svc.mute()
    return svc.status()


@router.post("/zoom-token", dependencies=[Depends(same_origin_only)])
def zoom_token(body: ZoomToken, request: Request) -> dict:
    svc = _svc(request)
    try:
        svc.set_zoom_token(body.token_url or None)
    except ZoomTokenError as exc:
        raise HTTPException(400, str(exc)) from exc
    return svc.status()


@router.post("/virtual-mic", dependencies=[Depends(same_origin_only)])
def virtual_mic_action(body: MicAction, request: Request) -> dict:
    svc = _svc(request)
    try:
        if body.action == "create":
            svc.mic.create()
        else:
            svc.mic.remove()
    except virtual_mic.VirtualMicError as exc:
        raise HTTPException(500, str(exc)) from exc
    return svc.status()


@router.post("/send", dependencies=[Depends(same_origin_only)])
def send(body: SendRequest, request: Request) -> dict:
    if body.simulated:
        raise HTTPException(400, "simulated demo output is never sent to a meeting")
    svc = _svc(request)
    try:
        item = svc.send(body.text, body.source)
    except PermissionError as exc:
        raise HTTPException(409, str(exc)) from exc
    except OverflowError as exc:
        raise HTTPException(429, str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc
    return {"id": item.id, "status": svc.status()}
