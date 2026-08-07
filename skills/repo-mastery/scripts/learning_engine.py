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
    next-objective <progress.json>              what the tutor should do next
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
    """Advance a repetition state per the interval sequence for *kp_type*.

    Correct: consecutive_correct += 1; two in a row → interval_index +2.
    Wrong:   consecutive_wrong += 1; interval_index steps back 1 (floor 0).
    Returns the new state dict with next_review_at in Unix seconds.
    """
    intervals = INTERVAL_SEQUENCES.get(kp_type, INTERVAL_SEQUENCES["memory"])
    max_index = len(intervals) - 1
    state = dict(state)
    state.setdefault("interval_index", 0)
    state.setdefault("consecutive_correct", 0)
    state.setdefault("consecutive_wrong", 0)

    if is_correct:
        state["consecutive_wrong"] = 0
        state["consecutive_correct"] += 1
        if state["consecutive_correct"] >= 2:
            state["interval_index"] += 2
            state["consecutive_correct"] = 0
        else:
            state["interval_index"] += 1
    else:
        state["consecutive_wrong"] += 1
        state["consecutive_correct"] = 0
        state["interval_index"] = max(0, state["interval_index"] - 1)
        if state["consecutive_wrong"] >= 2:
            state["consecutive_wrong"] = 0

    state["interval_index"] = max(0, min(state["interval_index"], max_index))
    days = intervals[state["interval_index"]]
    state["next_review_at"] = int(time.time()) + days * 86400
    return state


def is_mastered(progress: dict, kp_id: str, kp_type: str) -> bool:
    """Whether a knowledge point clears its gate (quantitative or qualitative)."""
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


def next_objective(progress: dict, *, now: int | None = None) -> dict:
    """Decide the next thing to work on. The gate IS the cursor:
    advancement is computed from what is mastered, never a stage counter.

    Precedence: 1) pending question  2) due spaced review  3) first
    unmastered point (probe / practice / assess)  4) complete.
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

    # 2) due spaced-repetition reviews.
    due = [t for t in progress.get("review_queue", []) if t.get("due_at", 0) <= now]
    due.sort(key=lambda t: t.get("priority", 99))
    if due:
        task = due[0]
        kp = _find(kps, task.get("knowledge_point_id"))
        return {
            "action": "review",
            "knowledge_point_id": task.get("knowledge_point_id"),
            "knowledge_point_type": kp["type"] if kp else "",
            "reason": "This objective is due for spaced-repetition review.",
        }

    # 3) first unmastered point in module order, then knowledge-point order.
    error_kps = {
        e.get("knowledge_point_id") for e in progress.get("error_records", [])
        if e.get("status") in ("active", "retrying")
    }
    for module in sorted(progress.get("modules", []), key=lambda m: m.get("order", 0)):
        for kp in module.get("knowledge_points", []):
            kp_id, kp_type = kp.get("id"), kp.get("type", "concept")
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

    # 4) done.
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
        print(json.dumps(next_objective(progress)))

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
