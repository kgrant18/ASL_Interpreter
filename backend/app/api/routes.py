from __future__ import annotations

from dataclasses import asdict

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel

from .. import recordings
from .. import config
from ..recognition.phrases import load_phrase_set
from .meeting import same_origin_only

router = APIRouter()


class LabelBody(BaseModel):
    label: str


@router.get("/api/recordings")
def recording_counts() -> dict:
    return {"counts": recordings.counts()}


@router.post("/api/recordings/delete-last", dependencies=[Depends(same_origin_only)])
def recording_delete_last(body: LabelBody) -> dict:
    try:
        return {"counts": recordings.delete_last(body.label)}
    except recordings.RecordingError as exc:
        raise HTTPException(404, str(exc)) from exc


@router.get("/health")
def health(request: Request) -> dict:
    rec = request.app.state.recognizer
    return {"status": "ok", "model_loaded": bool(rec and rec.loaded)}


@router.get("/api/model")
def model_info(request: Request) -> dict:
    rec = request.app.state.recognizer
    if rec is None:
        return {"name": None, "loaded": False, "mode": "unavailable", "limitations": []}
    return rec.get_metadata()


@router.get("/api/vocabulary")
def vocabulary(request: Request) -> dict:
    rec = request.app.state.recognizer
    entries = rec.get_vocabulary() if rec is not None and rec.loaded else []
    path = config.settings.phrases_path
    phrases = []
    if path is not None and path.exists() and entries:
        phrases = [{"id": p.id, "english": p.english, "glosses": list(p.signs)}
                   for p in load_phrase_set(path).phrases]
    return {
        "supported": [asdict(e) for e in entries if e.enabled],
        "disabled": [asdict(e) for e in entries if not e.enabled],
        "phrases": phrases,
    }
