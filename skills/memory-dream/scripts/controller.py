"""
controller.py — Manage the dream staging tables and adopt / discard
operations.

In file-staged memory systems, staging is a directory on disk holding
review files. Here, staging is two Postgres tables:

  - ``memory.dream_runs``      — one row per dream.py invocation
                                 (started_at, finished_at, model, summary,
                                 status, instructions)
  - ``memory.dream_proposals`` — one row per (run, typed_memory row)
                                 with the action, the optional replacement
                                 text or replacement row_id, the model's
                                 confidence, and the human's
                                 reviewer_action (``adopted`` / ``rejected``)

On ``adopt``, every proposal whose ``reviewer_action`` is null is
processed in a single transaction:

  - ``keep``         — no-op
  - ``merge``        — UPDATE the row's content to the proposed_replacement,
                       lower the confidence by 0.1 to mark the rewrite
  - ``supersede``    — UPDATE the loser's ``superseded_by`` to point at
                       the winner, INSERT a ``supersedes`` edge into
                       ``memory.memory_edges`` for the graph layer
  - ``archive``      — UPDATE the row to set ``expires_at = now() + 30d``
                       so the TTL cleanup picks it up
  - ``flag_for_review`` — UPDATE the row to add a ``metadata.dream_flag``
                          jsonb entry; the next notify_review.py will
                          surface it

Every write also emits a ``memory_written`` row into ``memory.audit_log``
with ``details`` describing what changed and which dream run triggered
it. That keeps the audit chain intact.
"""

from __future__ import annotations

import os
from collections.abc import Iterable
from dataclasses import dataclass
from uuid import uuid4

from parser import ParsedStore
from synthesizer import Proposal, SynthesisResult

DEFAULT_DATABASE_URL = "postgresql:///agent_memory"


def _connect(database_url: str | None = None):
    url = database_url or os.environ.get("DATABASE_URL", DEFAULT_DATABASE_URL)
    import psycopg
    from psycopg.rows import dict_row

    return psycopg.connect(url, row_factory=dict_row)


def _set_session_context(conn, user_id: str | None = None) -> None:
    conn.execute("select set_config('app.current_role', 'service', false)")
    if user_id:
        conn.execute("select set_config('app.current_user', %s, false)", (user_id,))


# ---------------------------------------------------------------------------
# Run lifecycle
# ---------------------------------------------------------------------------


def stage_proposals(
    run_id: str,
    result: SynthesisResult,
    store: ParsedStore,
    *,
    database_url: str | None = None,
) -> list[str]:
    """
    Insert one dream_proposals row per LLM proposal. Returns the list
    of inserted proposal ids (as strings).

    Validates that every ``row_id`` exists in ``store.entries`` and that
    ``proposed_superseded_by_id`` (if present) is also in the store.
    Invalid proposals are silently dropped — better to skip a bad
    proposal than to surface a hallucinated row_id to the user.
    """
    valid_ids = {e.row_id for e in store.entries}

    with _connect(database_url) as conn:
        _set_session_context(conn, store.user_id)
        staged_by_row: dict[str, str] = {}
        with conn.transaction():
            for p in result.proposals:
                if p.row_id not in valid_ids:
                    continue
                if p.action == "supersede":
                    if (
                        not p.proposed_superseded_by_id
                        or p.proposed_superseded_by_id not in valid_ids
                    ):
                        continue
                elif p.action == "merge":
                    if not p.proposed_replacement:
                        continue
                row = conn.execute(
                    """
                    insert into memory.dream_proposals
                        (run_id, row_id, action, proposed_replacement,
                         proposed_superseded_by_id, confidence, rationale)
                    values (%s, %s, %s, %s, %s, %s, %s)
                    on conflict (run_id, row_id) do update
                        set action = excluded.action,
                            proposed_replacement = excluded.proposed_replacement,
                            proposed_superseded_by_id = excluded.proposed_superseded_by_id,
                            confidence = excluded.confidence,
                            rationale = excluded.rationale
                    returning id
                    """,
                    (
                        run_id,
                        p.row_id,
                        p.action,
                        p.proposed_replacement,
                        p.proposed_superseded_by_id,
                        p.confidence,
                        p.rationale,
                    ),
                ).fetchone()
                staged_by_row[p.row_id] = str(row["id"])
            conn.execute(
                "update memory.dream_runs set proposals_count = %s where run_id = %s",
                (len(staged_by_row), run_id),
            )
        return list(staged_by_row.values())


def latest_run(
    *,
    status_filter: str | None = None,
    user_id: str | None = None,
    database_url: str | None = None,
) -> dict | None:
    """Return the most recent dream_runs row as a dict, or None.

    The more thorough version of this function is defined further
    down in this file; this top-of-file version exists for callers
    that want to filter by status (e.g. "most recent completed run").

    When ``user_id`` is provided, the lookup is restricted to runs
    with that user_id. If the database has no matching rows, this
    function returns ``None`` rather than returning a misattributed
    run from another actor. The ``status_filter`` argument is
    unchanged from before.
    """
    with _connect(database_url) as conn:
        _set_session_context(conn, user_id)
        params: list = []
        clauses: list[str] = []
        if status_filter:
            clauses.append("status = %s")
            params.append(status_filter)
        if user_id is not None:
            clauses.append("user_id = %s")
            params.append(user_id)
        where = (" where " + " and ".join(clauses)) if clauses else ""
        row = conn.execute(
            f"select * from memory.dream_runs{where} "  # noqa: S608
            f"order by started_at desc limit 1",
            params,
        ).fetchone()
        return dict(row) if row else None


def finish_run(
    run_id: str,
    *,
    status: str,
    rows_scanned: int = 0,
    proposals_count: int = 0,
    summary: str | None = None,
    error_message: str | None = None,
    user_id: str | None = None,
    database_url: str | None = None,
) -> None:
    """Mark a dream_runs row finished (completed / failed / discarded)."""
    with _connect(database_url) as conn:
        _set_session_context(conn, user_id)
        conn.execute(
            """
            update memory.dream_runs
            set finished_at = now(),
                status = %s,
                rows_scanned = %s,
                proposals_count = %s,
                summary = %s,
                error_message = %s
            where run_id = %s
            """,
            (
                status,
                rows_scanned,
                proposals_count,
                summary or "",
                error_message or "",
                run_id,
            ),
        )
        conn.commit()


def has_pending_staging(*, database_url: str | None = None) -> bool:
    """True if there's at least one dream_proposal awaiting review."""
    return pending_proposals_count(database_url=database_url) > 0


# ---------------------------------------------------------------------------
# Adopt / discard
# ---------------------------------------------------------------------------


@dataclass
class AdoptResult:
    adopted: int
    rejected: int
    skipped: int
    errors: list[str]


def _resolve_actor_user(user_id: str | None = None) -> str:
    return user_id or os.environ.get("ACTOR_ID", "u_owner")


def _run_is_owned_by(conn, run_id: str, user_id: str) -> bool:
    row = conn.execute(
        """
        select 1
        from memory.dream_runs
        where run_id = %s
          and user_id = %s
        """,
        (run_id, user_id),
    ).fetchone()
    return row is not None


def _legacy_admin_enabled(allow_legacy_admin: bool = False) -> bool:
    return allow_legacy_admin


def _service_authority_available(conn) -> bool:
    row = conn.execute(
        "select memory.is_service_role() as is_service_role",
    ).fetchone()
    return bool(row and row["is_service_role"])


def _assert_legacy_admin_authority(conn) -> None:
    if not _service_authority_available(conn):
        raise PermissionError(
            "legacy admin review requires a trusted database service role",
        )


def _get_run_owner(
    conn,
    run_id: str,
) -> str | None | object:
    row = conn.execute(
        """
        select user_id
        from memory.dream_runs
        where run_id = %s
        """,
        (run_id,),
    ).fetchone()
    if row is None:
        return _MISSING
    return row["user_id"]


_MISSING = object()


def _authorize_run(
    conn,
    run_id: str,
    user_id: str,
    *,
    allow_legacy_admin: bool = False,
) -> tuple[bool, bool]:
    owner = _get_run_owner(conn, run_id)
    if owner is _MISSING:
        return False, False
    if owner == user_id:
        return True, False
    if owner is None and _legacy_admin_enabled(allow_legacy_admin):
        _assert_legacy_admin_authority(conn)
        return True, True
    return False, False


def _run_has_pending_proposals(conn, run_id: str) -> bool:
    row = conn.execute(
        """
        select 1
        from memory.dream_proposals
        where run_id = %s
          and reviewer_action is null
        limit 1
        """,
        (run_id,),
    ).fetchone()
    return row is not None


def discard_run(
    run_id: str,
    *,
    user_id: str | None = None,
    database_url: str | None = None,
    allow_legacy_admin: bool = False,
) -> int:
    """Mark all unreviewed proposals in the run as ``rejected``.

    Does not touch typed_memory. Returns the count of proposals
    marked rejected.
    """
    expected_user = _resolve_actor_user(user_id)
    legacy_admin = _legacy_admin_enabled(allow_legacy_admin)
    with _connect(database_url) as conn:
        _set_session_context(conn, expected_user)
        authorized, legacy_nullable_run = _authorize_run(
            conn,
            run_id,
            expected_user,
            allow_legacy_admin=legacy_admin,
        )
        if not authorized:
            raise PermissionError(
                f"run {run_id} is not authorized for user_id={expected_user}"
            )
        if legacy_nullable_run:
            row = conn.execute(
                """
                update memory.dream_proposals
                set reviewer_action = 'rejected',
                    reviewed_at = now()
                where run_id = %s
                  and reviewer_action is null
                  and exists (
                      select 1
                      from memory.typed_memory m
                      where m.id = dream_proposals.row_id
                        and m.user_id = %s
                  )
                returning id
                """,
                (run_id, expected_user),
            ).fetchall()
        else:
            row = conn.execute(
                """
                update memory.dream_proposals
                set reviewer_action = 'rejected',
                    reviewed_at = now()
                where run_id = %s
                  and reviewer_action is null
                  and exists (
                      select 1
                      from memory.dream_runs r
                      join memory.typed_memory m on m.id = dream_proposals.row_id
                      where r.run_id = dream_proposals.run_id
                        and m.user_id = %s
                        and r.user_id = %s
                  )
                returning id
                """,
                (run_id, expected_user, expected_user),
            ).fetchall()
        if not _run_has_pending_proposals(conn, run_id):
            conn.execute(
                "update memory.dream_runs set status = 'discarded', finished_at = now() "
                "where run_id = %s "
                "and (user_id = %s or (user_id is null and %s)) "
                "and status not in ('discarded', 'failed')",
                (run_id, expected_user, legacy_admin),
            )
        conn.commit()
        return len(row)


def adopt_run(
    run_id: str,
    *,
    min_confidence: float = 0.0,
    proposal_ids: Iterable[str] | None = None,
    actor_id: str | None = None,
    user_id: str | None = None,
    database_url: str | None = None,
    allow_legacy_admin: bool = False,
) -> AdoptResult:
    """
    Apply a run's proposals in a single transaction. If anything
    fails, the entire batch is rolled back — typed_memory and
    memory_edges never see a partial state.

    Args:
        run_id:           The dream_runs.run_id to apply.
        min_confidence:   Skip proposals whose confidence is below
                          this threshold. Default 0.0 (apply all).
        proposal_ids:     Optional subset of proposal ids to apply.
                          If None, all unreviewed proposals in the run
                          are considered.
        actor_id:         The actor to record in memory.audit_log.
                          Defaults to ``$ACTOR_ID`` or ``"system:dream"``.
        user_id:          The expected dream_runs.user_id owner. Defaults
                          to ``$ACTOR_ID`` or ``"u_owner"``.
    """
    expected_user = _resolve_actor_user(user_id)
    actor = actor_id or expected_user
    legacy_admin = _legacy_admin_enabled(allow_legacy_admin)

    adopted = 0
    rejected = 0
    skipped = 0
    errors: list[str] = []

    with _connect(database_url) as conn:
        _set_session_context(conn, expected_user)
        try:
            authorized, legacy_nullable_run = _authorize_run(
                conn,
                run_id,
                expected_user,
                allow_legacy_admin=legacy_admin,
            )
        except PermissionError as exc:
            return AdoptResult(
                adopted=0,
                rejected=0,
                skipped=0,
                errors=[str(exc)],
            )
        if not authorized:
            return AdoptResult(
                adopted=0,
                rejected=0,
                skipped=0,
                errors=[f"run {run_id} is not authorized for user_id={expected_user}"],
            )
        try:
            with conn.transaction():
                # Lock the proposals we're about to apply.
                if proposal_ids is not None:
                    pid_list = list(proposal_ids)
                    if legacy_nullable_run:
                        proposals = conn.execute(
                            """
                            select p.*, m.user_id, m.memory_type, m.category, m.content
                            from memory.dream_proposals p
                            join memory.typed_memory m on m.id = p.row_id
                            where p.run_id = %s
                              and p.id = ANY(%s::uuid[])
                              and m.user_id = %s
                              and p.reviewer_action is null
                            for update
                            """,
                            (run_id, pid_list, expected_user),
                        ).fetchall()
                    else:
                        proposals = conn.execute(
                            """
                            select p.*, m.user_id, m.memory_type, m.category, m.content
                            from memory.dream_proposals p
                            join memory.typed_memory m on m.id = p.row_id
                            where p.run_id = %s
                              and p.id = ANY(%s::uuid[])
                              and m.user_id = %s
                              and p.reviewer_action is null
                              and exists (
                                  select 1
                                  from memory.dream_runs r
                                  where r.run_id = p.run_id
                                    and r.user_id = %s
                              )
                            for update
                            """,
                            (run_id, pid_list, expected_user, expected_user),
                        ).fetchall()
                else:
                    if legacy_nullable_run:
                        proposals = conn.execute(
                            """
                            select p.*, m.user_id, m.memory_type, m.category, m.content
                            from memory.dream_proposals p
                            join memory.typed_memory m on m.id = p.row_id
                            where p.run_id = %s
                              and m.user_id = %s
                              and p.reviewer_action is null
                            for update
                            """,
                            (run_id, expected_user),
                        ).fetchall()
                    else:
                        proposals = conn.execute(
                            """
                            select p.*, m.user_id, m.memory_type, m.category, m.content
                            from memory.dream_proposals p
                            join memory.typed_memory m on m.id = p.row_id
                            where p.run_id = %s
                              and m.user_id = %s
                              and p.reviewer_action is null
                              and exists (
                                  select 1
                                  from memory.dream_runs r
                                  where r.run_id = p.run_id
                                    and r.user_id = %s
                              )
                            for update
                            """,
                            (run_id, expected_user, expected_user),
                        ).fetchall()

                for prop in proposals:
                    confidence = float(prop["confidence"])
                    if confidence < min_confidence:
                        # Skipped (low confidence) — not adopted. The
                        # proposal row is marked rejected in storage
                        # for audit, so the run-level ``rejected``
                        # counter must also increment (otherwise
                        # ``rejected_count`` would underreport the
                        # actual number of rejected proposal rows).
                        # ``skipped`` tracks the subset that did not
                        # execute an apply helper.
                        skipped += 1
                        rejected += 1
                        _mark_proposal(conn, prop["id"], "rejected",
                                       rationale_extra=f"skipped: confidence {confidence:.2f} < {min_confidence}")
                        continue

                    action = prop["action"]

                    if action == "keep":
                        _mark_proposal(conn, prop["id"], "adopted")
                        _audit(conn, actor, prop["row_id"], "memory_read",
                               {"dream_action": "keep", "run_id": run_id})
                        adopted += 1

                    elif action == "merge":
                        _apply_merge(conn, prop, actor, run_id)
                        _mark_proposal(conn, prop["id"], "adopted")
                        adopted += 1

                    elif action == "supersede":
                        _apply_supersede(conn, prop, actor, run_id)
                        _mark_proposal(conn, prop["id"], "adopted")
                        adopted += 1

                    elif action == "archive":
                        _apply_archive(conn, prop, actor, run_id)
                        _mark_proposal(conn, prop["id"], "adopted")
                        adopted += 1

                    elif action == "flag_for_review":
                        _apply_flag(conn, prop, actor, run_id)
                        _mark_proposal(conn, prop["id"], "adopted")
                        adopted += 1

                    else:
                        # Unknown action — same accounting as the
                        # low-confidence branch: the proposal row is
                        # rejected in storage, so both ``skipped`` and
                        # ``rejected`` increment.
                        skipped += 1
                        rejected += 1
                        _mark_proposal(conn, prop["id"], "rejected",
                                       rationale_extra=f"unknown action: {action}")

                # Update run counters. ``rejected_count`` reflects the
                # number of proposal rows whose ``reviewer_action`` is
                # 'rejected' (includes the skipped-by-confidence and
                # unknown-action paths, which are also marked rejected
                # in storage for audit). ``skipped_count`` is the
                # count of proposals that did NOT execute an apply
                # helper (low confidence or unknown action); it is a
                # strict subset of ``rejected_count``.
                if _run_has_pending_proposals(conn, run_id):
                    conn.execute(
                        """
                        update memory.dream_runs
                        set adopted_count = adopted_count + %s,
                            rejected_count = rejected_count + %s,
                            skipped_count = skipped_count + %s
                        where run_id = %s
                        """,
                        (adopted, rejected, skipped, run_id),
                    )
                else:
                    conn.execute(
                        """
                        update memory.dream_runs
                        set status = 'completed',
                            finished_at = now(),
                            adopted_count = adopted_count + %s,
                            rejected_count = rejected_count + %s,
                            skipped_count = skipped_count + %s
                        where run_id = %s
                        """,
                        (adopted, rejected, skipped, run_id),
                    )
                return AdoptResult(adopted=adopted, rejected=rejected, skipped=skipped, errors=errors)
        except Exception as exc:
            message = str(exc)
            errors.append(message)
            conn.execute(
                """
                update memory.dream_runs
                set status = 'failed',
                    finished_at = now(),
                    error_message = %s
                where run_id = %s
                """,
                (message[:2000], run_id),
            )
            conn.commit()
            return AdoptResult(adopted=adopted, rejected=rejected, skipped=skipped, errors=errors)


# ---------------------------------------------------------------------------
# Per-action writeback helpers (run inside the adopt transaction)
# ---------------------------------------------------------------------------


def _mark_proposal(conn, proposal_id, action, *, rationale_extra: str = "") -> None:
    conn.execute(
        """
        update memory.dream_proposals
        set reviewer_action = %s,
            reviewed_at = now()
        where id = %s
        """,
        (action, proposal_id),
    )


def _audit(conn, actor, target_id, event_type, details: dict) -> None:
    from psycopg.types.json import Jsonb

    conn.execute(
        """
        insert into memory.audit_log
            (event_type, user_id, target_id, details)
        values (%s, %s, %s, %s)
        """,
        (event_type, actor, target_id, Jsonb(details)),
    )


def _apply_merge(conn, prop, actor, run_id) -> None:
    """Replace the row's content with proposed_replacement.

    We do NOT delete the row — we update its ``content`` and lower
    ``confidence`` by 0.1 to mark the rewrite. The row keeps its
    original ``id`` so any edges / audit history that point to it
    stay valid.
    """
    new_text = (prop["proposed_replacement"] or "").strip()
    if not new_text:
        raise ValueError(f"merge proposal {prop['id']} has empty proposed_replacement")
    conn.execute(
        """
        update memory.typed_memory
        set content = %s,
            confidence = greatest(confidence - 0.1, 0.0),
            updated_at = now(),
            metadata = metadata || jsonb_build_object('dream_merged_at', now(),
                                                     'dream_run_id', %s::text)
        where id = %s
        """,
        (new_text, run_id, prop["row_id"]),
    )
    _audit(conn, actor, prop["row_id"], "memory_updated", {
        "dream_action": "merge",
        "run_id": run_id,
        "old_text_preview": (prop["content"] or "")[:120],
        "new_text_preview": new_text[:120],
    })


def _apply_supersede(conn, prop, actor, run_id) -> None:
    """Mark the loser row as superseded by the winner.

    Loser:  ``superseded_by`` set, ``confidence`` halved.
    Winner: ``confidence`` boosted by 0.05 (capped at 1.0).
    Edge:   a ``supersedes`` row in ``memory.memory_edges``
            (source_id = winner, target_id = loser).
    """
    winner_id = prop["proposed_superseded_by_id"]
    loser_id = prop["row_id"]
    if not winner_id:
        raise ValueError(f"supersede proposal {prop['id']} missing proposed_superseded_by_id")
    if winner_id == loser_id:
        raise ValueError(f"supersede proposal {prop['id']} self-references")

    # Validate the winner before mutating anything. The proposal is
    # LLM-generated and could be tampered with or refer to a row that
    # no longer exists. We require the winner to (a) still exist, (b)
    # belong to the same user, and (c) match the loser's
    # memory_type/category so a semantic supersede stays semantically
    # scoped. Use FOR UPDATE to lock the row for the transaction.
    winner_row = conn.execute(
        """
        select user_id, memory_type, category
        from memory.typed_memory
        where id = %s
          and superseded_by is null
        for update
        """,
        (winner_id,),
    ).fetchone()
    if winner_row is None:
        raise ValueError(
            f"supersede proposal {prop['id']}: winner row {winner_id} "
            f"missing or already retired"
        )
    if winner_row["user_id"] != prop["user_id"]:
        raise ValueError(
            f"supersede proposal {prop['id']}: winner {winner_id} "
            f"belongs to a different user_id"
        )
    if (
        winner_row["memory_type"] != prop["memory_type"]
        or winner_row["category"] != prop["category"]
    ):
        raise ValueError(
            f"supersede proposal {prop['id']}: winner {winner_id} "
            f"has different memory_type/category than the loser"
        )

    # Loser
    conn.execute(
        """
        update memory.typed_memory
        set superseded_by = %s,
            confidence = confidence * 0.5,
            updated_at = now(),
            metadata = metadata || jsonb_build_object('dream_superseded_at', now(),
                                                     'dream_run_id', %s::text)
        where id = %s
        """,
        (winner_id, run_id, loser_id),
    )
    # Winner
    conn.execute(
        """
        update memory.typed_memory
        set confidence = least(confidence + 0.05, 1.0),
            updated_at = now(),
            metadata = metadata || jsonb_build_object('dream_supersede_target_at', now(),
                                                     'dream_run_id', %s::text)
        where id = %s
        """,
        (run_id, winner_id),
    )
    # Edge — use the typed_memory ids as edge endpoint strings.
    # (memory_edges.source_id / target_id are text in the schema.)
    conn.execute(
        """
        insert into memory.memory_edges
            (source_id, target_id, edge_type, weight, created_by, metadata)
        values (%s, %s, 'supersedes', 1.0, 'agent_inference',
                jsonb_build_object('dream_run_id', %s::text, 'loser_row_id', %s::text))
        on conflict (source_id, target_id, edge_type) do update
            set weight = least(memory_edges.weight + 0.1, 1.0)
        """,
        (str(winner_id), str(loser_id), run_id, str(loser_id)),
    )
    _audit(conn, actor, loser_id, "memory_updated", {
        "dream_action": "supersede",
        "run_id": run_id,
        "loser_row_id": str(loser_id),
        "winner_row_id": str(winner_id),
    })


def _apply_archive(conn, prop, actor, run_id) -> None:
    """Set ``expires_at`` to 30 days from now so the TTL cleanup
    eventually removes the row. The row stays live until then so
    existing retrievals don't break — it just stops surfacing in
    active retrieval after expiry.
    """
    conn.execute(
        """
        update memory.typed_memory
        set expires_at = now() + interval '30 days',
            updated_at = now(),
            metadata = metadata || jsonb_build_object('dream_archived_at', now(),
                                                     'dream_run_id', %s::text)
        where id = %s
        """,
        (run_id, prop["row_id"]),
    )
    _audit(conn, actor, prop["row_id"], "memory_updated", {
        "dream_action": "archive",
        "run_id": run_id,
    })


def _apply_flag(conn, prop, actor, run_id) -> None:
    """Mark the row for human review by adding a metadata flag. The
    next notify_review.py run will surface it in the Telegram digest.
    """
    conn.execute(
        """
        update memory.typed_memory
        set metadata = metadata || jsonb_build_object('dream_flag',
            jsonb_build_object('flagged_at', now(), 'run_id', %s::text,
                              'rationale', %s::text)),
            updated_at = now()
        where id = %s
        """,
        (run_id, prop["rationale"] or "", prop["row_id"]),
    )
    _audit(conn, actor, prop["row_id"], "memory_updated", {
        "dream_action": "flag_for_review",
        "run_id": run_id,
        "rationale": prop["rationale"] or "",
    })


# ---------------------------------------------------------------------------
# Status / introspection
# ---------------------------------------------------------------------------


def status(*, user_id: str | None = None, database_url: str | None = None) -> dict:
    """Return current store size, pending proposals count, last run info.

    All counts are scoped to ``user_id`` when provided so a multi-actor
    store doesn't leak cross-user operational metadata. When
    ``user_id`` is set, ``last_run`` is filtered by the persisted
    ``user_id`` column on ``memory.dream_runs``; if no user-scoped
    run exists, ``last_run`` is omitted rather than returning a
    misattributed row from another actor.
    """
    with _connect(database_url) as conn:
        _set_session_context(conn, user_id)
        if user_id is not None:
            store_count = conn.execute(
                "select count(*) as n from memory.typed_memory "
                "where superseded_by is null and user_id = %s",
                (user_id,),
            ).fetchone()["n"]
            superseded_count = conn.execute(
                "select count(*) as n from memory.typed_memory "
                "where superseded_by is not null and user_id = %s",
                (user_id,),
            ).fetchone()["n"]
        else:
            store_count = conn.execute(
                "select count(*) as n from memory.typed_memory where superseded_by is null"
            ).fetchone()["n"]
            superseded_count = conn.execute(
                "select count(*) as n from memory.typed_memory where superseded_by is not null"
            ).fetchone()["n"]
        pending = pending_proposals_count(user_id=user_id, database_url=database_url)
        last = latest_run(user_id=user_id, database_url=database_url)

    return {
        "store_size": store_count,
        "superseded_count": superseded_count,
        "pending_proposals": pending,
        "last_run": last,
    }


def start_run(
    *,
    model: str,
    instructions: str = "",
    user_id: str | None = None,
    database_url: str | None = None,
) -> str:
    """
    Insert a new ``memory.dream_runs`` row in ``in_progress`` status
    and return its ``run_id``. Called at the start of every
    ``dream.py run`` invocation. The optional ``user_id`` is recorded
    so status / latest_run queries can be scoped per actor.
    """
    run_id = str(uuid4())
    owner = user_id or os.environ.get("ACTOR_ID", "u_owner")
    with _connect(database_url) as conn:
        _set_session_context(conn, owner)
        conn.execute(
            """
            insert into memory.dream_runs
                (run_id, user_id, started_at, model, instructions, status)
            values (%s, %s, now(), %s, %s, 'in_progress')
            """,
            (run_id, owner, model, instructions or ""),
        )
        conn.commit()
    return run_id


def record_proposals(
    run_id: str,
    proposals: list[Proposal],
    *,
    summary: str = "",
    rows_scanned: int = 0,
    database_url: str | None = None,
) -> int:
    """
    Insert a row in ``memory.dream_proposals`` for each :class:`Proposal`
    in the synthesis result. Returns the count inserted.
    """
    if not proposals:
        with _connect(database_url) as conn:
            _set_session_context(conn)
            conn.execute(
                """
                update memory.dream_runs
                set finished_at = now(),
                    status = 'completed',
                    rows_scanned = %s,
                    proposals_count = 0,
                    summary = %s
                where run_id = %s
                """,
                (rows_scanned, summary or "", run_id),
            )
            conn.commit()
        return 0

    with _connect(database_url) as conn:
        _set_session_context(conn)
        with conn.transaction():
            for p in proposals:
                conn.execute(
                    """
                    insert into memory.dream_proposals
                        (run_id, row_id, action,
                         proposed_replacement, proposed_superseded_by_id,
                         confidence, rationale)
                    values (%s, %s, %s, %s, %s, %s, %s)
                    on conflict (run_id, row_id) do update
                        set action = excluded.action,
                            proposed_replacement = excluded.proposed_replacement,
                            proposed_superseded_by_id = excluded.proposed_superseded_by_id,
                            confidence = excluded.confidence,
                            rationale = excluded.rationale
                    """,
                    (
                        run_id, p.row_id, p.action,
                        p.proposed_replacement, p.proposed_superseded_by_id,
                        max(0.0, min(1.0, p.confidence)),
                        p.rationale or "",
                    ),
                )
            conn.execute(
                """
                update memory.dream_runs
                set finished_at = now(),
                    status = 'completed',
                    rows_scanned = %s,
                    proposals_count = %s,
                    summary = %s
                where run_id = %s
                """,
                (rows_scanned, len(proposals), summary or "", run_id),
            )
    return len(proposals)


def fail_run(
    run_id: str,
    error_message: str,
    *,
    user_id: str | None = None,
    database_url: str | None = None,
) -> None:
    """Mark a run as failed with the given error. Called when the
    synthesis pass raises."""
    with _connect(database_url) as conn:
        _set_session_context(conn, user_id)
        conn.execute(
            """
            update memory.dream_runs
            set finished_at = now(),
                status = 'failed',
                error_message = %s
            where run_id = %s
            """,
            (error_message[:2000], run_id),
        )
        conn.commit()


def pending_proposals_count(
    *,
    run_id: str | None = None,
    user_id: str | None = None,
    database_url: str | None = None,
    allow_legacy_admin: bool = False,
) -> int:
    """Number of proposals whose ``reviewer_action`` is null, optionally
    filtered to a specific run and/or user.

    When ``user_id`` is provided, only proposals whose underlying
    ``memory.typed_memory`` row belongs to that user are counted. This
    prevents cross-user operational metadata leakage in multi-actor
    stores.
    """
    with _connect(database_url) as conn:
        _set_session_context(conn, user_id)
        legacy_nullable_run = False
        if run_id is not None and user_id is not None:
            authorized, legacy_nullable_run = _authorize_run(
                conn,
                run_id,
                user_id,
                allow_legacy_admin=allow_legacy_admin,
            )
            if not authorized:
                return 0
        sql = (
            "select count(*) as n "
            "from memory.dream_proposals p "
            "join memory.typed_memory m on m.id = p.row_id "
            "where p.reviewer_action is null"
        )
        params: list = []
        if run_id is not None:
            sql += " and p.run_id = %s"
            params.append(run_id)
        if user_id is not None:
            sql += " and m.user_id = %s"
            params.append(user_id)
        if run_id is not None and user_id is not None and not legacy_nullable_run:
            sql += (
                " and exists ("
                "select 1 from memory.dream_runs r "
                "where r.run_id = p.run_id and r.user_id = %s)"
            )
            params.append(user_id)
        return int(conn.execute(sql, params).fetchone()["n"])


def list_proposals(
    run_id: str,
    *,
    include_reviewed: bool = False,
    user_id: str | None = None,
    database_url: str | None = None,
    allow_legacy_admin: bool = False,
) -> list[dict]:
    """Return all proposals for a run, optionally excluding already-reviewed ones."""
    sql = """
        select
            p.id, p.run_id, p.row_id, p.action,
            p.proposed_replacement, p.proposed_superseded_by_id,
            p.confidence, p.rationale,
            p.reviewer_action, p.reviewed_at, p.created_at,
            m.memory_type, m.category, m.content, m.summary as row_summary
        from memory.dream_proposals p
        join memory.typed_memory m on m.id = p.row_id
        join memory.dream_runs r on r.run_id = p.run_id
        where p.run_id = %s
    """
    with _connect(database_url) as conn:
        _set_session_context(conn, user_id)
        legacy_nullable_run = False
        if user_id is not None:
            authorized, legacy_nullable_run = _authorize_run(
                conn,
                run_id,
                user_id,
                allow_legacy_admin=allow_legacy_admin,
            )
            if not authorized:
                return []
        params: list = [run_id]
        if user_id is not None:
            sql += " and m.user_id = %s"
            params.append(user_id)
            if not legacy_nullable_run:
                sql += " and r.user_id = %s"
                params.append(user_id)
        if not include_reviewed:
            sql += " and p.reviewer_action is null"
        sql += " order by p.created_at"
        return [dict(r) for r in conn.execute(sql, params).fetchall()]


if __name__ == "__main__":
    import json
    s = status()
    print(json.dumps(s, indent=2, default=str))
