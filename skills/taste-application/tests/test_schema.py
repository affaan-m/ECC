"""Failing-first tests for the tasteforge schema subset validator.

Contract (from the recovered TasteForge gen4 source, canonicalized):
- hand-rolled JSON-Schema subset: type, required, properties, items, enum,
  minimum/minimum, minItems, pattern; no third-party dependency.
"""

from __future__ import annotations

import sys
import unittest
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[1] / "scripts"
sys.path.insert(0, str(REPO_ROOT))

from tasteforge import schema  # noqa: E402


class ValidatorTests(unittest.TestCase):
    def setUp(self):
        self.simple = {
            "type": "object",
            "required": ["name", "count"],
            "properties": {
                "name": {"type": "string", "pattern": "^[a-z][a-z0-9_-]*$"},
                "count": {"type": "integer", "minimum": 0},
                "tags": {"type": "array", "items": {"type": "string"}, "minItems": 1},
                "mode": {"type": "string", "enum": ["local", "dry-run"]},
            },
        }

    def test_accepts_valid_instance(self):
        problems = schema.validate(
            {"name": "flashethereal", "count": 3, "tags": ["a"], "mode": "local"},
            self.simple,
        )
        self.assertEqual(problems, [])

    def test_rejects_missing_required(self):
        problems = schema.validate({"count": 3}, self.simple)
        self.assertTrue(any("required" in p and "name" in p for p in problems))

    def test_rejects_wrong_type(self):
        problems = schema.validate({"name": "x", "count": "three"}, self.simple)
        self.assertTrue(any("count" in p and "type" in p for p in problems))

    def test_rejects_bad_pattern(self):
        problems = schema.validate({"name": "Bad Name!", "count": 0}, self.simple)
        self.assertTrue(any("name" in p and "pattern" in p for p in problems))

    def test_rejects_bad_enum(self):
        problems = schema.validate({"name": "x", "count": 0, "mode": "live"}, self.simple)
        self.assertTrue(any("mode" in p and "enum" in p for p in problems))

    def test_rejects_below_minimum(self):
        problems = schema.validate({"name": "x", "count": -1}, self.simple)
        self.assertTrue(any("count" in p and "minimum" in p for p in problems))

    def test_rejects_bad_items_and_min_items(self):
        problems = schema.validate({"name": "x", "count": 0, "tags": [1, 2]}, self.simple)
        self.assertTrue(any("tags[0]" in p for p in problems))
        problems = schema.validate({"name": "x", "count": 0, "tags": []}, self.simple)
        self.assertTrue(any("tags" in p and "minItems" in p for p in problems))

    def test_non_object_root_rejected(self):
        problems = schema.validate(["not", "an", "object"], self.simple)
        self.assertTrue(problems)


class ExportedSchemasTests(unittest.TestCase):
    EXPORTED = [
        "TASTE_PROFILE_SCHEMA",
        "PACK_MANIFEST_SCHEMA",
        "GRADE_SCHEMA",
        "CADENCE_SCHEMA",
        "SPEC_SCHEMA",
        "TIMELINE_EVENT_SCHEMA",
        "APPLICATION_REPORT_SCHEMA",
        "PROVENANCE_SCHEMA",
    ]

    def test_all_exported_schemas_exist_and_are_objects(self):
        for name in self.EXPORTED:
            with self.subTest(schema=name):
                s = getattr(schema, name)
                self.assertIsInstance(s, dict)
                self.assertEqual(s.get("type"), "object")
                self.assertIn("required", s)
                self.assertIn("properties", s)

    def test_application_report_forbids_provider_generation(self):
        s = schema.APPLICATION_REPORT_SCHEMA
        self.assertEqual(
            s["properties"]["provider"].get("enum"), ["none"],
            "application reports must only ever claim provider=none in this lane",
        )
        self.assertEqual(
            s["properties"]["dry_run"].get("enum"), [True],
            "application reports must never claim a live provider run",
        )


if __name__ == "__main__":
    unittest.main()
