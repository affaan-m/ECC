#!/usr/bin/env python3
"""learning_engine.py — the deterministic mastery engine for repo-mastery.

This is the single source of truth for the *gate*: whether a learner may
advance is computed here in pure, tool-agnostic code — NOT interpreted from
prose by whatever LLM/tool happens to be tutoring. Every platform (Claude
Code, Codex, Gemini CLI, opencode, ...) calls this script for the same
deterministic answers, so mastery math can never drift between tools.

Pure stdlib. JSON in, JSON out. The math mirrors references/mastery-policy.md.

Subcommands:
    compute-mastery <correctness.json>          recency-weighted accuracy + confidence cap
    schedule <type> <is_correct> [state.json]   spaced-repetition state transition
    record-attempt <progress.json> <opts...>    record a quiz/hands-on attempt
    next-objective <progress.json> [--mode auto|review]   what the tutor should do next
    set-phase <progress.json> <phase> [--module <id>]     advance the learning flow phase
    validate-map <course-map.json>              check a course map's schema
    init <repo_path> [--force]                  create .learning/ scaffolding + .gitignore

Examples:
    python3 learning_engine.py compute-mastery '[true,false,true]'
    python3 learning_engine.py schedule procedure false '{"interval_index":0,"consecutive_correct":0,"consecutive_wrong":0}'
    python3 learning_engine.py next-objective .learning/progress.json
"""

from __future__ import annotations

import argparse
import json
import os
import sys
import time

# --- constants (single source of truth; keep in sync with mastery-policy.md) ---

# Newer attempts weigh more, so recovery after early mistakes is rewarded.
RECENCY_WEIGHTS: tuple[float, ...] = (0.5, 0.7, 0.85, 0.95, 1.0)

# Mastery cannot exceed this until enough evidence accumulates: one lucky
# answer can never "master" a point.
CONFIDENCE_CAP: dict[int, float] = {1: 0.5, 2: 0.8}

# Quantitative gate — the learner must reach this mastery before advancing
# (~0.9 mirrors Alpha School's "90% before you advance").
QUANTITATIVE_GATE: float = 0.9

# Qualitative types are gated by a Feynman-style explanation judged by the
# tutor (a boolean), not by graded accuracy.
QUALITATIVE_TYPES: frozenset[str] = frozenset({"concept", "design"})

# Spaced-repetition intervals in days, per knowledge type.
INTERVAL_SEQUENCES: dict[str, list[int]] = {
    "memory": [0, 1, 3, 7, 14, 30],
    "concept": [3, 7, 14, 30],
    "procedure": [3, 7, 14],
    "design": [14, 28],
}

# Base review priority by type; error records raise it to 1 (highest).
TYPE_PRIORITY: dict[str, int] = {
    "memory": 2, "concept": 3, "procedure": 4, "design": 5,
}

VALID_TYPES: frozenset[str] = frozenset(
    {"memory", "concept", "procedure", "design"}
)

# Textbook-mode chapter lifecycle statuses (module-level gate flow).
CHAPTER_STATUSES: tuple[str, ...] = ("teaching", "qna", "verifying")

# progress.json key that lists modules whose chapter gate has passed.
COVERED_KEY: str = "chapter_covered_modules"


# --- core pure functions ---

def compute_mastery(correctness: list[bool]) -> float:
    """Recency-weighted accuracy over the latest up-to-5 attempts, capped by
    the confidence ceiling. Returns a 0..1 mastery score."""
    if not correctness:
        return 0.0
    recent = correctness[-len(RECENCY_WEIGHTS):]
    weights = RECENCY_WEIGHTS[-len(recent):]
    score = sum(w * (1.0 if c else 0.0) for c, w in zip(recent, weights)) / sum(weights)
    return min(score, CONFIDENCE_CAP.get(len(recent), 1.0))


def schedule_next(
    kp_type: str,
    is_correct: bool,
    state: dict,
) -> dict:
    """Advance a repetition state with FSRS-inspired personalized scheduling.

    Each knowledge point carries a `difficulty` (0.1..1.0, how hard it is for
    this learner) and a `stability` (1.0..5.0, how durable the memory is). The
    review interval is the base interval scaled by stability and reduced by
    difficulty, so hard points are reviewed sooner and stable points deferred.
    Pure stdlib; deterministic; matches references/mastery-policy.md §3.
    """
    intervals = INTERVAL_SEQUENCES.get(kp_type, INTERVAL_SEQUENCES["memory"])
    max_index = len(intervals) - 1
    state = dict(state)
    state.setdefault("interval_index", 0)
    state.setdefault("consecutive_correct", 0)
    state.setdefault("consecutive_wrong", 0)
    state.setdefault("difficulty", 0.5)
    state.setdefault("stability", 1.0)

    if is_correct:
        state["consecutive_wrong"] = 0
        state["consecutive_correct"] += 1
        state["difficulty"] = max(0.1, state["difficulty"] - 0.05)
        state["stability"] = min(
            5.0, state["stability"] * (1 + 0.2 * min(state["consecutive_correct"], 5))
        )
        if state["consecutive_correct"] >= 2:
            state["interval_index"] += 2
            state["consecutive_correct"] = 0
        else:
            state["interval_index"] += 1
    else:
        state["consecutive_wrong"] += 1
        state["consecutive_correct"] = 0
        state["interval_index"] = max(0, state["interval_index"] - 1)
        state["difficulty"] = min(1.0, state["difficulty"] + 0.15)
        state["stability"] = max(1.0, state["stability"] * 0.5)
        if state["consecutive_wrong"] >= 2:
            state["consecutive_wrong"] = 0

    state["interval_index"] = max(0, min(state["interval_index"], max_index))
    base_days = intervals[state["interval_index"]]
    days = base_days * state["stability"] * (1 - state["difficulty"] * 0.5)
    state["next_review_at"] = int(time.time()) + int(days * 86400)
    return state


def is_mastered(progress: dict, kp_id: str, kp_type: str) -> bool:
    """Whether a knowledge point clears its gate (quantitative or qualitative).

    `memory` points are demoted to reference notes (cheatsheet) and never gate
    advancement — they count as covered so `next_objective` skips them.
    """
    if kp_type == "memory":
        return True
    if kp_type in QUALITATIVE_TYPES:
        return bool(progress.get("qualitative_mastery", {}).get(kp_id, False))
    return progress.get("mastery_levels", {}).get(kp_id, 0.0) >= QUANTITATIVE_GATE


def objective_status(progress: dict, kp_id: str, kp_type: str) -> str:
    """'mastered' | 'learning' | 'new' for one knowledge point."""
    if is_mastered(progress, kp_id, kp_type):
        return "mastered"
    seen = any(a.get("knowledge_point_id") == kp_id for a in progress.get("quiz_attempts", []))
    if kp_id in progress.get("qualitative_mastery", {}):
        seen = True
    return "learning" if seen else "new"


def next_objective(progress: dict, *, now: int | None = None,
                   mode: str = "auto") -> dict:
    """Decide the next thing to work on. The gate IS the cursor:
    advancement is computed from what is mastered, never a stage counter.

    The learning flow has phases — "overview" → "module_overview" →
    "learning" — tracked in `progress["flow_phase"]` (missing = "learning",
    backward compatible). The whole picture comes before the nodes, and this is
    enforced by the engine, not left to the tutor's discretion: while the flow
    is still in an overview phase, `next_objective` REFUSES to hand out a
    knowledge point.

    Precedence (auto mode):
      1) pending question
      2) flow_phase gate  — overview / module_overview must finish first
      3) due spaced review
      4) first unmastered point (probe / practice / assess)
      5) complete

    `mode="review"` is the focused `/repo-mastery review` path: it bypasses the
    flow_phase gate and unmastered-point steps, returning only pending →
    due review → complete. Scattered-time review is never blocked by an
    unfinished overview.
    """
    now = int(time.time()) if now is None else now
    kps = _all_knowledge_points(progress)

    # 1) grade any posed question before moving on.
    pending = progress.get("pending_question")
    if pending:
        kp = _find(kps, pending.get("knowledge_point_id"))
        return {
            "action": "answer_pending",
            "knowledge_point_id": pending.get("knowledge_point_id"),
            "knowledge_point_type": kp["type"] if kp else "",
            "pending_prompt": pending.get("prompt", ""),
            "reason": "A posed question awaits the learner's answer.",
        }

    # 2) flow_phase gate: the whole picture comes before the nodes. The tutor
    #    must present the overview first (then advance it via `set-phase`);
    #    until then no knowledge point is handed out. Review mode bypasses
    #    this so scattered-time review is never blocked.
    if mode != "review":
        flow_phase = progress.get("flow_phase", "learning")
        if flow_phase == "overview":
            return {
                "action": "overview",
                "reason": "The global overview (architecture narrative + module map) "
                          "must be presented before any node. Run `set-phase "
                          "module_overview` once done.",
            }
        if flow_phase == "module_overview":
            return {
                "action": "module_overview",
                "module_id": progress.get("current_module_id"),
                "reason": "This module's overview (knowledge-point map + cheatsheet) "
                          "must be presented before its nodes. Run `set-phase "
                          "learning` once done.",
            }
        # 2b) chapter gate: an in-progress textbook-mode chapter keeps teaching
        #     its sections before any new point is handed out — chapter learning
        #     is a continuous run, so a resume continues the chapter, not a node.
        #     `mode="review"` bypasses this too (scattered-time review drains due
        #     reviews even mid-chapter). The tutor resumes from chapters/<m>.md.
        chapter = progress.get("chapter")
        if chapter:
            module = _find_module(progress.get("modules", []), chapter.get("module_id"))
            due_count = sum(1 for t in progress.get("review_queue", [])
                            if t.get("due_at", 0) <= now)
            return {
                "action": "chapter",
                "module_id": chapter.get("module_id"),
                "module_name": module.get("name") if module else "",
                "chapter_status": chapter.get("status"),
                "section_index": chapter.get("section_index"),
                "sections": chapter.get("sections"),
                "due_review_count": due_count,
                "reason": "Textbook-mode chapter in progress — continue teaching "
                          "from chapters/<module>.md.",
            }

    # 3) due spaced-repetition reviews. Equal-priority reviews interleave
    #    types: a review whose type differs from the last one wins, so
    #    consecutive reviews mix types instead of stacking one type.
    due = [t for t in progress.get("review_queue", []) if t.get("due_at", 0) <= now]
    last_type = progress.get("last_review_type")
    due.sort(key=lambda t: (
        t.get("priority", 99),
        1 if last_type and t.get("knowledge_type") == last_type else 0,
    ))
    if due:
        task = due[0]
        kp = _find(kps, task.get("knowledge_point_id"))
        return {
            "action": "review",
            "knowledge_point_id": task.get("knowledge_point_id"),
            "knowledge_point_type": kp["type"] if kp else "",
            "reason": "This objective is due for spaced-repetition review.",
        }

    # Review mode stops here: it never opens new content.
    if mode == "review":
        return {
            "action": "complete",
            "reason": "Review mode: nothing due for review — suggest `continue` "
                      "to advance the course.",
        }

    # 4) first unmastered point in module order, then knowledge-point order.
    error_kps = {
        e.get("knowledge_point_id") for e in progress.get("error_records", [])
        if e.get("status") in ("active", "retrying")
    }
    # Modules whose chapter gate already passed are covered: their points were
    # either engine-verified at after-class checking or get validated via
    # spaced review — never re-offered as fresh nodes. The skip lives here (the
    # module-iteration layer), NOT in `is_mastered` (which has no module_id).
    covered = set(progress.get(COVERED_KEY, []))
    for module in sorted(progress.get("modules", []), key=lambda m: m.get("order", 0)):
        if module.get("id") in covered:
            continue
        for kp in module.get("knowledge_points", []):
            kp_id, kp_type = kp.get("id"), kp.get("type", "concept")
            # `memory` points are demoted to reference notes (cheatsheet): they
            # never gate advancement. New maps shouldn't define them as
            # knowledge points at all; this skip keeps old maps valid & harmless.
            if kp_type == "memory":
                continue
            if is_mastered(progress, kp_id, kp_type):
                continue
            status = objective_status(progress, kp_id, kp_type)
            if status == "new":
                action = "probe"          # test-out: probe before teaching
            elif kp_type in QUALITATIVE_TYPES:
                action = "assess"         # Feynman check
            else:
                action = "practice"       # below the quantitative gate
            return {
                "action": action,
                "module_id": module.get("id"),
                "module_name": module.get("name"),
                "knowledge_point_id": kp_id,
                "knowledge_point_name": kp.get("name"),
                "knowledge_point_type": kp_type,
                "status": status,
                "mastery": round(progress.get("mastery_levels", {}).get(kp_id, 0.0), 3),
                "threshold": QUANTITATIVE_GATE,
                "has_error": kp_id in error_kps,
                "reason": (
                    "Untouched objective — probe to let the learner test out."
                    if status == "new"
                    else "Objective is below its mastery gate; keep working it."
                ),
            }

    # 5) done.
    return {"action": "complete", "reason": "All objectives mastered and nothing due."}


def record_attempt(progress: dict, *, kp_id: str, kp_type: str, is_correct: bool,
                   question_id: str = "", error_type: str | None = None,
                   hands_on_pass: bool = False) -> dict:
    """Apply a quiz/hands-on attempt to progress.json (in place) and return
    the updated mastery for the point.

    Updates: quiz_attempts, mastery_levels (via compute_mastery),
    repetition_states + review_queue (via schedule_next), error_records,
    and clears pending_question when this attempt answers it.
    """
    progress.setdefault("mastery_levels", {})
    progress.setdefault("knowledge_types", {})
    progress.setdefault("quiz_attempts", [])
    progress.setdefault("repetition_states", {})
    progress.setdefault("review_queue", [])
    progress.setdefault("error_records", [])
    progress["knowledge_types"][kp_id] = kp_type

    # hands-on pass for a procedure point counts as a correct attempt.
    correct = bool(is_correct or hands_on_pass)

    progress["quiz_attempts"].append({
        "question_id": question_id,
        "knowledge_point_id": kp_id,
        "is_correct": correct,
        "error_type": error_type,
        "timestamp": int(time.time()),
    })

    # recompute quantitative mastery from the full history of this point.
    history = [a["is_correct"] for a in progress["quiz_attempts"] if a["knowledge_point_id"] == kp_id]
    progress["mastery_levels"][kp_id] = compute_mastery(history)

    # advance spaced repetition.
    state = progress["repetition_states"].get(kp_id, {
        "interval_index": 0, "consecutive_correct": 0, "consecutive_wrong": 0,
    })
    new_state = schedule_next(kp_type, correct, state)
    progress["repetition_states"][kp_id] = new_state

    # error record when wrong.
    if not correct and error_type:
        progress["error_records"].append({
            "id": f"e{int(time.time())}",
            "question_id": question_id,
            "knowledge_point_id": kp_id,
            "error_type": error_type,
            "status": "active",
            "created_at": int(time.time()),
        })

    # clear a pending question if this attempt answers it.
    pending = progress.get("pending_question")
    if pending and (not question_id or pending.get("question_id") == question_id):
        progress["pending_question"] = None

    progress["last_review_type"] = kp_type
    _rebuild_review_queue(progress)
    return {
        "mastery": round(progress["mastery_levels"][kp_id], 3),
        "passed_gate": progress["mastery_levels"][kp_id] >= QUANTITATIVE_GATE,
        "next_review_at": new_state.get("next_review_at"),
    }


def validate_map(course_map: dict) -> list[str]:
    """Return a list of problems in a course map (empty = valid)."""
    problems: list[str] = []
    if not isinstance(course_map, dict) or "modules" not in course_map:
        return ["course-map.json must be an object with a 'modules' array"]
    for module in course_map["modules"]:
        mid = module.get("id", "?")
        for kp in module.get("knowledge_points", []):
            if kp.get("type") not in VALID_TYPES:
                problems.append(f"{mid}/{kp.get('id')}: invalid type {kp.get('type')!r} "
                                f"(must be one of {sorted(VALID_TYPES)})")
        if module.get("order") is None:
            problems.append(f"{mid}: missing 'order'")
    return problems


def init_scaffold(repo_path: str, force: bool = False) -> list[str]:
    """Create .learning/ scaffolding + .gitignore under *repo_path*."""
    learning = os.path.join(repo_path, ".learning")
    created: list[str] = []
    if os.path.isdir(learning) and not force:
        return ["already exists; pass --force to re-create"]
    for sub in ("", "notes", "records", "briefs"):
        d = os.path.join(learning, sub)
        if not os.path.isdir(d):
            os.makedirs(d, exist_ok=True)
            created.append(d)
    gi = os.path.join(learning, ".gitignore")
    if not os.path.isfile(gi) or force:
        with open(gi, "w", encoding="utf-8") as fh:
            fh.write(".learning/\n")
        created.append(gi)
    return created


# --- helpers ---

def _all_knowledge_points(progress: dict) -> list[dict]:
    out: list[dict] = []
    for module in progress.get("modules", []):
        for kp in module.get("knowledge_points", []):
            out.append(kp)
    return out


def _find(kps: list[dict], kp_id: str | None) -> dict | None:
    return next((k for k in kps if k.get("id") == kp_id), None)


def _find_module(modules: list[dict], module_id: str | None) -> dict | None:
    return next((m for m in modules if m.get("id") == module_id), None)


def _first_review_state(kp_type: str, now: int) -> dict:
    """A fresh first-review state (interval_index 0 on the type's base interval).

    Used to initialise spaced review for points that were NOT individually
    verified at after-class checking. It records no answer — mastery is built
    later by real review attempts (fluency != storage; never fake a 'correct'
    evidence by calling schedule_next with a fabricated result).
    """
    base = INTERVAL_SEQUENCES.get(kp_type, INTERVAL_SEQUENCES["memory"])[0]
    return {
        "interval_index": 0,
        "consecutive_correct": 0,
        "consecutive_wrong": 0,
        "difficulty": 0.5,
        "stability": 1.0,
        "next_review_at": now + base * 86400,
    }


def chapter_start(progress: dict, *, module_id: str, sections: int) -> dict:
    """Begin a textbook-mode chapter for a module. Validates preconditions so
    the state machine never enters a dangling half-state."""
    if progress.get("flow_phase", "learning") != "learning":
        raise ValueError("flow_phase must be 'learning' before chapter-start — "
                         "finish the overviews first (set-phase module_overview, "
                         "then set-phase learning)")
    modules = progress.get("modules", [])
    module = _find_module(modules, module_id)
    if module is None:
        raise ValueError(f"unknown module {module_id!r} — check course-map modules")
    if module_id in progress.get(COVERED_KEY, []):
        raise ValueError(f"module {module_id!r} is already covered by a completed chapter")
    if progress.get("pending_question"):
        raise ValueError("a pending_question exists — grade it before starting a chapter")
    if sections < 1:
        raise ValueError("sections must be >= 1")

    progress["chapter"] = {
        "module_id": module_id,
        "status": "teaching",
        "section_index": 0,
        "sections": sections,
    }
    progress["current_module_id"] = module_id
    return dict(progress["chapter"])


def chapter_advance(progress: dict, *, section_index: int | None = None,
                    status: str | None = None) -> dict:
    """Advance an in-progress chapter's section index and/or lifecycle status."""
    chapter = progress.get("chapter")
    if not chapter:
        raise ValueError("no active chapter to advance")
    if status is not None:
        if status not in CHAPTER_STATUSES:
            raise ValueError(f"invalid chapter status {status!r} — expected one of "
                             f"{', '.join(CHAPTER_STATUSES)}")
        chapter["status"] = status
    if section_index is not None:
        chapter["section_index"] = max(0, min(int(section_index), chapter["sections"]))
    return dict(chapter)


def chapter_complete(progress: dict, *, now: int | None = None) -> dict:
    """Module-level gate for the active chapter.

    The chapter's module counts as *covered* (learned together), but points
    that were NOT individually verified get an initialised spaced review rather
    than a fabricated mastery score — real mastery is built by later review
    attempts. Key nodes verified at after-class checking keep their real engine
    records (qualitative_mastery / quiz_attempts) untouched.
    """
    chapter = progress.get("chapter")
    if not chapter:
        raise ValueError("no active chapter to complete")
    module_id = chapter["module_id"]
    now = int(time.time()) if now is None else now
    module = _find_module(progress.get("modules", []), module_id)
    if module is None:
        raise ValueError(f"unknown module {module_id!r} — cannot complete its chapter")

    progress.setdefault("mastery_levels", {})
    progress.setdefault("qualitative_mastery", {})
    progress.setdefault("knowledge_types", {})
    progress.setdefault("repetition_states", {})
    progress.setdefault("review_queue", [])
    progress.setdefault("error_records", [])

    for kp in module.get("knowledge_points", []):
        kp_id, kp_type = kp.get("id"), kp.get("type", "concept")
        if kp_type == "memory":
            continue
        # _rebuild_review_queue reads knowledge_types and DROPS points whose
        # type is missing (treated as `memory`). Without this write the covered
        # points would never enter the review queue.
        progress["knowledge_types"][kp_id] = kp_type
        if kp_type in QUALITATIVE_TYPES:
            mastered = bool(progress["qualitative_mastery"].get(kp_id, False))
        else:
            mastered = progress["mastery_levels"].get(kp_id, 0.0) >= QUANTITATIVE_GATE
        state = progress["repetition_states"].get(kp_id)
        if state is None or not mastered:
            # Unverified (or verification-failed) → start spaced review from a
            # fresh first-review state. A mastered point keeps its state; a
            # non-mastered one is reset so a lucky review streak can't inherit a
            # lengthened interval.
            progress["repetition_states"][kp_id] = _first_review_state(kp_type, now)

    progress["chapter"] = None
    covered = progress.setdefault(COVERED_KEY, [])
    if module_id not in covered:
        covered.append(module_id)
    _rebuild_review_queue(progress)
    return {"module_id": module_id, "covered_modules": list(covered)}


def set_qualitative(progress: dict, *, kp_id: str, kp_type: str,
                    passed: bool) -> dict:
    """Record a tutor-judged qualitative result (concept/design) and make sure
    the point is scheduled for spaced review once passed. Without this,
    qualitative points that pass the Feynman check would never enter the review
    queue (an existing gap now fixed).
    """
    if kp_type not in QUALITATIVE_TYPES:
        raise ValueError(f"set-qualitative requires a qualitative type "
                         f"(concept|design), got {kp_type!r}")
    progress.setdefault("qualitative_mastery", {})
    progress.setdefault("knowledge_types", {})
    progress.setdefault("repetition_states", {})
    progress.setdefault("review_queue", [])
    progress.setdefault("error_records", [])

    progress["qualitative_mastery"][kp_id] = bool(passed)
    progress["knowledge_types"][kp_id] = kp_type
    if passed and kp_id not in progress["repetition_states"]:
        progress["repetition_states"][kp_id] = _first_review_state(
            kp_type, int(time.time()))
    _rebuild_review_queue(progress)
    return {
        "kp_id": kp_id,
        "passed": bool(passed),
        "is_mastered": is_mastered(progress, kp_id, kp_type),
    }


def _rebuild_review_queue(progress: dict) -> None:
    """Rebuild review_queue from repetition_states + error priority."""
    now = int(time.time())
    error_kps = {
        e.get("knowledge_point_id") for e in progress.get("error_records", [])
        if e.get("status") in ("active", "retrying")
    }
    queue: list[dict] = []
    for kp_id, state in progress.get("repetition_states", {}).items():
        kp_type = progress.get("knowledge_types", {}).get(kp_id, "memory")
        # `memory` points are reference notes, not review candidates.
        if kp_type == "memory":
            continue
        priority = 1 if kp_id in error_kps else TYPE_PRIORITY.get(kp_type, 5)
        queue.append({
            "id": f"review_{kp_id}",
            "knowledge_point_id": kp_id,
            "knowledge_type": kp_type,
            "due_at": state.get("next_review_at", now),
            "priority": priority,
            "state": state,
        })
    progress["review_queue"] = queue


# --- CLI ---

def _json_arg(value: str):
    try:
        return json.loads(value)
    except json.JSONDecodeError as exc:
        sys.exit(f"invalid JSON: {exc}")


def main(argv: list[str] | None = None) -> None:
    ap = argparse.ArgumentParser(prog="learning_engine", description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = ap.add_subparsers(dest="cmd", required=True)

    p = sub.add_parser("compute-mastery", help="recency-weighted mastery from correctness list")
    p.add_argument("correctness", type=_json_arg, help='JSON bool list, e.g. "[true,false,true]"')

    p = sub.add_parser("schedule", help="spaced-repetition state transition")
    p.add_argument("type", choices=sorted(VALID_TYPES))
    p.add_argument("is_correct", type=_json_arg, help="true|false")
    p.add_argument("state", nargs="?", type=_json_arg, default="{}",
                   help='current repetition state JSON (optional)')

    p = sub.add_parser("record-attempt", help="apply an attempt to progress.json")
    p.add_argument("progress", help="path to progress.json")
    p.add_argument("--kp", required=True, help="knowledge point id")
    p.add_argument("--type", choices=sorted(VALID_TYPES), required=True)
    p.add_argument("--correct", action="store_true", help="attempt was correct")
    p.add_argument("--hands-on", action="store_true", help="hands-on verification passed")
    p.add_argument("--question", default="", help="question id (clears matching pending)")
    p.add_argument("--error", default=None, help="error type: structural|deviation|application|metacognitive")
    p.add_argument("--write", action="store_true", help="write changes back to the file")

    p = sub.add_parser("next-objective", help="what the tutor should do next")
    p.add_argument("progress", help="path to progress.json")
    p.add_argument("--mode", choices=["auto", "review"], default="auto",
                   help="auto = full flow (default); review = due reviews only")

    p = sub.add_parser("set-phase", help="advance the learning flow phase")
    p.add_argument("progress", help="path to progress.json")
    p.add_argument("phase", choices=["overview", "module_overview", "learning"])
    p.add_argument("--module", default=None,
                   help="module id (for the module_overview phase)")

    p = sub.add_parser("chapter-start", help="begin a textbook-mode chapter for a module")
    p.add_argument("progress", help="path to progress.json")
    p.add_argument("--module", required=True, help="module id")
    p.add_argument("--sections", type=int, required=True,
                   help="number of sections in the chapter")

    p = sub.add_parser("chapter-advance", help="advance an in-progress chapter")
    p.add_argument("progress", help="path to progress.json")
    p.add_argument("--section", type=int, default=None,
                   help="current section index (clamped to [0, sections])")
    p.add_argument("--status", choices=list(CHAPTER_STATUSES), default=None,
                   help="chapter lifecycle status: teaching|qna|verifying")

    p = sub.add_parser("chapter-complete",
                       help="module-level gate: mark the active chapter's module covered")
    p.add_argument("progress", help="path to progress.json")

    p = sub.add_parser("set-qualitative",
                       help="record a tutor-judged qualitative result (concept|design)")
    p.add_argument("progress", help="path to progress.json")
    p.add_argument("--kp", required=True, help="knowledge point id")
    p.add_argument("--type", choices=sorted(QUALITATIVE_TYPES), required=True,
                   help="knowledge point type")
    qgroup = p.add_mutually_exclusive_group(required=True)
    qgroup.add_argument("--pass", dest="passed", action="store_true",
                        help="qualitative judgment passed")
    qgroup.add_argument("--fail", dest="passed", action="store_false",
                        help="qualitative judgment failed")

    p = sub.add_parser("validate-map", help="check a course map's schema")
    p.add_argument("course_map", help="path to course-map.json")

    p = sub.add_parser("init", help="create .learning/ scaffolding")
    p.add_argument("repo_path")
    p.add_argument("--force", action="store_true")

    args = ap.parse_args(argv)

    if args.cmd == "compute-mastery":
        print(json.dumps({"mastery": round(compute_mastery(args.correctness), 3)}))

    elif args.cmd == "schedule":
        out = schedule_next(args.type, bool(args.is_correct), args.state)
        print(json.dumps(out))

    elif args.cmd == "record-attempt":
        progress = _load_json(args.progress)
        result = record_attempt(
            progress, kp_id=args.kp, kp_type=args.type,
            is_correct=args.correct, question_id=args.question,
            error_type=args.error, hands_on_pass=args.hands_on,
        )
        if args.write:
            _atomic_write(args.progress, progress)
        print(json.dumps(result))

    elif args.cmd == "next-objective":
        progress = _load_json(args.progress)
        print(json.dumps(next_objective(progress, mode=args.mode)))

    elif args.cmd == "set-phase":
        progress = _load_json(args.progress)
        progress["flow_phase"] = args.phase
        if args.module:
            progress["current_module_id"] = args.module
        _atomic_write(args.progress, progress)
        print(json.dumps({
            "flow_phase": args.phase,
            "current_module_id": progress.get("current_module_id"),
        }))

    elif args.cmd == "chapter-start":
        progress = _load_json(args.progress)
        try:
            chapter = chapter_start(progress, module_id=args.module,
                                    sections=args.sections)
        except ValueError as exc:
            sys.exit(f"chapter-start: {exc}")
        _atomic_write(args.progress, progress)
        print(json.dumps(chapter))

    elif args.cmd == "chapter-advance":
        progress = _load_json(args.progress)
        try:
            chapter = chapter_advance(progress, section_index=args.section,
                                      status=args.status)
        except ValueError as exc:
            sys.exit(f"chapter-advance: {exc}")
        _atomic_write(args.progress, progress)
        print(json.dumps(chapter))

    elif args.cmd == "chapter-complete":
        progress = _load_json(args.progress)
        try:
            result = chapter_complete(progress)
        except ValueError as exc:
            sys.exit(f"chapter-complete: {exc}")
        _atomic_write(args.progress, progress)
        print(json.dumps(result))

    elif args.cmd == "set-qualitative":
        progress = _load_json(args.progress)
        try:
            result = set_qualitative(progress, kp_id=args.kp, kp_type=args.type,
                                     passed=args.passed)
        except ValueError as exc:
            sys.exit(f"set-qualitative: {exc}")
        _atomic_write(args.progress, progress)
        print(json.dumps(result))

    elif args.cmd == "validate-map":
        problems = validate_map(_load_json(args.course_map))
        if problems:
            print(json.dumps({"valid": False, "problems": problems}))
            sys.exit(1)
        print(json.dumps({"valid": True, "problems": []}))

    elif args.cmd == "init":
        print(json.dumps({"created": init_scaffold(args.repo_path, args.force)}))


def _load_json(path: str) -> dict:
    try:
        with open(path, encoding="utf-8") as fh:
            return json.load(fh)
    except (OSError, json.JSONDecodeError) as exc:
        sys.exit(f"cannot read {path}: {exc}")


def _atomic_write(path: str, data: dict) -> None:
    tmp = path + ".tmp"
    with open(tmp, "w", encoding="utf-8") as fh:
        json.dump(data, fh, ensure_ascii=False, indent=2)
    os.replace(tmp, path)


if __name__ == "__main__":
    main()
