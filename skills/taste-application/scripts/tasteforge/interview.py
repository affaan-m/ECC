"""Deterministic taste interview: answers in, structured profile out.

The interview is the local, human half of distillation. It asks the same axes
the recovered implementation asks a vision model (palette, grain, lighting,
lens, motion, framing, grade, mood, avoid) plus the content brief, and keeps
look and content strictly separate - collapsing them is the standard failure
(style words leak into the scene; subject words get read as style).
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any

from . import schema

__all__ = ["Question", "QUESTIONS", "conduct"]

_LOOK_QUESTIONS = (
    ("palette", "Name the dominant colors and how they are distributed."),
    ("grain", "Describe texture/noise character (e.g. fine 35mm grain)."),
    ("lighting", "Key/fill/practical sources and their quality?"),
    ("focal_length", "Apparent focal length and its perspective effect?"),
    ("camera_motion", "How does the camera move, or is it locked off?"),
    ("subject_framing", "How do subjects sit in frame (headroom, thirds, negative space)?"),
    ("grade_description", "The color grade, in colorist language?"),
    ("mood_adjectives", "Three adjectives for the mood, comma-separated."),
    ("avoid", "Failure modes to avoid, comma-separated."),
)
_CONTENT_QUESTIONS = (
    ("brief", "What should happen on screen (subject, action, place)?"),
)


@dataclass(frozen=True)
class Question:
    id: str
    prompt: str
    axis: str  # "look" or "content"


QUESTIONS: tuple[Question, ...] = (
    *(Question(qid, prompt, "look") for qid, prompt in _LOOK_QUESTIONS),
    *(Question(qid, prompt, "content") for qid, prompt in _CONTENT_QUESTIONS),
)


def _split_list(value: str) -> list[str]:
    return [part.strip() for part in value.replace(";", ",").split(",") if part.strip()]


def _utc_now() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def conduct(answers: dict[str, str], genre: str = "untitled") -> dict[str, Any]:
    """Build a TasteProfile from free-text answers. Deterministic, offline.

    Missing answers are recorded under ``unanswered`` - never invented.
    """
    look: dict[str, Any] = {}
    unanswered: list[str] = []

    for qid, _ in _LOOK_QUESTIONS:
        raw = (answers.get(qid) or "").strip()
        if not raw:
            unanswered.append(qid)
            continue
        if qid in ("mood_adjectives", "avoid"):
            look[qid] = _split_list(raw)
        else:
            look[qid] = raw

    # Schema floor: mood_adjectives and avoid must exist as lists.
    look.setdefault("mood_adjectives", [])
    look.setdefault("avoid", [])

    brief = (answers.get("brief") or "").strip()
    if not brief:
        unanswered.append("brief")

    profile = {
        "schema_version": 1,
        "genre": genre,
        "created": _utc_now(),
        "answers": {k: str(v).strip() for k, v in answers.items() if str(v).strip()},
        "unanswered": unanswered,
        "constraints": {
            "look": look,
            "content": {"brief": brief},
        },
    }
    problems = schema.validate(profile, schema.TASTE_PROFILE_SCHEMA)
    if problems:
        raise ValueError(f"interview produced an invalid profile: {problems}")
    return profile
