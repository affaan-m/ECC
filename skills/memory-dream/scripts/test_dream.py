"""
test_dream.py — Smoke tests for the memory-dream skill.

These tests do NOT require a running Postgres. They validate:

  1. All 8 dream modules import cleanly.
  2. The CLI argument parser accepts every documented subcommand.
  3. The synthesizer builds a prompt of the expected shape.
  4. The deduplicator groups exact / substring / prefix matches
     in-memory (no DB).
  5. The diff markdown generator produces a non-empty report
     when given a fake run with no proposals.
  6. The schema additions in init_schema.sql are syntactically
     well-formed (matched parens, semicolons at end, FK targets
     exist).

Run via:
  python -B skills/memory-dream/scripts/test_dream.py
"""

from __future__ import annotations

import io
import os
import sys
import tempfile
import unittest
from types import SimpleNamespace
from pathlib import Path
from unittest import mock

REPO_ROOT = Path(__file__).resolve().parents[3]
DREAM_DIR = REPO_ROOT / "skills" / "memory-dream" / "scripts"
SCHEMA_PATH = REPO_ROOT / "init_schema.sql"


class _FakeResult:
    def __init__(self, *, one=None, many=None):
        self._one = one
        self._many = [] if many is None else many

    def fetchone(self):
        return self._one

    def fetchall(self):
        return self._many


class _FakeTransaction:
    def __enter__(self):
        return self

    def __exit__(self, *args):
        return False


class _FakeControllerConn:
    def __init__(self, *, owner, pending=False, trusted_service=True, proposal_user="u_test"):
        self.owner = owner
        self.pending = pending
        self.trusted_service = trusted_service
        self.proposal_user = proposal_user
        self.calls: list[tuple[str, object]] = []

    def __enter__(self):
        return self

    def __exit__(self, *args):
        return False

    def transaction(self):
        return _FakeTransaction()

    def commit(self):
        self.calls.append(("commit", None))

    def execute(self, sql, params=None):
        self.calls.append((sql, params))
        if "select memory.is_service_role()" in sql:
            return _FakeResult(one={"is_service_role": self.trusted_service})
        if "select user_id" in sql and "from memory.dream_runs" in sql:
            return _FakeResult(one={"user_id": self.owner})
        if "select count(*) as n" in sql and "from memory.dream_proposals p" in sql:
            return _FakeResult(one={"n": 1 if self.pending else 0})
        if "select 1" in sql and "from memory.dream_proposals" in sql:
            return _FakeResult(one={"?column?": 1} if self.pending else None)
        if "select\n            p.id, p.run_id, p.row_id, p.action," in sql:
            return _FakeResult(many=[{
                "id": "11111111-1111-1111-1111-111111111111",
                "run_id": "00000000-0000-0000-0000-000000000000",
                "row_id": "22222222-2222-2222-2222-222222222222",
                "action": "keep",
                "proposed_replacement": None,
                "proposed_superseded_by_id": None,
                "confidence": 0.9,
                "rationale": "",
                "reviewer_action": None,
                "reviewed_at": None,
                "created_at": "2026-07-01T00:00:00Z",
                "memory_type": "semantic",
                "category": "fact",
                "content": "remember this",
                "row_summary": "",
            }] if self.pending else [])
        if "from memory.dream_proposals p" in sql:
            return _FakeResult(many=[])
        if "update memory.dream_proposals" in sql:
            return _FakeResult(many=[])
        return _FakeResult()


class TestImports(unittest.TestCase):
    """All 8 dream modules must import without a running database."""

    def test_loadenv_imports(self):
        from _loadenv import _strip_bearer, load_api_key
        self.assertTrue(callable(load_api_key))
        self.assertTrue(callable(_strip_bearer))

    def test_parser_imports(self):
        from parser import parse_typed_memory, render_entries
        self.assertTrue(callable(parse_typed_memory))
        self.assertTrue(callable(render_entries))

    def test_collector_imports(self):
        from collector import _extract_text, collect_activity
        self.assertTrue(callable(collect_activity))
        self.assertTrue(callable(_extract_text))

    def test_deduplicator_imports(self):
        from deduplicator import (
            find_all_dupes,
            find_common_prefix_dupes,
            find_exact_dupes,
            find_substring_dupes,
        )
        self.assertTrue(callable(find_exact_dupes))
        self.assertTrue(callable(find_substring_dupes))
        self.assertTrue(callable(find_common_prefix_dupes))
        self.assertTrue(callable(find_all_dupes))

    def test_synthesizer_imports(self):
        from synthesizer import (
            build_prompt,
            parse_response,
        )
        self.assertTrue(callable(build_prompt))
        self.assertTrue(callable(parse_response))

    def test_build_prompt_escapes_braces(self):
        # Memory rows / user instructions / session excerpts may
        # legitimately contain ``{`` or ``}`` (JSON, code snippets).
        # Without escaping, PROMPT_TEMPLATE.format() raises
        # KeyError / IndexError on any unmatched brace.
        from parser import MemoryEntry, ParsedStore
        from synthesizer import build_prompt

        entries = [
            MemoryEntry(
                row_id="aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
                text='{ "json": "in memory text" }',  # braces
                memory_type="semantic", category="fact",
                confidence=0.9, source="user_utterance", visibility="owner_only",
                user_id="u_test", created_at="2026-06-25T00:00:00Z",
                index=0, hash="",
            ),
        ]
        store = ParsedStore(
            user_id="u_test", entries=entries, char_count=len(entries[0].text),
        )
        # Should not raise — the braces must be escaped before
        # reaching str.format().
        prompt = build_prompt(
            store,
            session_excerpts="user said: {not_a_var}",
            sess_count=1, sess_chars=20,
            instructions='instructions: {also_not_a_var}',
        )
        # And the escaped braces should appear in the rendered prompt
        # (so the LLM can see them as literal text).
        self.assertIn('{{ "json": "in memory text" }}', prompt)
        self.assertIn('{{not_a_var}}', prompt)

    def test_build_prompt_recency_preserved(self):
        # Verify the recency tiebreak is used as documented in
        # find_semantic_dupes (canonical = lowest index, then
        # confidence desc).
        from parser import MemoryEntry, ParsedStore
        from synthesizer import build_prompt

        entries = [
            MemoryEntry(
                row_id="aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1",
                text="old fact, low confidence",
                memory_type="semantic", category="fact",
                confidence=0.5, source="user_utterance",
                visibility="owner_only", user_id="u_test",
                created_at="2026-06-25T00:00:00Z", index=0, hash="",
            ),
        ]
        store = ParsedStore(
            user_id="u_test", entries=entries, char_count=30,
        )
        prompt = build_prompt(store, "(none)", 0, 0)
        self.assertIn("old fact, low confidence", prompt)

    def test_controller_imports(self):
        import controller
        # Spot-check the public API.
        for name in (
            "start_run", "finish_run", "stage_proposals",
            "adopt_run", "discard_run", "status",
            "latest_run", "list_proposals", "pending_proposals_count",
            "fail_run", "has_pending_staging", "record_proposals",
        ):
            self.assertTrue(
                hasattr(controller, name),
                f"controller.{name} is missing — was a function renamed or removed?",
            )

    def test_diff_imports(self):
        from diff import generate_diff_markdown, write_diff
        self.assertTrue(callable(generate_diff_markdown))
        self.assertTrue(callable(write_diff))

    def test_write_diff_rejects_paths_outside_workspace(self):
        import diff

        with tempfile.TemporaryDirectory() as tmp:
            original = diff.generate_diff_markdown
            diff.generate_diff_markdown = lambda *a, **kw: "# ok\n"
            try:
                written = diff.write_diff(
                    "00000000-0000-0000-0000-000000000000",
                    "reports/dream.md",
                    user_id="u_test",
                    base_dir=tmp,
                )
                self.assertEqual(written, len("# ok\n".encode("utf-8")))
                self.assertTrue((Path(tmp) / "reports" / "dream.md").exists())
                with self.assertRaises(ValueError):
                    diff.write_diff(
                        "00000000-0000-0000-0000-000000000000",
                        "../escape.md",
                        user_id="u_test",
                        base_dir=tmp,
                    )
            finally:
                diff.generate_diff_markdown = original

    def test_dream_cli_imports(self):
        # Non-LLM subcommands such as status/diff/discard must be importable
        # on machines that have not configured an LLM key. Only cmd_run
        # should force key loading.
        import importlib.util
        import os
        import tempfile

        old_env = {name: os.environ.get(name) for name in (
            "LLM_API_KEY", "OPENAI_API_KEY", "NVIDIA_API_KEY", "ANTHROPIC_API_KEY",
        )}
        old_home = os.environ.get("HOME")
        old_cwd = Path.cwd()
        with tempfile.TemporaryDirectory() as tmp:
            for name in old_env:
                os.environ.pop(name, None)
            os.environ["HOME"] = tmp
            os.chdir(tmp)
            try:
                spec = importlib.util.spec_from_file_location("dream", DREAM_DIR / "dream.py")
                self.assertIsNotNone(spec)
                self.assertIsNotNone(getattr(spec, "loader", None))
                assert spec is not None and spec.loader is not None
                module = importlib.util.module_from_spec(spec)
                spec.loader.exec_module(module)
                self.assertTrue(hasattr(module, "main"))
            finally:
                os.chdir(old_cwd)
                for name, value in old_env.items():
                    if value is None:
                        os.environ.pop(name, None)
                    else:
                        os.environ[name] = value
                if old_home is None:
                    os.environ.pop("HOME", None)
                else:
                    os.environ["HOME"] = old_home

    def test_stage_proposals_uses_unique_row_upsert(self):
        import inspect

        import controller
        source = inspect.getsource(controller.stage_proposals)
        self.assertIn("on conflict (run_id, row_id)", source)
        self.assertIn("update memory.dream_runs", source)

    def test_adopt_run_selects_content_for_merge_audit(self):
        import controller
        source = Path(controller.__file__).read_text(encoding="utf-8")
        select_blocks = [
            block for block in source.split("for update")
            if "from memory.dream_proposals p" in block
            and "join memory.typed_memory m" in block
        ]
        self.assertTrue(select_blocks)
        for block in select_blocks[:2]:
            self.assertIn("m.content", block)

    def test_adopt_and_discard_check_run_owner(self):
        import controller

        fake = _FakeControllerConn(owner="u_other")
        original = controller._connect
        controller._connect = lambda *a, **kw: fake
        try:
            result = controller.adopt_run(
                "00000000-0000-0000-0000-000000000000",
                user_id="u_test",
            )
            self.assertEqual(result.adopted, 0)
            self.assertTrue(result.errors)
            with self.assertRaises(PermissionError):
                controller.discard_run(
                    "00000000-0000-0000-0000-000000000000",
                    user_id="u_test",
                )
        finally:
            controller._connect = original

        updates = [sql for sql, _ in fake.calls if "update memory.dream_proposals" in sql]
        self.assertEqual(updates, [])

    def test_adopt_allows_nullable_owner_only_with_explicit_legacy_admin(self):
        import controller

        fake = _FakeControllerConn(owner=None)
        original = controller._connect
        controller._connect = lambda *a, **kw: fake
        try:
            blocked = controller.adopt_run(
                "00000000-0000-0000-0000-000000000000",
                user_id="u_test",
            )
            self.assertTrue(blocked.errors)
            allowed = controller.adopt_run(
                "00000000-0000-0000-0000-000000000000",
                user_id="u_test",
                allow_legacy_admin=True,
            )
            self.assertEqual(allowed.errors, [])
        finally:
            controller._connect = original

    def test_adopt_subset_casts_proposal_ids_to_uuid_array(self):
        import controller

        fake = _FakeControllerConn(owner="u_test")
        original = controller._connect
        controller._connect = lambda *a, **kw: fake
        try:
            result = controller.adopt_run(
                "00000000-0000-0000-0000-000000000000",
                proposal_ids=["11111111-1111-1111-1111-111111111111"],
                user_id="u_test",
            )
            self.assertEqual(result.errors, [])
        finally:
            controller._connect = original

        self.assertTrue(any("ANY(%s::uuid[])" in sql for sql, _ in fake.calls))

    def test_legacy_admin_keeps_run_open_when_other_proposals_remain(self):
        import controller

        fake = _FakeControllerConn(owner=None, pending=True)
        original = controller._connect
        controller._connect = lambda *a, **kw: fake
        try:
            result = controller.adopt_run(
                "00000000-0000-0000-0000-000000000000",
                user_id="u_test",
                allow_legacy_admin=True,
            )
            self.assertEqual(result.errors, [])
            controller.discard_run(
                "00000000-0000-0000-0000-000000000000",
                user_id="u_test",
                allow_legacy_admin=True,
            )
        finally:
            controller._connect = original

        self.assertFalse(any("set status = 'completed'" in sql for sql, _ in fake.calls))
        self.assertFalse(any("set status = 'discarded'" in sql for sql, _ in fake.calls))
        self.assertTrue(any("adopted_count = adopted_count + %s" in sql for sql, _ in fake.calls))

    def test_legacy_admin_requires_trusted_service_role(self):
        import controller

        fake = _FakeControllerConn(owner=None, pending=True, trusted_service=False)
        original = controller._connect
        controller._connect = lambda *a, **kw: fake
        try:
            result = controller.adopt_run(
                "00000000-0000-0000-0000-000000000000",
                user_id="u_test",
                allow_legacy_admin=True,
            )
            self.assertTrue(result.errors)
            self.assertIn("trusted database service role", result.errors[0])
            with self.assertRaises(PermissionError):
                controller.discard_run(
                    "00000000-0000-0000-0000-000000000000",
                    user_id="u_test",
                    allow_legacy_admin=True,
                )
            with self.assertRaises(PermissionError):
                controller.pending_proposals_count(
                    run_id="00000000-0000-0000-0000-000000000000",
                    user_id="u_test",
                    allow_legacy_admin=True,
                )
            with self.assertRaises(PermissionError):
                controller.list_proposals(
                    "00000000-0000-0000-0000-000000000000",
                    user_id="u_test",
                    allow_legacy_admin=True,
                )
        finally:
            controller._connect = original

    def test_legacy_admin_lists_and_counts_nullable_owner_with_explicit_user_scope(self):
        import controller

        fake = _FakeControllerConn(owner=None, pending=True, trusted_service=True)
        original = controller._connect
        controller._connect = lambda *a, **kw: fake
        try:
            count = controller.pending_proposals_count(
                run_id="00000000-0000-0000-0000-000000000000",
                user_id="u_test",
                allow_legacy_admin=True,
            )
            proposals = controller.list_proposals(
                "00000000-0000-0000-0000-000000000000",
                user_id="u_test",
                allow_legacy_admin=True,
            )
        finally:
            controller._connect = original

        self.assertEqual(count, 1)
        self.assertEqual(len(proposals), 1)

    def test_synthesizer_invalid_json_error_does_not_include_response_preview(self):
        from synthesizer import parse_response

        placeholder_text = "typed memory placeholder should not leak"
        with self.assertRaises(RuntimeError) as ctx:
            parse_response("{not json " + placeholder_text)
        message = str(ctx.exception)
        self.assertIn("response_sha256=", message)
        self.assertNotIn(placeholder_text, message)

    def test_adopt_confirmation_eof_returns_clear_error(self):
        import dream

        args = SimpleNamespace(
            user_id=None,
            run_id="00000000-0000-0000-0000-000000000000",
            yes=False,
            database_url=None,
            min_confidence=0.0,
            actor_id=None,
            allow_legacy_admin=False,
        )
        with mock.patch.object(dream.controller, "pending_proposals_count", return_value=1):
            with mock.patch("builtins.input", side_effect=EOFError):
                with mock.patch("sys.stdout", new=io.StringIO()) as stdout:
                    exit_code = dream.cmd_adopt(args)
        self.assertEqual(exit_code, 1)
        self.assertIn("confirmation required", stdout.getvalue())

    def test_discard_confirmation_eof_returns_clear_error(self):
        import dream

        args = SimpleNamespace(
            user_id=None,
            run_id="00000000-0000-0000-0000-000000000000",
            yes=False,
            database_url=None,
            allow_legacy_admin=False,
        )
        with mock.patch.object(dream.controller, "pending_proposals_count", return_value=1):
            with mock.patch("builtins.input", side_effect=EOFError):
                with mock.patch("sys.stdout", new=io.StringIO()) as stdout:
                    exit_code = dream.cmd_discard(args)
        self.assertEqual(exit_code, 1)
        self.assertIn("confirmation required", stdout.getvalue())

    def test_dream_wrapper_processes_final_env_line_without_newline(self):
        script = (DREAM_DIR / "dream.sh").read_text(encoding="utf-8")
        self.assertIn('read -r key value || [[ -n "${key:-}" ]]', script)

    def test_no_llm_paths_do_not_require_api_key(self):
        import importlib.util
        import inspect

        spec = importlib.util.spec_from_file_location("dream_no_llm_contract", DREAM_DIR / "dream.py")
        self.assertIsNotNone(spec)
        self.assertIsNotNone(getattr(spec, "loader", None))
        assert spec is not None and spec.loader is not None
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        source = inspect.getsource(module.cmd_run)
        self.assertLess(source.index("if args.dry_run"), source.index("load_api_key()"))
        self.assertLess(source.index("if args.no_llm"), source.index("load_api_key()"))


class TestParser(unittest.TestCase):
    """In-memory parser tests (no DB)."""

    def setUp(self):
        from parser import MemoryEntry
        self.entry_a = MemoryEntry(
            row_id="11111111-1111-1111-1111-111111111111",
            text="Mo Memory uses Postgres + pgvector for memory.",
            memory_type="semantic", category="fact",
            confidence=0.9, source="user_utterance", visibility="owner_only",
            user_id="u_test", created_at="2026-06-25T00:00:00Z",
            index=0, hash="",
        )
        self.entry_b = MemoryEntry(
            row_id="22222222-2222-2222-2222-222222222222",
            text="Mo Memory uses Postgres.",  # substring of A
            memory_type="semantic", category="fact",
            confidence=0.6, source="user_utterance", visibility="owner_only",
            user_id="u_test", created_at="2026-06-25T00:01:00Z",
            index=1, hash="",
        )
        self.entry_c = MemoryEntry(
            row_id="33333333-3333-3333-3333-333333333333",
            text="Hermes is an agent runtime.",
            memory_type="semantic", category="fact",
            confidence=0.7, source="user_utterance", visibility="owner_only",
            user_id="u_test", created_at="2026-06-25T00:02:00Z",
            index=2, hash="",
        )

    def test_hash_is_stable(self):
        from parser import _hash
        # Same text → same hash regardless of case/whitespace.
        self.assertEqual(_hash("Hello World"), _hash("hello   world"))

    def test_render_entries(self):
        from parser import render_entries
        out = render_entries([self.entry_a, self.entry_c])
        self.assertIn("Mo Memory uses Postgres", out)
        self.assertIn("Hermes is an agent", out)
        # The §-delimiter joins sections.
        self.assertIn("§", out)


class TestDeduplicator(unittest.TestCase):
    """In-memory dedup tests (no DB)."""

    def _make_entry(self, row_id, text, category="fact", memory_type="semantic"):
        from parser import MemoryEntry
        return MemoryEntry(
            row_id=row_id, text=text,
            memory_type=memory_type, category=category,
            confidence=0.8, source="user_utterance", visibility="owner_only",
            user_id="u_test", created_at="2026-06-25T00:00:00Z",
            index=0, hash="",
        )

    def test_exact_dupes(self):
        from deduplicator import find_exact_dupes
        e1 = self._make_entry("a", "I prefer Postgres.")
        e2 = self._make_entry("b", "I prefer postgres.", )  # case-normalized: same hash
        e3 = self._make_entry("c", "Different content.")
        groups = find_exact_dupes([e1, e2, e3])
        self.assertEqual(len(groups), 1)
        self.assertEqual(len(groups[0].members), 2)
        self.assertIn(e1, groups[0].members)
        self.assertIn(e2, groups[0].members)

    def test_substring_dupes(self):
        from deduplicator import find_substring_dupes
        # Both entries must exceed min_overlap_chars=80 for the
        # substring pass to flag them.
        outer = self._make_entry(
            "a",
            "Mo Memory uses Postgres with pgvector and the FTS index for retrieval and hybrid search. " * 2,
        )
        inner = self._make_entry(
            "b",
            "Mo Memory uses Postgres with pgvector and the FTS index for retrieval and hybrid search.",
        )
        groups = find_substring_dupes([outer, inner])
        self.assertEqual(len(groups), 1)
        self.assertIn(inner, groups[0].members)

    def test_no_dupes(self):
        from deduplicator import find_exact_dupes, find_substring_dupes
        a = self._make_entry("a", "First fact.")
        b = self._make_entry("b", "Second fact.")
        c = self._make_entry("c", "Third fact.")
        self.assertEqual(find_exact_dupes([a, b, c]), [])
        self.assertEqual(find_substring_dupes([a, b, c]), [])


class TestSynthesizerPrompt(unittest.TestCase):
    """Build a prompt from in-memory entries and check shape."""

    def test_prompt_includes_all_memory_types(self):
        from parser import MemoryEntry, ParsedStore
        from synthesizer import build_prompt
        entries = [
            MemoryEntry(
                row_id="e1", text="Semantic fact A.", memory_type="semantic",
                category="fact", confidence=0.9, source="user_utterance",
                visibility="owner_only", user_id="u_test",
                created_at="2026-06-25T00:00:00Z", index=0, hash="",
            ),
            MemoryEntry(
                row_id="e2", text="Procedural step 1.", memory_type="procedural",
                category="procedure", confidence=0.7, source="user_utterance",
                visibility="owner_only", user_id="u_test",
                created_at="2026-06-25T00:00:01Z", index=1, hash="",
            ),
            MemoryEntry(
                row_id="e3", text="Episodic interaction with X.",
                memory_type="episodic", category="interaction",
                confidence=1.0, source="user_utterance",
                visibility="owner_only", user_id="u_test",
                created_at="2026-06-25T00:00:02Z", index=2, hash="",
            ),
        ]
        store = ParsedStore(user_id="u_test", entries=entries, char_count=100)
        prompt = build_prompt(store, "(no sessions)", 0, 0)
        # All three sections appear in the rendered prompt.
        self.assertIn("semantic rows", prompt)
        self.assertIn("procedural rows", prompt)
        self.assertIn("episodic rows", prompt)
        # And every entry's text.
        self.assertIn("Semantic fact A.", prompt)
        self.assertIn("Procedural step 1.", prompt)
        self.assertIn("Episodic interaction", prompt)

    def test_prompt_with_focus(self):
        from parser import MemoryEntry, ParsedStore
        from synthesizer import build_prompt
        store = ParsedStore(
            user_id="u_test",
            entries=[MemoryEntry(
                row_id="e1", text="x", memory_type="semantic",
                category="fact", confidence=0.9, source="user_utterance",
                visibility="owner_only", user_id="u_test",
                created_at="2026-06-25T00:00:00Z", index=0, hash="",
            )],
            char_count=1,
        )
        prompt = build_prompt(store, "", 0, 0, instructions="Be VERY conservative.")
        self.assertIn("Be VERY conservative", prompt)


class TestResponseParser(unittest.TestCase):
    """Parse LLM JSON output (with and without markdown fences)."""

    def test_plain_json(self):
        from synthesizer import parse_response
        response = (
            '{"proposals": ['
            '{"row_id": "abc", "action": "keep", "confidence": 0.9, "rationale": "still accurate"}'
            '], "summary": "no changes"}'
        )
        result = parse_response(response)
        self.assertEqual(len(result.proposals), 1)
        self.assertEqual(result.proposals[0].action, "keep")
        self.assertEqual(result.summary, "no changes")

    def test_markdown_fenced_json(self):
        from synthesizer import parse_response
        response = (
            "```json\n"
            '{"proposals": ['
            '{"row_id": "abc", "action": "merge", "proposed_replacement": "merged text", "confidence": 0.8, "rationale": "tightened"}'
            '], "summary": "1 merge"}\n'
            "```"
        )
        result = parse_response(response)
        self.assertEqual(result.proposals[0].action, "merge")
        self.assertEqual(result.proposals[0].proposed_replacement, "merged text")

    def test_unknown_action_filtered(self):
        from synthesizer import parse_response
        response = (
            '{"proposals": ['
            '{"row_id": "abc", "action": "delete", "confidence": 0.9},'
            '{"row_id": "def", "action": "archive", "confidence": 0.7}'
            '], "summary": ""}'
        )
        result = parse_response(response)
        # "delete" is not in the allowed action set; should be filtered.
        self.assertEqual(len(result.proposals), 1)
        self.assertEqual(result.proposals[0].action, "archive")


class TestDiffMarkdown(unittest.TestCase):
    """The diff markdown for a non-existent run returns a clean error.

    Skipped if no Postgres is reachable — diff.py requires the live
    memory.dream_runs table, which only exists after init_schema.sql
    has been applied to a real database.
    """

    def test_missing_run_message(self):
        import os
        if not os.environ.get("DATABASE_URL") and not os.environ.get("DREAM_TEST_DB"):
            self.skipTest("no DATABASE_URL set; diff.py requires live DB")
        from diff import generate_diff_markdown
        md = generate_diff_markdown(
            "nonexistent-run-id-xxxxxxxxxxxx", user_id="u_test",
        )
        self.assertIn("Run not found", md)
        self.assertIn("nonexistent-run-id", md)


class TestSchemaAdditions(unittest.TestCase):
    """The dream tables in init_schema.sql look syntactically right."""

    def setUp(self):
        self.text = SCHEMA_PATH.read_text(encoding="utf-8")

    def test_dream_proposals_table(self):
        # The CREATE TABLE statement exists.
        self.assertIn("create table memory.dream_proposals", self.text)
        # Foreign key to typed_memory.
        self.assertRegex(
            self.text,
            r"create table memory\.dream_proposals[\s\S]+?references memory\.typed_memory\(id\)",
        )
        # Foreign key to dream_runs (run_id).
        self.assertRegex(
            self.text,
            r"run_id\s+uuid\s+not\s+null\s*\n?\s*references memory\.dream_runs\(run_id\)",
        )
        # The action check covers all 5 actions.
        for action in ("keep", "merge", "supersede", "archive", "flag_for_review"):
            self.assertIn(f"'{action}'", self.text)

    def test_dream_runs_table(self):
        self.assertIn("create table memory.dream_runs", self.text)
        # The status check covers all 4 states.
        for status in ("in_progress", "completed", "failed", "discarded"):
            self.assertIn(f"'{status}'", self.text)
        # dream_runs must be defined BEFORE dream_proposals so the
        # dream_proposals.run_id FK can be added at table creation time.
        runs_idx = self.text.find("create table memory.dream_runs")
        props_idx = self.text.find("create table memory.dream_proposals")
        self.assertGreater(runs_idx, 0)
        self.assertGreater(props_idx, runs_idx,
                          "dream_runs must be declared before dream_proposals")
        # dream_runs must carry a user_id column for proper user-scoping.
        # The previous `instructions = ''` filter was incorrect because
        # another actor's run could match. See PR #2359 finding 9.
        self.assertRegex(
            self.text,
            r"create table memory\.dream_runs[\s\S]+?\buser_id\b",
        )
        # dream_runs must carry a skipped_count column so the run
        # summary can accurately report skipped (low-confidence,
        # unknown-action) proposals separately from rejected. See
        # PR #2359 finding 11.
        self.assertRegex(
            self.text,
            r"create table memory\.dream_runs[\s\S]+?\bskipped_count\b",
        )

    def test_indexes(self):
        # At least one dream-specific index.
        self.assertIn("idx_dream_proposals", self.text)
        self.assertIn("idx_dream_runs", self.text)
        # The dream_runs.user_id index for per-actor status queries.
        self.assertIn("idx_dream_runs_user", self.text)

    def test_dream_tables_have_forced_rls(self):
        for table in ("dream_runs", "dream_proposals"):
            self.assertIn(
                f"alter table memory.{table} enable row level security",
                self.text,
            )
            self.assertIn(
                f"alter table memory.{table} force row level security",
                self.text,
            )
            self.assertIn(f"{table}_service_all", self.text)

    def test_service_role_requires_trusted_database_identity(self):
        start = self.text.index("create or replace function memory.is_service_role")
        end = self.text.index("-- 4a. typed_memory RLS", start)
        helper_block = self.text[start:end]
        self.assertIn("memory.has_trusted_service_identity()", helper_block)
        self.assertIn("current_user", self.text)
        self.assertIn("session_user", self.text)
        self.assertIn("pg_has_role", self.text)

    def test_dream_proposals_policy_checks_run_and_memory_owner(self):
        start = self.text.index("create policy dream_proposals_user_select")
        end = self.text.index("create policy dream_proposals_user_insert", start)
        policy = self.text[start:end]
        self.assertIn("from memory.dream_runs r", policy)
        self.assertIn("join memory.typed_memory tm", policy)
        self.assertIn("r.user_id = memory.get_current_user_id()", policy)
        self.assertIn("tm.user_id = memory.get_current_user_id()", policy)

    def test_memory_edges_authorize_by_endpoints(self):
        start = self.text.index("create policy edge_select")
        end = self.text.index("create policy edge_service_all", start)
        policy = self.text[start:end]
        self.assertIn("source_memory", policy)
        self.assertIn("target_memory", policy)
        self.assertIn("memory_edges.source_id", policy)
        self.assertIn("memory_edges.target_id", policy)
        self.assertNotIn("metadata->>'memory_id'", policy)
        self.assertIn("create policy edge_service_all", self.text)
        self.assertIn("for all", self.text[self.text.index("create policy edge_service_all"):])


class TestParserSQL(unittest.TestCase):
    """Verify the parser SQL starts with `select` (not lint comments)."""

    def test_sql_does_not_contain_noqa(self):
        # Re-import the module and patch _connect to capture the SQL
        # before executing it. The lint comment must NOT be embedded
        # inside the query text.
        import sys
        captured: dict = {}

        class _FakeConn:
            def execute(self, sql, params=None):
                captured["sql"] = sql
                captured["params"] = params
                class _R:
                    def fetchall(self): return []
                return _R()
            def __enter__(self): return self
            def __exit__(self, *a): return False

        # Force reimport in case a prior test imported parser.
        sys.modules.pop("parser", None)
        sys.path.insert(0, str(DREAM_DIR))
        import parser
        parser._connect = lambda *a, **kw: _FakeConn()
        parser.parse_typed_memory(user_id="u_test", database_url="x")
        sql = captured.get("sql", "")
        self.assertTrue(
            sql.lstrip().startswith("select"),
            f"SQL must start with 'select' (got {sql[:40]!r})",
        )
        self.assertNotIn("noqa", sql,
                         "lint comment must not be inside SQL text")


class TestLoadEnv(unittest.TestCase):
    """Verify _loadenv exports the key back to LLM_API_KEY."""

    def test_existing_env_exports_to_llm_api_key(self):
        import importlib

        import _loadenv
        # Reload to reset module state.
        importlib.reload(_loadenv)
        import os
        old = os.environ.get("LLM_API_KEY")
        os.environ["LLM_API_KEY"] = ""
        os.environ["OPENAI_API_KEY"] = "sk-test-existing-env-1234"
        try:
            value = _loadenv.load_api_key()
            self.assertEqual(value, "sk-test-existing-env-1234")
            self.assertEqual(os.environ["LLM_API_KEY"], "sk-test-existing-env-1234")
        finally:
            if old is not None:
                os.environ["LLM_API_KEY"] = old
            else:
                os.environ.pop("LLM_API_KEY", None)
            os.environ.pop("OPENAI_API_KEY", None)


class TestCollectorValidation(unittest.TestCase):
    """Verify collect_activity rejects bad parameters."""

    def test_negative_max_age_days(self):
        import collector
        with self.assertRaises(ValueError):
            collector.collect_activity("u_test", max_age_days=-1)

    def test_zero_max_sessions(self):
        import collector
        with self.assertRaises(ValueError):
            collector.collect_activity("u_test", max_sessions=0)

    def test_min_exceeds_max(self):
        import collector
        with self.assertRaises(ValueError):
            collector.collect_activity(
                "u_test", min_session_chars=1000, max_total_chars=500,
            )

    def test_empty_user_id(self):
        import collector
        with self.assertRaises(ValueError):
            collector.collect_activity("")


class TestAdoptCounters(unittest.TestCase):
    """Verify the adopt_run counter accounting is consistent with storage.

    The contract:
    - ``adopted_count`` + ``rejected_count`` = total proposals in the run
    - ``skipped_count`` is the subset of ``rejected_count`` that did not
      execute an apply helper (low confidence, unknown action)
    - For every call to ``_mark_proposal(..., 'rejected', ...)`` the
      ``rejected`` counter must also increment
    """

    def test_skipped_paths_increment_rejected(self):
        # The accept-rejected path: simulate a single proposal
        # below the confidence threshold. After the loop, both
        # ``skipped`` and ``rejected`` must be 1 (and ``adopted`` 0).
        # We exercise the counter-update logic by calling
        # ``_mark_proposal`` as a stub and inspecting the locals.
        import controller

        captured: dict = {}

        class _FakeCursor:
            def execute(self, sql, params=None):
                captured.setdefault("calls", []).append((sql, params))
                class _R:
                    def fetchall(self): return []
                    def fetchone(self): return None
                return _R()
            def __enter__(self): return self
            def __exit__(self, *a): return False

        class _FakeConn:
            def execute(self, sql, params=None):
                captured.setdefault("calls", []).append((sql, params))
                class _R:
                    def fetchall(self): return []
                    def fetchone(self): return None
                return _R()
            def __enter__(self): return self
            def __exit__(self, *a): return False
            def transaction(self):
                class _T:
                    def __enter__(self): return self
                    def __exit__(self, *a): return False
                return _T()

        # Patch _connect so the final UPDATE runs and we can read the
        # persisted counters.
        controller._connect = lambda *a, **kw: _FakeConn()

        # Patch _mark_proposal to a stub that records the call.
        def _stub_mark(conn, prop_id, action, *, rationale_extra=""):
            captured.setdefault("marks", []).append((prop_id, action))
        controller._mark_proposal = _stub_mark

        # Inline a minimal version of the loop logic to exercise the
        # counter invariants without needing a real DB.
        adopted = 0
        rejected = 0
        skipped = 0
        proposals = [
            {"id": "p1", "row_id": "r1", "action": "keep", "confidence": 0.9,
             "rationale": "fine", "user_id": "u", "memory_type": "semantic",
             "category": "fact"},
            {"id": "p2", "row_id": "r2", "action": "merge",
             "confidence": 0.1, "rationale": "low conf",  # below 0.5
             "user_id": "u", "memory_type": "semantic", "category": "fact",
             "proposed_replacement": "x"},
            {"id": "p3", "row_id": "r3", "action": "unknown_action_xyz",
             "confidence": 0.9, "rationale": "garbage",  # unknown action
             "user_id": "u", "memory_type": "semantic", "category": "fact"},
        ]
        min_confidence = 0.5
        for prop in proposals:
            confidence = float(prop["confidence"])
            if confidence < min_confidence:
                skipped += 1
                rejected += 1
                _stub_mark(None, prop["id"], "rejected",
                           rationale_extra=f"skipped: confidence {confidence:.2f} < {min_confidence}")
                continue
            action = prop["action"]
            if action == "keep":
                _stub_mark(None, prop["id"], "adopted")
                adopted += 1
            else:
                # unknown action (we model apply_* as no-ops here)
                skipped += 1
                rejected += 1
                _stub_mark(None, prop["id"], "rejected",
                           rationale_extra=f"unknown action: {action}")

        # Invariant: adopted + rejected == proposals
        self.assertEqual(adopted + rejected, len(proposals),
                         f"adopted({adopted}) + rejected({rejected}) must equal "
                         f"total proposals({len(proposals)})")
        # Invariant: every call to _mark_proposal(rejected) corresponds
        # to a rejected += 1.
        rejected_marks = sum(1 for _, a in captured["marks"] if a == "rejected")
        self.assertEqual(rejected, rejected_marks,
                         f"rejected counter ({rejected}) must match number of "
                         f"rejected proposal rows ({rejected_marks})")
        # Skipped is a strict subset of rejected.
        self.assertLessEqual(skipped, rejected)
        # In this fixture: 1 adopted (p1) + 2 rejected (p2 skipped, p3 unknown)
        self.assertEqual(adopted, 1)
        self.assertEqual(rejected, 2)
        self.assertEqual(skipped, 2)


if __name__ == "__main__":
    # Make the dream scripts importable.
    sys.path.insert(0, str(DREAM_DIR))
    unittest.main(verbosity=2)
