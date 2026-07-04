#!/usr/bin/env python3
"""
dream.py — Memory Dream orchestrator for Postgres typed_memory stores.

Batch memory curation: read memory.typed_memory, mine recent
runtime activity, ask the LLM for reorganization proposals, stage the
proposals in memory.dream_proposals, then wait for human review
before any actual writeback to typed_memory.

This keeps the conservative review-before-apply discipline of
file-staged memory curation, but the data model is the live database
instead of markdown files.

Usage:
  dream.py run [--focus "text"] [--max-sessions N] [--max-age-days N]
              [--user-id ID] [--model MODEL] [--dry-run] [--no-llm]
  dream.py status
  dream.py proposals <run_id>            # list proposals for a run
  dream.py diff <run_id>                 # print diff markdown for a run
  dream.py adopt <run_id> [-y] [--min-confidence N]
  dream.py discard <run_id> [-y]
  dream.py runs [--limit N]              # list recent runs
"""

from __future__ import annotations

import argparse
import os
import sys
import time
import traceback
from pathlib import Path

# Make sibling modules importable when called directly (e.g. via launchd
# plist with cwd=/path/to/repo/skills/memory-dream).
SCRIPT_DIR = Path(__file__).resolve().parent
sys.path.insert(0, str(SCRIPT_DIR))

# Auto-load LLM_API_KEY from .env if not already set.
from _loadenv import load_api_key  # noqa: E402

import collector  # noqa: E402
import controller  # noqa: E402
import deduplicator  # noqa: E402
import diff  # noqa: E402
import parser  # noqa: E402
import synthesizer  # noqa: E402

DEFAULT_MODEL = os.environ.get("DREAM_MODEL", os.environ.get("LLM_MODEL", "deepseek-v4-flash"))
DEFAULT_ACTOR_ID = os.environ.get("ACTOR_ID", "u_owner")


def _sanitize_excerpt(text: str, max_chars: int = 600) -> str:
    """Sanitize session excerpt text before it enters the LLM prompt.

    Strips control characters (except newlines/tabs), escapes curly
    braces so user text cannot be interpreted as Python ``str.format()``
    placeholders, and truncates to ``max_chars``.
    """
    if not text:
        return ""
    # Keep printable chars, newlines, tabs; drop nulls and control chars.
    text = "".join(
        ch for ch in text
        if ch in ("\n", "\t") or (32 <= ord(ch) <= 126) or ord(ch) > 159
    )
    # Escape braces so they survive str.format() in the prompt template.
    text = text.replace("{", "{{").replace("}", "}}")
    return text[:max_chars]


# ---------------------------------------------------------------------------
# Subcommands
# ---------------------------------------------------------------------------


def cmd_run(args) -> int:
    """Run the full dream pipeline: parse -> collect -> synthesize -> stage."""
    user_id = args.user_id or DEFAULT_ACTOR_ID
    model = args.model or os.environ.get(
        "DREAM_MODEL", os.environ.get("LLM_MODEL", DEFAULT_MODEL),
    )

    # Pre-flight: are there already pending proposals from a previous
    # run for THIS user? ``pending_proposals_count`` accepts a
    # user_id kwarg; without it, another actor's pending proposals
    # would block this run.
    pending = controller.pending_proposals_count(
        user_id=user_id, database_url=args.database_url,
    )
    if pending > 0:
        print(
            f"WARNING:  {pending} proposal(s) from a previous run are still pending review."
        )
        print(
            "   Run `dream.py adopt <run_id>` to apply, "
            "`dream.py discard <run_id>` to drop, or"
        )
        print("   `dream.py runs` to find the run id.")
        return 1

    # 1. Read current store.
    print(f" Reading memory.typed_memory for user_id={user_id}")
    store = parser.parse_typed_memory(
        user_id=user_id,
        org_id=args.org_id,
        database_url=args.database_url,
    )
    print(f"   {store.entry_count} entries, {store.char_count} chars")

    # 2. Mine recent activity.
    print(f"\n Collecting runtime activity (last {args.max_age_days} days)…")
    digests = collector.collect_activity(
        user_id,
        max_age_days=args.max_age_days,
        max_sessions=args.max_sessions,
        max_total_chars=args.max_session_chars,
        database_url=args.database_url,
    )
    print(f"   {len(digests)} session digests, "
          f"{sum(d.char_count for d in digests)} chars total")
    if not digests:
        print("   (no recent sessions with extractable user text)")
    excerpts = "\n\n---\n\n".join(
        f"### Session {d.session_id}\n\n{_sanitize_excerpt(d.text)}" for d in digests
    ) or "(no sessions)"

    # 3. Pre-LLM dedup pass (so the LLM sees a smaller prompt).
    print("\n Pre-LLM dedup pass…")
    groups = deduplicator.find_all_dupes(
        store, include_semantic=False, database_url=args.database_url
    )
    print(f"   {len(groups)} lexical duplicate groups (semantic pass skipped)")

    if args.dry_run:
        # Show the prompt we'd send, then exit.
        prompt = synthesizer.build_prompt(
            store, excerpts, len(digests),
            sum(d.char_count for d in digests),
            instructions=args.focus,
        )
        print("\n DRY RUN — would call LLM with:")
        print(f"   prompt: {len(prompt)} chars (~{len(prompt) // 4} tokens)")
        print(f"   model:  {model}")
        return 0

    if args.no_llm:
        # Just dump dedup results, no LLM call.
        print(f"\n>>  --no-llm: skipped synthesis. {len(groups)} dedup groups to review manually.")
        for g in groups:
            print(f"   {g.reason} ({len(g.members)} entries) — canonical: "
                  f"{g.canonical.text[:60]}…")
        return 0

    # 4. LLM curation pass.
    load_api_key()
    print(f"\n Calling LLM ({model}) for synthesis pass…")
    run_id = controller.start_run(
        model=model,
        instructions=args.focus or "",
        user_id=user_id,
        database_url=args.database_url,
    )
    t0 = time.time()
    try:
        result = synthesizer.synthesize(
            store,
            excerpts,
            len(digests),
            sum(d.char_count for d in digests),
            instructions=args.focus,
            model=model,
        )
    except Exception as exc:  # noqa: BLE001 — intentional: route any failure to fail_run
        controller.fail_run(
            run_id, str(exc), user_id=user_id, database_url=args.database_url,
        )
        print(f"\nERROR: Synthesis failed: {exc}")
        traceback.print_exc()
        return 2

    elapsed = time.time() - t0
    print(f"   Done in {elapsed:.1f}s — {len(result.proposals)} proposals")
    if result.summary:
        print(f"   Summary: {result.summary}")

    # 5. Stage the proposals in memory.dream_proposals.
    # Wrap in try/except so any error in stage/finish transitions the
    # run to 'failed' instead of leaving it stuck in 'in_progress'
    # (which would block every subsequent run via the pre-flight check).
    try:
        inserted_ids = controller.stage_proposals(run_id, result, store, database_url=args.database_url)
        controller.finish_run(
            run_id,
            status="completed",
            rows_scanned=store.entry_count,
            proposals_count=len(inserted_ids),
            summary=result.summary,
            user_id=user_id,
            database_url=args.database_url,
        )
    except Exception as exc:  # noqa: BLE001 — intentional: route any failure to fail_run
        controller.fail_run(
            run_id, str(exc), user_id=user_id, database_url=args.database_url,
        )
        print(f"\nERROR: Staging failed: {exc}")
        traceback.print_exc()
        return 2

    print(f"\n Staged {len(inserted_ids)} proposal(s) for run {run_id}")
    print("\nNext steps:")
    print(f"   dream.py proposals {run_id}   # review the proposals")
    print(f"   dream.py diff {run_id}        # see the full diff as markdown")
    print(f"   dream.py adopt {run_id}       # apply the proposals (writes to typed_memory)")
    print(f"   dream.py discard {run_id}     # throw them away")
    return 0


def cmd_status(args) -> int:
    user_id = args.user_id or DEFAULT_ACTOR_ID
    s = controller.status(user_id=user_id, database_url=args.database_url)
    print("Memory Dream Status")
    print("=" * 40)
    print(f"Store size:        {s['store_size']} live rows")
    print(f"Superseded rows:   {s['superseded_count']}")
    print(f"Pending proposals: {s['pending_proposals']}")
    last = s.get("last_run")
    if last:
        print(f"\nLast run: {last.get('run_id')}")
        print(f"  started_at:  {last.get('started_at')}")
        print(f"  finished_at: {last.get('finished_at')}")
        print(f"  status:      {last.get('status')}")
        print(f"  model:       {last.get('model')}")
        print(f"  proposals:   {last.get('proposals_count')}")
        if last.get("summary"):
            print(f"  summary:     {last['summary'][:200]}")
    else:
        print("\n(no dream runs yet)")
    return 0


def cmd_proposals(args) -> int:
    user_id = args.user_id or DEFAULT_ACTOR_ID
    if args.allow_legacy_admin and not args.user_id:
        print("ERROR: --allow-legacy-admin requires an explicit --user-id.")
        return 1
    try:
        proposals = controller.list_proposals(
            args.run_id,
            include_reviewed=args.all,
            user_id=user_id,
            database_url=args.database_url,
            allow_legacy_admin=args.allow_legacy_admin,
        )
    except PermissionError as exc:
        print(f"ERROR: {exc}")
        return 1
    if not proposals:
        print(f"no proposals for run_id={args.run_id}")
        return 0

    for p in proposals:
        action = p["action"]
        confidence = float(p.get("confidence") or 0.0)
        review = p.get("reviewer_action") or "pending"
        row_id = p.get("row_id", "")
        old = (p.get("content") or "")[:80]
        print(f"  [{action:14s}] c={confidence:.2f} review={review:9s} "
              f"row_id={row_id[:8]}…  {old!r}")
        if action == "merge" and p.get("proposed_replacement"):
            print(f"      → {(p['proposed_replacement'] or '')[:80]!r}")
        if action == "supersede" and p.get("proposed_superseded_by_id"):
            print(f"      ← {p['proposed_superseded_by_id']}")
        if p.get("rationale"):
            print(f"       {p['rationale']}")
    print(f"\n{len(proposals)} proposal(s)")
    return 0


def cmd_diff(args) -> int:
    user_id = args.user_id or DEFAULT_ACTOR_ID
    if args.out:
        try:
            byte_count = diff.write_diff(
                args.run_id,
                args.out,
                user_id=user_id,
                database_url=args.database_url,
            )
        except ValueError as exc:
            print(f"ERROR: {exc}")
            return 1
        print(f"wrote {args.out} ({byte_count} bytes)")
    else:
        md = diff.generate_diff_markdown(
            args.run_id, user_id=user_id, database_url=args.database_url,
        )
        sys.stdout.write(md)
    return 0


def cmd_adopt(args) -> int:
    user_id = args.user_id or DEFAULT_ACTOR_ID
    if args.allow_legacy_admin and not args.user_id:
        print("ERROR: --allow-legacy-admin requires an explicit --user-id.")
        return 1
    if not args.yes:
        try:
            pending = controller.pending_proposals_count(
                run_id=args.run_id,
                user_id=user_id,
                database_url=args.database_url,
                allow_legacy_admin=args.allow_legacy_admin,
            )
        except PermissionError as exc:
            print(f"ERROR: {exc}")
            return 1
        if pending == 0:
            print(f"no pending proposals for run_id={args.run_id}")
            return 1
        print(f"This will apply {pending} proposal(s) to memory.typed_memory.")
        print("Each proposal writes an entry to memory.audit_log.")
        try:
            resp = input("Proceed? [y/N] ").strip().lower()
        except EOFError:
            print("Aborted: confirmation required in non-interactive mode. Re-run with --yes.")
            return 1
        if resp != "y":
            print("Aborted.")
            return 1

    result = controller.adopt_run(
        args.run_id,
        min_confidence=args.min_confidence,
        actor_id=args.actor_id,
        user_id=user_id,
        database_url=args.database_url,
        allow_legacy_admin=args.allow_legacy_admin,
    )
    print(f" Adopted {result.adopted}, rejected {result.rejected}, "
          f"skipped {result.skipped}")
    if result.errors:
        print(f"WARNING:  Errors: {result.errors}")
    return 0 if not result.errors else 1


def cmd_discard(args) -> int:
    user_id = args.user_id or DEFAULT_ACTOR_ID
    if args.allow_legacy_admin and not args.user_id:
        print("ERROR: --allow-legacy-admin requires an explicit --user-id.")
        return 1
    if not args.yes:
        try:
            pending = controller.pending_proposals_count(
                run_id=args.run_id,
                user_id=user_id,
                database_url=args.database_url,
                allow_legacy_admin=args.allow_legacy_admin,
            )
        except PermissionError as exc:
            print(f"ERROR: {exc}")
            return 1
        if pending == 0:
            print(f"no pending proposals for run_id={args.run_id}")
            return 1
        try:
            resp = input(f"Discard {pending} proposal(s)? [y/N] ").strip().lower()
        except EOFError:
            print("Aborted: confirmation required in non-interactive mode. Re-run with --yes.")
            return 1
        if resp != "y":
            print("Aborted.")
            return 1
    try:
        n = controller.discard_run(
            args.run_id,
            user_id=user_id,
            database_url=args.database_url,
            allow_legacy_admin=args.allow_legacy_admin,
        )
    except PermissionError as exc:
        print(f"ERROR: {exc}")
        return 1
    print(f" Discarded {n} proposal(s)")
    return 0


def cmd_runs(args) -> int:
    import psycopg
    from psycopg.rows import dict_row
    url = args.database_url or os.environ.get("DATABASE_URL", "postgresql:///agent_memory")
    with psycopg.connect(url, row_factory=dict_row) as conn:
        rows = conn.execute(
            """
            select run_id, started_at, finished_at, status, model,
                   rows_scanned, proposals_count, adopted_count,
                   rejected_count, skipped_count, summary
            from memory.dream_runs
            order by started_at desc
            limit %s
            """,
            (args.limit,),
        ).fetchall()
    if not rows:
        print("no dream runs")
        return 0
    for r in rows:
        print(
            f"  {r['run_id']}  {r['started_at']}  "
            f"status={r['status']:9s}  proposals={r['proposals_count']:3d}  "
            f"adopted={r.get('adopted_count') or 0:3d}  "
            f"rejected={r.get('rejected_count') or 0:3d}  "
            f"skipped={r.get('skipped_count') or 0:3d}  "
            f"model={r.get('model') or '?'}"
        )
        if r.get("summary"):
            print(f"      {r['summary'][:100]}")
    return 0


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------


def main() -> int:
    # Note: local var is named `ap` so it does not shadow the imported
    # `parser` module (sibling: parser.parse_typed_memory). The local
    # p_run / p_status / etc. are subparser objects.
    ap = argparse.ArgumentParser(
        prog="dream",
        description="Memory Dream: batch memory curation for typed_memory",
    )
    ap.add_argument(
        "--database-url", help="Override $DATABASE_URL",
    )
    sub = ap.add_subparsers(dest="cmd", required=True)

    p_run = sub.add_parser("run", help="Run the dream pipeline")
    p_run.add_argument("--user-id", help=f"User to curate (default: $ACTOR_ID or {DEFAULT_ACTOR_ID})")
    p_run.add_argument("--org-id", help="Optional org scope")
    p_run.add_argument(
        "--focus", help="Optional instructions to steer the LLM curation pass",
    )
    p_run.add_argument("--max-sessions", type=int, default=30)
    p_run.add_argument("--max-age-days", type=int, default=90)
    p_run.add_argument("--max-session-chars", type=int, default=50000)
    p_run.add_argument("--model", default=DEFAULT_MODEL)
    p_run.add_argument("--dry-run", action="store_true")
    p_run.add_argument("--no-llm", action="store_true",
                       help="Skip LLM, just run pre-LLM dedup")
    p_run.set_defaults(func=cmd_run)

    p_status = sub.add_parser("status", help="Show store and run summary")
    p_status.add_argument("--user-id", help=f"User to inspect (default: $ACTOR_ID or {DEFAULT_ACTOR_ID})")
    p_status.set_defaults(func=cmd_status)

    p_prop = sub.add_parser("proposals", help="List proposals for a run")
    p_prop.add_argument("run_id")
    p_prop.add_argument("--user-id", help=f"Expected run owner (default: $ACTOR_ID or {DEFAULT_ACTOR_ID})")
    p_prop.add_argument("--all", action="store_true",
                        help="Include already-reviewed proposals")
    p_prop.add_argument(
        "--allow-legacy-admin",
        action="store_true",
        help="Allow review of legacy/admin dream_runs with a null owner; proposals stay scoped to --user-id",
    )
    p_prop.set_defaults(func=cmd_proposals)

    p_diff = sub.add_parser("diff", help="Print diff markdown for a run")
    p_diff.add_argument("run_id")
    p_diff.add_argument("--user-id", help=f"Expected run owner (default: $ACTOR_ID or {DEFAULT_ACTOR_ID})")
    p_diff.add_argument("--out", help="Write to file instead of stdout")
    p_diff.set_defaults(func=cmd_diff)

    p_adopt = sub.add_parser("adopt", help="Apply run proposals to typed_memory")
    p_adopt.add_argument("run_id")
    p_adopt.add_argument("-y", "--yes", action="store_true")
    p_adopt.add_argument("--min-confidence", type=float, default=0.0)
    p_adopt.add_argument("--actor-id", help="Override actor for audit_log")
    p_adopt.add_argument("--user-id", help=f"Expected run owner (default: $ACTOR_ID or {DEFAULT_ACTOR_ID})")
    p_adopt.add_argument(
        "--allow-legacy-admin",
        action="store_true",
        help="Allow review of legacy/admin dream_runs with a null owner; proposals stay scoped to --user-id",
    )
    p_adopt.set_defaults(func=cmd_adopt)

    p_disc = sub.add_parser("discard", help="Reject all pending proposals in a run")
    p_disc.add_argument("run_id")
    p_disc.add_argument("-y", "--yes", action="store_true")
    p_disc.add_argument("--user-id", help=f"Expected run owner (default: $ACTOR_ID or {DEFAULT_ACTOR_ID})")
    p_disc.add_argument(
        "--allow-legacy-admin",
        action="store_true",
        help="Allow review of legacy/admin dream_runs with a null owner; proposals stay scoped to --user-id",
    )
    p_disc.set_defaults(func=cmd_discard)

    p_runs = sub.add_parser("runs", help="List recent dream runs")
    p_runs.add_argument("--limit", type=int, default=10)
    p_runs.set_defaults(func=cmd_runs)

    args = ap.parse_args()
    return args.func(args)


if __name__ == "__main__":
    sys.exit(main())
