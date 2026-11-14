"""Verified mapping from model class labels (ASL Citizen glosses) to English output.

English outputs are simple glosses, NOT grammatical translations. Descriptions are
citation-form summaries to help a demonstrator; regional/individual variants exist.
Whether a sign is *enabled* is decided by held-out evaluation (models/signgru_eval.json),
not by this table.
"""

from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class SignInfo:
    label: str
    english: str
    description: str


SIGNS: dict[str, SignInfo] = {s.label: s for s in [
    SignInfo("HELLO", "Hello.", "Flat hand starts near the temple/forehead and moves outward, like a small salute."),
    SignInfo("THANKYOU", "Thank you.", "Fingertips of a flat hand touch the chin, then the hand moves forward and down."),
    SignInfo("YES", "Yes.", "A fist (S-hand) nods up and down at the wrist."),
    SignInfo("NO", "No.", "Index and middle fingers snap down onto the thumb."),
    SignInfo("HELP", "Help.", "Thumbs-up fist rests on the other flat palm; both hands rise together."),
    SignInfo("PLEASE", "Please.", "Flat hand on the chest moves in a circle."),
    SignInfo("STOP", "Stop.", "Edge of the dominant flat hand chops down onto the other upturned palm."),
    SignInfo("AGAIN", "Again.", "Bent dominant hand arcs over and lands in the other flat palm."),
    SignInfo("UNDERSTAND", "Understand.", "Fist beside the forehead; index finger flicks up."),
    SignInfo("SORRY", "Sorry.", "Fist (A-hand) circles on the chest."),
    SignInfo("BYE", "Bye.", "Open hand, fingers fold down and up (wave)."),
    SignInfo("NAME", "Name.", "Two-finger (H) hands; dominant fingers tap on top of the other's twice."),
    SignInfo("WHERE", "Where?", "Index finger up, shaken side to side."),
    SignInfo("MORE", "More.", "Both flat-O hands tap fingertips together."),
    SignInfo("FINISH", "Finished.", "Both open hands, palms in, twist outward."),
    SignInfo("GOOD", "Good.", "Flat hand moves from the chin down onto the other palm."),
    SignInfo("NICE", "Nice.", "Flat palm slides across the other flat palm."),
    SignInfo("MEET", "Meet.", "Two upright index fingers come together."),
    SignInfo("LEARN", "Learn.", "Fingers 'pick up' from the other palm and move to the forehead."),
    SignInfo("FRIEND", "Friend.", "Index fingers hook together, then switch positions."),
    SignInfo("WATER", "Water.", "W-hand (three fingers) taps the chin."),
    SignInfo("WAIT", "Wait.", "Both open hands, palms up, fingers wiggle."),
    SignInfo("LOVE", "Love.", "Fists cross over the chest."),
    SignInfo("SIGN", "Sign.", "Index fingers circle alternately in front of the body."),
]}


# English for the expanded (v2) vocabulary. ASL Citizen numbers lexical variants
# (WHAT1/WHAT2 are different signs with the same meaning); variants share English.
_ENGLISH: dict[str, str] = {
    "ME": "Me.", "YOU": "You.", "WE": "We.", "THEY": "They.", "MY": "My.", "YOUR": "Your.",
    "WHAT": "What?", "WHO": "Who?", "WHY": "Why?", "HOW": "How?", "WHEN": "When?",
    "WHICH": "Which?", "THANKYOU": "Thank you.", "OK": "OK.", "DONTLIKE": "Don't like.",
    "DONTKNOW": "I don't know.", "FINISH": "Finished.", "BATHROOM": "Bathroom.",
    "DEAF": "Deaf.", "HEARING": "Hearing.", "EXCUSE": "Excuse me.", "CAN": "Can.",
    "RIGHT": "Right.", "TRUE": "True.", "NOT": "Not.", "NONE": "None.",
    "WELCOME": "Welcome.", "CONFUSED": "Confused.", "NIGHT": "Night.",
}


def _base(label: str) -> str:
    return label.rstrip("0123456789") or label


def english_for(label: str) -> str:
    info = SIGNS.get(label)
    if info:
        return info.english
    base = _base(label)
    if base in SIGNS:
        return SIGNS[base].english
    if base in _ENGLISH:
        return _ENGLISH[base]
    return base.replace("_", " ").capitalize() + "."
