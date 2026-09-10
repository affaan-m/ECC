"""Failing-first tests for applying a pack to local media (deterministic only)."""

from __future__ import annotations

import sys
import tempfile
import shutil
import unittest
from pathlib import Path
from unittest.mock import Mock

REPO_ROOT = Path(__file__).resolve().parents[1] / "scripts"
sys.path.insert(0, str(REPO_ROOT))

from tasteforge import apply as apply_mod  # noqa: E402
from tasteforge import pack as pack_mod  # noqa: E402
from tasteforge import schema, timeline  # noqa: E402

FIXTURE = Path(__import__("tasteforge").__file__).resolve().parent / "fixtures" / "flashethereal"

MEDIA = {
    "clips": [
        {"path": "/tmp/media/shot_a.mov", "duration": 6.2, "name": "shot_a"},
        {"path": "/tmp/media/shot_b.mov", "duration": 4.8, "name": "shot_b"},
        {"path": "/tmp/media/shot_c.mov", "duration": 8.1, "name": "shot_c"},
    ]
}


class ApplyLocalTests(unittest.TestCase):
    def test_apply_local_report_is_schema_valid(self):
        sp = pack_mod.load(FIXTURE)
        report = apply_mod.apply_local(sp, MEDIA["clips"])
        problems = schema.validate(report, schema.APPLICATION_REPORT_SCHEMA)
        self.assertEqual(problems, [])

    def test_report_claims_no_provider(self):
        report = apply_mod.apply_local(pack_mod.load(FIXTURE), MEDIA["clips"])
        self.assertEqual(report["provider"], "none")
        self.assertTrue(report["dry_run"])
        self.assertEqual(report["mode"], "local-deterministic")

    def test_planned_shots_follow_cadence_and_fill_duration(self):
        sp = pack_mod.load(FIXTURE)
        report = apply_mod.apply_local(sp, MEDIA["clips"], duration=20.0)
        durations = [s["duration"] for s in report["planned_shots"]]
        self.assertGreater(len(durations), 3, "77-cut cadence must not plan 3 shots")
        self.assertLessEqual(sum(durations), 20.0 + max(durations))
        self.assertEqual(len(report["timeline_events"]), len(durations))

    def test_apply_local_deterministic(self):
        sp = pack_mod.load(FIXTURE)
        a = apply_mod.apply_local(sp, MEDIA["clips"], duration=12.0)
        b = apply_mod.apply_local(sp, MEDIA["clips"], duration=12.0)
        a.pop("generated"), b.pop("generated")
        self.assertEqual(a, b)

    def test_events_reference_local_paths(self):
        report = apply_mod.apply_local(pack_mod.load(FIXTURE), MEDIA["clips"], duration=8.0)
        for event in report["timeline_events"]:
            self.assertTrue(event["path"].startswith("/tmp/media/"))
            self.assertGreater(event["frames"], 0)

    def test_provider_generation_fails_closed(self):
        with self.assertRaises(apply_mod.ProviderDisabledError):
            apply_mod.apply_generate(pack_mod.load(FIXTURE), brief="x")


class StrictApplyTests(unittest.TestCase):
    def setUp(self):
        self.pack = Mock(name="pack")
        self.pack.name = "test-pack"
        self.pack.read_json.return_value = {"fps": 24, "shots": [{"duration": 1.0}]}

    def clips(self, *durations):
        return [{"path": f"/tmp/strict-{i}.mov", "duration": d}
                for i, d in enumerate(durations)]

    def test_default_still_repeats(self):
        report = apply_mod.apply_local(self.pack, self.clips(1), duration=3)
        self.assertEqual(len(report["timeline_events"]), 3)

    def test_strict_rejects_insufficient_unique_clips(self):
        with self.assertRaisesRegex(ValueError, "unique"):
            apply_mod.apply_local(self.pack, self.clips(8), duration=3, no_repeat=True)

    def test_strict_normalizes_relative_absolute_and_symlink_aliases(self):
        with tempfile.TemporaryDirectory() as td:
            source = Path(td) / "source.mov"
            source.touch()
            alias = Path(td) / "alias.mov"
            alias.symlink_to(source)
            media = [{"path": str(p), "duration": 5}
                     for p in (source, source.parent / ".." / source.parent.name / source.name, alias)]
            with self.assertRaisesRegex(ValueError, "unique"):
                apply_mod.apply_local(self.pack, media, duration=2, no_repeat=True)

    def test_strict_rejects_short_sources(self):
        with self.assertRaisesRegex(ValueError, "source|short"):
            apply_mod.apply_local(self.pack, self.clips(.5, .5), duration=2, no_repeat=True)

    def test_strict_quantization_never_rounds_source_capacity_up(self):
        self.pack.read_json.return_value = {"fps": 10, "shots": [{"duration": .16}]}
        with self.assertRaisesRegex(ValueError, "source|short"):
            apply_mod.apply_local(self.pack, self.clips(.16), duration=.16, no_repeat=True)

    def test_successful_strict_plan_fills_tail_and_uses_each_source_once(self):
        report = apply_mod.apply_local(self.pack, self.clips(2, 2, 2),
                                      duration=2.25, fps=20, no_repeat=True)
        events = report["timeline_events"]
        self.assertEqual(sum(e["frames"] for e in events), 45)
        self.assertEqual(len({e["path"] for e in events}), len(events))
        self.assertEqual([e["offset_frames"] for e in events], [0, 20, 40])
        self.assertTrue(all(e["fps"] == 20 for e in events))
        self.assertEqual(report["planned_shots"][-1]["end"], 2.25)
        self.assertEqual(schema.validate(report, schema.APPLICATION_REPORT_SCHEMA), [])

    def test_strict_stops_when_rounded_cadence_has_filled_target(self):
        self.pack.read_json.return_value = {"fps": 30, "shots": [{"duration": .1006}]}
        report = apply_mod.apply_local(self.pack, self.clips(*([1] * 1100)),
                                      duration=100, no_repeat=True)
        events = report["timeline_events"]
        self.assertEqual(sum(e["frames"] for e in events), 3000)
        self.assertTrue(all(e["frames"] > 0 for e in events))
        self.assertEqual(report["planned_shots"][-1]["end"], 100)

    def test_strict_accepts_exact_frame_source_duration_float_boundaries(self):
        for fps, frames in ((24, 4), (23.976, 4), (29.97, 5), (59.94, 10)):
            duration = float(frames / timeline.fps_fraction(fps))
            with self.subTest(fps=fps):
                self.pack.read_json.return_value = {"fps": fps, "shots": [{"duration": duration}]}
                report = apply_mod.apply_local(self.pack, self.clips(duration),
                                              duration=duration, no_repeat=True)
                event = report["timeline_events"][0]
                self.assertEqual(event["frames"], frames)
                self.assertLessEqual(event["duration"], duration)

    def test_strict_frame_duration_metadata_does_not_round_past_source(self):
        report = apply_mod.apply_local(self.pack, self.clips(.016668),
                                      duration=1 / 60, fps=60, no_repeat=True)
        event = report["timeline_events"][0]
        self.assertEqual(event["frames"], 1)
        self.assertLessEqual(event["duration"], .016668)
        self.assertEqual(event["duration"], 1 / 60)

    def test_strict_preserves_manifest_order_instead_of_reassigning_short_source(self):
        self.pack.read_json.return_value = {"fps": 24, "shots": [{"duration": 2}]}
        with self.assertRaisesRegex(ValueError, "source.*short"):
            apply_mod.apply_local(self.pack, self.clips(1, 2), duration=3, no_repeat=True)
        report = apply_mod.apply_local(self.pack, self.clips(2, 1), duration=3, no_repeat=True)
        self.assertEqual([e["path"] for e in report["timeline_events"]],
                         [str(Path(c["path"]).resolve()) for c in self.clips(2, 1)])
        self.assertEqual(sum(e["frames"] for e in report["timeline_events"]), 72)

    def test_strict_is_deterministic_and_does_not_mutate_inputs(self):
        media = self.clips(2, 2, 2)
        before = [dict(clip) for clip in media]
        first = apply_mod.apply_local(self.pack, media, duration=2.25, no_repeat=True)
        second = apply_mod.apply_local(self.pack, media, duration=2.25, no_repeat=True)
        self.assertEqual(first["timeline_events"], second["timeline_events"])
        self.assertEqual(media, before)

    def test_plan_shots_rejects_invalid_target_and_cadence(self):
        for invalid in (True, 0, -1, float("nan"), float("inf"), None):
            with self.subTest(value=invalid):
                with self.assertRaises(ValueError):
                    apply_mod.plan_shots({}, invalid)
                with self.assertRaises(ValueError):
                    apply_mod.plan_shots({"shots": [{"duration": invalid}]}, 2)

    def test_missing_or_empty_cadence_is_not_defaulted(self):
        with tempfile.TemporaryDirectory() as td:
            pack = pack_mod.load(shutil.copytree(FIXTURE, Path(td) / "pack"))
            pack.cadence_path.unlink()
            with self.assertRaisesRegex(ValueError, "cadence"):
                apply_mod.apply_local(pack, self.clips(2), duration=2)
            pack.cadence_path.write_text("{}")
            with self.assertRaisesRegex(ValueError, "cadence"):
                apply_mod.apply_local(pack, self.clips(2), duration=2)
        with self.assertRaisesRegex(ValueError, "cadence"):
            apply_mod.plan_shots({"shots": []}, 2)
        self.assertEqual(apply_mod.plan_shots({"shots": [], "mean_shot": 2.0}, 2), [2.0])

    def test_explicit_fps_overrides_pack_in_default_mode(self):
        report = apply_mod.apply_local(self.pack, self.clips(2), duration=1, fps=30)
        self.assertEqual(report["timeline_events"][0]["frames"], 30)

    def test_invalid_target_fps_and_media_duration_are_rejected(self):
        for invalid in (0, -1, float("nan"), float("inf"), True, False, "invalid"):
            for field in ("duration", "fps", "media"):
                with self.subTest(field=field, value=invalid), self.assertRaises(ValueError):
                    kwargs = {field: invalid} if field != "media" else {}
                    media = self.clips(invalid if field == "media" else 2)
                    apply_mod.apply_local(self.pack, media, **kwargs)

    def test_invalid_cadence_fps_is_not_masked_by_default(self):
        for invalid in (0, float("nan"), float("inf"), True):
            with self.subTest(value=invalid), self.assertRaises(ValueError):
                self.pack.read_json.return_value = {"fps": invalid}
                apply_mod.apply_local(self.pack, self.clips(2))

    def test_strict_rejects_subframe_target(self):
        with self.assertRaisesRegex(ValueError, "frame"):
            apply_mod.apply_local(self.pack, self.clips(2), duration=.001, no_repeat=True)


if __name__ == "__main__":
    unittest.main()
