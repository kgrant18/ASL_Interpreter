from __future__ import annotations

from dataclasses import asdict

from fastapi import APIRouter, Request

router = APIRouter()


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
    return {
        "supported": [asdict(e) for e in entries if e.enabled],
        "disabled": [asdict(e) for e in entries if not e.enabled],
    }
