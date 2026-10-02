"""Synthetic, local-only acceptance tests for preserving an existing edit."""

import copy
import hashlib
import json
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock

from tasteforge.integration import build_application_bundle, validate_application_bundle


SCRIPT = Path(__file__).resolve().parents[1] / "scripts" / "workflow_graphs.py"
PAYLOAD = {"source_video": "https://media.example/source.mov", "compiled_prompt": "Test motion"}


class ApplicationBundleTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name).resolve()
        self.rate = {"numerator": 30, "denominator": 1}
        self.source = self.artifact("source.mov", b"synthetic original video")
        self.audio = self.artifact("music.wav", b"synthetic music")
        self.snapshot = {
            "project": "Synthetic project", "timeline": "Original timeline",
            "settings": {"timelineFrameRate": 30.0},
            "timeline_readback": {
                "video1": [self.clip(self.source["path"], 0, 120, 3, 2)],
                "video2": [self.clip("/synthetic/contour.mov", 25, 38, 0, 0)],
                "video3": [self.clip("/synthetic/disabled-bloom.mov", 20, 45, 0, 0, False)],
                "audio1": [self.clip(self.audio["path"], 0, 117, 0, 1)],
            },
        }
        self.config = {
            "baseline": {
                "project_file": self.artifact("project.drp", b"synthetic native project"),
                "snapshot_file": self.artifact("snapshot.json", self.snapshot),
                "project_name": "Synthetic project", "timeline_name": "Original timeline",
                "fps": self.rate, "timeline_range": [0, 120],
            },
            "source": self.binding(self.source, "video1", 125, [3, 123], [0, 120]),
            "audio": [self.binding(self.audio, "audio1", 118, [0, 117], [0, 117])],
            "protected_intervals": [{"range": [24, 40], "reason": "Original hand treatment"}],
        }

    def artifact(self, name, content):
        data = json.dumps(content).encode() if isinstance(content, dict) else content
        path = self.root / name
        path.write_bytes(data)
        return {"path": str(path), "bytes": len(data), "sha256": hashlib.sha256(data).hexdigest()}

    @staticmethod
    def clip(path, start, end, left, right, enabled=True):
        return {"path": path, "name": Path(path).name, "start": start, "end": end,
                "left_offset": left, "right_offset": right, "enabled": enabled,
                "properties": {"Opacity": 88.0, "CompositeMode": 0}}

    def binding(self, media, track, frames, source_range, timeline_range):
        return {"media": media, "track": track, "clip_index": 0, "media_frames": frames,
                "fps": self.rate, "source_range": source_range, "timeline_range": timeline_range}

    def approved_insert(self):
        media = self.artifact("candidate.mov", b"synthetic generated variation")
        candidate = {
            "id": "take-1", "media": media, "media_frames": 30, "fps": self.rate,
            "origin": "provider_generated", "relationship": "generated_variation",
            "source_sha256": self.source["sha256"], "review_status": "approved",
            "compiled_input_sha256": hashlib.sha256(
                json.dumps(PAYLOAD, sort_keys=True, separators=(",", ":"), allow_nan=False).encode()
            ).hexdigest(),
        }
        candidate["generation_receipt"] = self.artifact("generation.json", {
            "request_id": "synthetic-request", "source_url": PAYLOAD["source_video"],
            "source_sha256": self.source["sha256"], "candidate_sha256": media["sha256"],
            "compiled_input_sha256": candidate["compiled_input_sha256"],
        })
        insert = {"candidate_id": "take-1", "candidate_range": [2, 14],
                  "timeline_range": [60, 72], "retime": "none"}
        approval = {"status": "approved", "candidate_sha256": media["sha256"],
                    "source_sha256": self.source["sha256"],
                    "compiled_input_sha256": candidate["compiled_input_sha256"],
                    "candidate_range": [2, 14], "timeline_range": [60, 72]}
        approval["edit_context_sha256"] = hashlib.sha256(json.dumps(
            {key: self.config[key] for key in ("baseline", "source", "audio", "protected_intervals")},
            sort_keys=True, separators=(",", ":"), allow_nan=False).encode()).hexdigest()
        insert["approval_file"] = self.artifact("approval.json", approval)
        self.config["candidates"] = [candidate]
        self.config["inserts"] = [insert]
        return candidate, insert, approval

    def test_default_bundle_preserves_baseline_audio_and_entire_protected_stack(self):
        before = copy.deepcopy(self.config)
        bundle = build_application_bundle(self.config, PAYLOAD)
        self.assertEqual(self.config, before)
        self.assertEqual(bundle["mode"], "preserve_native_timeline")
        self.assertEqual(bundle["baseline"], before["baseline"])
        self.assertEqual(bundle["audio"], before["audio"])
        self.assertEqual(bundle["inserts"], [])
        self.assertEqual(bundle["provider_calls"], 0)
        self.assertIs(type(bundle["provider_calls"]), int)
        self.assertIs(bundle["provider_execution"], False)
        self.assertIs(bundle["submit"], False)
        self.assertEqual(bundle["provider_input"], PAYLOAD)
        self.assertEqual({c["track"] for c in bundle["protected_stack"]},
                         {"video1", "video2", "video3", "audio1"})
        disabled = next(c for c in bundle["protected_stack"] if c["track"] == "video3")
        self.assertEqual(disabled["clip"], self.snapshot["timeline_readback"]["video3"][0])
        self.assertEqual(validate_application_bundle(bundle), None)
        bundle["audio"][0]["timeline_range"][1] = 116
        self.assertEqual(self.config, before)

    def test_deterministic_bundle_and_no_provider_calls(self):
        with mock.patch("socket.socket", side_effect=AssertionError("network forbidden")), \
             mock.patch("subprocess.run", side_effect=AssertionError("process forbidden")):
            self.assertEqual(build_application_bundle(self.config, PAYLOAD),
                             build_application_bundle(self.config, PAYLOAD))

    def test_approved_insert_is_an_additive_video_only_proposal(self):
        self.approved_insert()
        bundle = build_application_bundle(self.config, PAYLOAD)
        self.assertEqual(len(bundle["inserts"]), 1)
        self.assertEqual(bundle["insert_policy"], "new_video_track_preserve_baseline_audio")
        self.assertEqual(bundle["audio"], self.config["audio"])
        validate_application_bundle(bundle)

    def test_pending_rejected_and_historical_urls_never_become_inserts(self):
        candidate, _, _ = self.approved_insert()
        for state in ["pending", "rejected", "unknown"]:
            candidate["review_status"] = state
            with self.subTest(state=state), self.assertRaises(ValueError):
                build_application_bundle(self.config, PAYLOAD)
        candidate["review_status"] = "pending"
        self.config["inserts"] = []
        self.assertEqual(build_application_bundle(self.config, PAYLOAD)["inserts"], [])
        candidate["media"] = {"url": "https://media.example/historical.mov"}
        with self.assertRaises(ValueError):
            build_application_bundle(self.config, PAYLOAD)

    def test_protected_overlap_rejected_including_one_frame(self):
        _, insert, approval = self.approved_insert()
        for span in [[12, 25], [39, 51], [24, 40]]:
            insert["timeline_range"] = span
            insert["candidate_range"] = [0, span[1] - span[0]]
            insert["approval_file"] = self.artifact("approval.json", {
                **approval, "timeline_range": span, "candidate_range": insert["candidate_range"]})
            with self.subTest(span=span), self.assertRaisesRegex(ValueError, "protected"):
                build_application_bundle(self.config, PAYLOAD)

    def test_approval_binds_both_source_and_exact_placement(self):
        _, insert, approval = self.approved_insert()
        for field, value in [("status", "pending"), ("source_sha256", "0" * 64),
                             ("candidate_sha256", "1" * 64),
                             ("compiled_input_sha256", "2" * 64),
                             ("timeline_range", [72, 84]), ("candidate_range", [3, 15])]:
            altered = {**approval, field: value}
            insert["approval_file"] = self.artifact("approval.json", altered)
            with self.subTest(field=field), self.assertRaises(ValueError):
                build_application_bundle(self.config, PAYLOAD)

    def test_approval_cannot_transfer_to_another_edit_or_timebase(self):
        self.approved_insert()
        for field in ["baseline", "fps", "protected"]:
            cfg = copy.deepcopy(self.config)
            if field == "baseline":
                cfg["baseline"]["project_file"] = self.artifact("other.drp", b"another edit")
            elif field == "fps":
                cfg["baseline"]["fps"]["numerator"] = 60
                changed_snapshot = {**self.snapshot, "settings": {"timelineFrameRate": 60.0}}
                cfg["baseline"]["snapshot_file"] = self.artifact("other-snapshot.json", changed_snapshot)
            else:
                cfg["protected_intervals"][0]["range"] = [24, 41]
            with self.subTest(field=field), self.assertRaisesRegex(ValueError, "approval"):
                build_application_bundle(cfg, PAYLOAD)

    def test_original_claim_wrong_source_or_wrong_input_is_rejected(self):
        candidate, _, _ = self.approved_insert()
        for field, value in [("origin", "original"), ("relationship", "original_hgx"),
                             ("source_sha256", "0" * 64), ("compiled_input_sha256", "1" * 64)]:
            prior = candidate[field]
            candidate[field] = value
            with self.subTest(field=field), self.assertRaises(ValueError):
                build_application_bundle(self.config, PAYLOAD)
            candidate[field] = prior

    def test_exact_integer_frames_and_rational_fps(self):
        for bad in [True, False, 1.0, float("nan"), float("inf"), -1, "30"]:
            for key in ["numerator", "denominator"]:
                cfg = copy.deepcopy(self.config)
                cfg["baseline"]["fps"][key] = bad
                with self.subTest(key=key, bad=bad), self.assertRaises(ValueError):
                    build_application_bundle(cfg, PAYLOAD)
            cfg = copy.deepcopy(self.config)
            cfg["protected_intervals"][0]["range"][0] = bad
            with self.subTest(frame=bad), self.assertRaises(ValueError):
                build_application_bundle(cfg, PAYLOAD)

    def test_source_binding_must_match_native_clip_and_capacity(self):
        for field, value in [("source_range", [0, 120]), ("timeline_range", [1, 121]),
                             ("media_frames", 124), ("clip_index", True),
                             ("track", "video2"), ("fps", {"numerator": 24, "denominator": 1})]:
            cfg = copy.deepcopy(self.config)
            cfg["source"][field] = value
            with self.subTest(field=field), self.assertRaises(ValueError):
                build_application_bundle(cfg, PAYLOAD)

    def test_audio_cannot_be_dropped_retimed_or_extended(self):
        for audio in [[], self.config["audio"] * 2,
                      [{**self.config["audio"][0], "timeline_range": [0, 120]}]]:
            with self.subTest(audio=audio), self.assertRaises(ValueError):
                build_application_bundle({**self.config, "audio": audio}, PAYLOAD)

    def test_mismatched_fps_duration_retime_and_overlapping_inserts(self):
        candidate, insert, approval = self.approved_insert()
        candidate["fps"] = {"numerator": 30000, "denominator": 1001}
        with self.assertRaisesRegex(ValueError, "retime ambiguity"):
            build_application_bundle(self.config, PAYLOAD)
        candidate["fps"] = self.rate
        for field, value in [("retime", "fit"), ("candidate_range", [2, 15]),
                             ("candidate_range", [20, 32]), ("timeline_range", [115, 127])]:
            original = insert[field]
            insert[field] = value
            insert["approval_file"] = self.artifact("approval.json", {
                **approval, "timeline_range": insert["timeline_range"],
                "candidate_range": insert["candidate_range"]})
            reason = "retime ambiguity" if field == "retime" or value == [2, 15] else "bounds"
            with self.subTest(field=field), self.assertRaisesRegex(ValueError, reason):
                build_application_bundle(self.config, PAYLOAD)
            insert[field] = original
        insert["approval_file"] = self.artifact("approval.json", approval)
        self.config["inserts"].append(copy.deepcopy(insert))
        with self.assertRaisesRegex(ValueError, "proposals overlap"):
            build_application_bundle(self.config, PAYLOAD)

    def test_missing_mutated_or_symlink_artifacts_are_rejected(self):
        path = Path(self.source["path"])
        original = path.read_bytes()
        path.write_bytes(b"changed original")
        with self.assertRaises(ValueError):
            build_application_bundle(self.config, PAYLOAD)
        path.unlink()
        with self.assertRaises(ValueError):
            build_application_bundle(self.config, PAYLOAD)
        target = self.root / "target.mov"
        target.write_bytes(original)
        path.symlink_to(target)
        with self.assertRaises(ValueError):
            build_application_bundle(self.config, PAYLOAD)

    def test_bundle_tampering_flags_omissions_and_extra_fields_fail(self):
        bundle = build_application_bundle(self.config, PAYLOAD)
        for field, value in [("provider_calls", False), ("provider_execution", True),
                             ("submit", True), ("dry_run", False), ("protected_stack", []),
                             ("mode", "replace_timeline"), ("extra", "unbound")]:
            with self.subTest(field=field), self.assertRaises(ValueError):
                validate_application_bundle({**bundle, field: value})
        del bundle["audio"]
        with self.assertRaises(ValueError):
            validate_application_bundle(bundle)

    def test_unresolved_hash_numeric_size_and_duplicate_json_fields_are_rejected(self):
        for field, value in [("sha256", None), ("sha256", "https://media.example/a.mov"),
                             ("bytes", True), ("bytes", 1.5)]:
            cfg = copy.deepcopy(self.config)
            cfg["source"]["media"][field] = value
            with self.subTest(field=field), self.assertRaises(ValueError):
                build_application_bundle(cfg, PAYLOAD)
        self.config["baseline"]["snapshot_file"] = self.artifact(
            "snapshot.json", b'{"project":"first","project":"second"}')
        with self.assertRaisesRegex(ValueError, "duplicate"):
            build_application_bundle(self.config, PAYLOAD)

    def test_parent_symlink_special_file_and_cloud_placeholder_are_not_read(self):
        path = Path(self.source["path"])
        alias = self.root / "alias"
        alias.symlink_to(self.root, target_is_directory=True)
        cfg = copy.deepcopy(self.config)
        cfg["source"]["media"]["path"] = str(alias / path.name)
        with self.assertRaises(ValueError):
            build_application_bundle(cfg, PAYLOAD)
        import os
        path.unlink()
        os.mkfifo(path)
        with self.assertRaises(ValueError):
            build_application_bundle(self.config, PAYLOAD)
        path.unlink()
        path.write_bytes(b"synthetic original video")
        actual_stat = os.stat

        def cloud_stat(target, *args, **kwargs):
            info = actual_stat(target, *args, **kwargs)
            if target == path.name:
                return mock.Mock(st_mode=info.st_mode, st_flags=0x40000000)
            return info

        with mock.patch("tasteforge.integration.os.stat", side_effect=cloud_stat), \
             mock.patch("tasteforge.integration.os.read", wraps=os.read) as read:
            with self.assertRaisesRegex(ValueError, "resident"):
                build_application_bundle(self.config, PAYLOAD)
            # Only baseline project/snapshot were read; the placeholder never opened.
            self.assertTrue(read.called)

    def test_generation_receipt_drift_and_unselected_history_are_distinct(self):
        candidate, _, _ = self.approved_insert()
        evidence = json.loads(Path(candidate["generation_receipt"]["path"]).read_text())
        for field in ["request_id", "source_url", "source_sha256", "candidate_sha256",
                      "compiled_input_sha256"]:
            bad = {**evidence, field: ""}
            candidate["generation_receipt"] = self.artifact("generation.json", bad)
            with self.subTest(field=field), self.assertRaises(ValueError):
                build_application_bundle(self.config, PAYLOAD)
        self.config["candidates"] = []
        self.config["inserts"] = []
        self.config["historical_receipts"] = [self.artifact("history.json", {
            "request_id": "old", "output_url": "https://media.example/unknown.mov"})]
        bundle = build_application_bundle(self.config, PAYLOAD)
        self.assertEqual(bundle["inserts"], [])
        self.assertEqual(bundle["candidates"], [])

    def test_source_subset_and_ntsc_rate_preserve_exact_frame_mapping(self):
        self.config["source"]["source_range"] = [13, 33]
        self.config["source"]["timeline_range"] = [10, 30]
        self.rate.update(numerator=30000, denominator=1001)
        self.snapshot["settings"]["timelineFrameRate"] = "29.97"
        self.config["baseline"]["snapshot_file"] = self.artifact("snapshot.json", self.snapshot)
        bundle = build_application_bundle(self.config, PAYLOAD)
        self.assertEqual(bundle["source"]["timeline_range"], [10, 30])
        self.assertEqual(bundle["baseline"]["fps"], self.rate)

    def test_missing_or_conflicting_native_fps_is_rejected(self):
        for settings in [{}, {"timelineFrameRate": "24"}, {"timelineFrameRate": True}]:
            self.snapshot["settings"] = settings
            self.config["baseline"]["snapshot_file"] = self.artifact("snapshot.json", self.snapshot)
            with self.subTest(settings=settings), self.assertRaisesRegex(ValueError, "fps"):
                build_application_bundle(self.config, PAYLOAD)

    def test_exponent_fps_is_rejected_before_fraction_allocation(self):
        self.snapshot["settings"]["timelineFrameRate"] = "1e1000000000"
        self.config["baseline"]["snapshot_file"] = self.artifact("snapshot.json", self.snapshot)
        with mock.patch("tasteforge.integration.Fraction", side_effect=AssertionError("unsafe allocation")):
            with self.assertRaisesRegex(ValueError, "fps"):
                build_application_bundle(self.config, PAYLOAD)

    def test_fileless_native_generator_is_preserved_without_becoming_a_source(self):
        self.snapshot["timeline_readback"]["video4"] = [{
            **self.clip("unused", 24, 40, 0, 0), "path": None, "name": "Native title"}]
        self.config["baseline"]["snapshot_file"] = self.artifact("snapshot.json", self.snapshot)
        bundle = build_application_bundle(self.config, PAYLOAD)
        generator = next(row for row in bundle["protected_stack"] if row["track"] == "video4")
        self.assertIsNone(generator["clip"]["path"])
        self.config["source"]["track"] = "video4"
        with self.assertRaises(ValueError):
            build_application_bundle(self.config, PAYLOAD)

    def test_parent_directory_substitution_during_read_is_rejected(self):
        from tasteforge import integration
        import os
        parent = self.root / "reference"
        parent.mkdir()
        record = self.artifact("reference/source.mov", b"original bytes")
        actual_read = os.read
        replaced = False

        def replace_parent(descriptor, length):
            nonlocal replaced
            data = actual_read(descriptor, length)
            if not replaced:
                replaced = True
                parent.rename(self.root / "moved-reference")
                parent.mkdir()
                (parent / "source.mov").write_bytes(b"different bytes")
            return data

        with mock.patch("tasteforge.integration.os.read", side_effect=replace_parent):
            with self.assertRaisesRegex(ValueError, "changed"):
                integration._artifact(record)

    def test_invalid_cli_bundle_creates_no_output_and_does_not_overwrite(self):
        config = {"source_video": PAYLOAD["source_video"], "brief": "Synthetic test",
                  "style_steer": "Original motion", "integration": self.config}
        cfg_file = self.root / "request.json"
        cfg_file.write_text(json.dumps(config))
        output = self.root / "bundle.json"
        output.write_text("original file")
        command = [sys.executable, str(SCRIPT), "--kind", "apply-bundle", "--config",
                   str(cfg_file), "--out", str(output)]
        proc = subprocess.run(command, capture_output=True, text=True)
        self.assertEqual(proc.returncode, 2)
        self.assertEqual(output.read_text(), "original file")
        output.unlink()
        config["integration"]["source"]["media"]["sha256"] = "0" * 64
        cfg_file.write_text(json.dumps(config))
        proc = subprocess.run(command, capture_output=True, text=True)
        self.assertEqual(proc.returncode, 2)
        self.assertFalse(output.exists())
        self.assertNotIn("Traceback", proc.stderr)

    def test_bundle_cli_refuses_symlink_request_without_output(self):
        cfg = {"source_video": PAYLOAD["source_video"], "brief": "Synthetic",
               "style_steer": "Synthetic", "integration": self.config}
        real = self.root / "request.json"
        real.write_text(json.dumps(cfg))
        alias = self.root / "alias.json"
        alias.symlink_to(real)
        out = self.root / "bundle.json"
        proc = subprocess.run([sys.executable, str(SCRIPT), "--kind", "apply-bundle",
                               "--config", str(alias), "--out", str(out)],
                              capture_output=True, text=True)
        self.assertEqual(proc.returncode, 2)
        self.assertFalse(out.exists())

    def test_growing_artifact_is_rejected_before_accumulating_unbounded_data(self):
        from tasteforge import integration
        record = self.config["baseline"]["project_file"]
        with mock.patch("tasteforge.integration.os.read", side_effect=[b"x" * (record["bytes"] + 1), b""]):
            with self.assertRaisesRegex(ValueError, "byte count exceeded"):
                integration._artifact(record)

    def test_cli_bundle_compilation_and_legacy_payload_are_separate(self):
        config = {"source_video": PAYLOAD["source_video"], "brief": "Synthetic test",
                  "style_steer": "Original motion", "integration": self.config}
        config_file = self.root / "request.json"
        config_file.write_text(json.dumps(config))
        for kind in ["apply", "apply-bundle"]:
            proc = subprocess.run([sys.executable, str(SCRIPT), "--kind", kind,
                                   "--config", str(config_file), "--out", str(self.root / kind)],
                                  capture_output=True, text=True)
            self.assertEqual(proc.returncode, 0, proc.stderr)
        plain = json.loads((self.root / "apply").read_text())
        bundle = json.loads((self.root / "apply-bundle").read_text())
        self.assertEqual(set(plain), {"source_video", "compiled_prompt"})
        self.assertEqual(bundle["provider_input"], plain)
        validate_application_bundle(bundle)

    def run_local_cli(self, request, *, suffix="local"):
        config = self.root / (suffix + "-request.json")
        output = self.root / (suffix + "-bundle.json")
        config.write_text(json.dumps(request))
        proc = subprocess.run([sys.executable, str(SCRIPT), "--kind", "apply-bundle",
                               "--config", str(config), "--out", str(output)],
                              capture_output=True, text=True)
        return proc, output

    def test_local_only_cli_compiles_preservation_without_hosted_source(self):
        proc, output = self.run_local_cli({"local_only": True, "integration": self.config})
        self.assertEqual(proc.returncode, 0, proc.stderr)
        bundle = json.loads(output.read_text())
        self.assertIs(bundle["local_only"], True)
        self.assertIsNone(bundle["provider_input"])
        self.assertIsNone(bundle["compiled_input_sha256"])
        self.assertEqual(bundle["provider_input_status"], "not_prepared_local_only")
        self.assertEqual(bundle["insert_policy"], "none_preserve_baseline")
        self.assertEqual(bundle["inserts"], [])
        self.assertEqual(bundle["candidates"], [])
        self.assertEqual(bundle["baseline"], self.config["baseline"])
        self.assertEqual(bundle["source"], self.config["source"])
        self.assertEqual(bundle["audio"], self.config["audio"])
        self.assertEqual(len(bundle["protected_stack"]), 4)
        self.assertIs(bundle["submit"], False)
        self.assertIs(bundle["provider_execution"], False)
        validate_application_bundle(bundle)

    def test_local_only_flag_is_exact_boolean_in_cli_and_api(self):
        for i, bad in enumerate([None, 0, 1, "true", "false", [], {}]):
            with self.subTest(flag=bad), self.assertRaisesRegex(ValueError, "local_only"):
                build_application_bundle(self.config, None, local_only=bad)
            request = {"local_only": bad, "integration": self.config,
                       "source_video": PAYLOAD["source_video"], "brief": "Synthetic",
                       "style_steer": "Synthetic"}
            proc, output = self.run_local_cli(request, suffix=f"flag-{i}")
            self.assertEqual(proc.returncode, 2, proc.stderr)
            self.assertIn("local_only", proc.stderr)
            self.assertFalse(output.exists())

    def test_local_only_rejects_mixed_provider_request_fields(self):
        for i, extra in enumerate([
            {"source_video": PAYLOAD["source_video"], "brief": "Synthetic", "style_steer": "Synthetic"},
            {"source_video": None}, {"provider_input": PAYLOAD}, {"provider_input": None},
            {"compiled_prompt": "Synthetic"}, {"brief": "Uncompiled provider brief"},
        ]):
            proc, output = self.run_local_cli(
                {"local_only": True, "integration": self.config, **extra}, suffix=f"mixed-{i}")
            self.assertEqual(proc.returncode, 2, proc.stderr)
            self.assertIn("local-only request", proc.stderr)
            self.assertFalse(output.exists())
        for supplied in [PAYLOAD, {}, "https://media.example/source.mov"]:
            with self.subTest(supplied=supplied), self.assertRaisesRegex(ValueError, "provider input"):
                build_application_bundle(self.config, supplied, local_only=True)

    def test_local_only_rejects_candidates_and_inserts_before_reading_them(self):
        for field in ["candidates", "inserts"]:
            cfg = {**self.config, field: [{"unresolved": "https://media.example/old.mov"}]}
            with self.subTest(field=field), self.assertRaisesRegex(ValueError, "local-only.*candidates|local-only.*inserts"):
                build_application_bundle(cfg, None, local_only=True)

    def test_local_only_bundle_cannot_switch_modes_or_gain_provider_fields(self):
        bundle = build_application_bundle(self.config, None, local_only=True)
        for field, value in [("local_only", False), ("local_only", 1),
                             ("provider_input", PAYLOAD), ("provider_input", {}),
                             ("compiled_input_sha256", "0" * 64),
                             ("provider_input_status", "prepared"),
                             ("insert_policy", "new_video_track_preserve_baseline_audio")]:
            with self.subTest(field=field), self.assertRaises(ValueError):
                validate_application_bundle({**bundle, field: value})
        without_flag = {k: v for k, v in bundle.items() if k != "local_only"}
        with self.assertRaises(ValueError):
            validate_application_bundle(without_flag)
        normal = build_application_bundle(self.config, PAYLOAD)
        with self.assertRaises(ValueError):
            validate_application_bundle({**normal, "local_only": True})

    def test_local_only_still_revalidates_native_evidence(self):
        bundle = build_application_bundle(self.config, None, local_only=True)
        before = copy.deepcopy(self.config)
        self.assertEqual(build_application_bundle(self.config, None, local_only=True), bundle)
        self.assertEqual(self.config, before)
        Path(self.source["path"]).write_bytes(b"changed media")
        with self.assertRaises(ValueError):
            validate_application_bundle(bundle)

    def test_normal_bundle_default_false_retains_legacy_behavior(self):
        normal = build_application_bundle(self.config, PAYLOAD)
        explicit = build_application_bundle(self.config, PAYLOAD, local_only=False)
        self.assertEqual(normal, explicit)
        self.assertNotIn("local_only", normal)
        self.assertNotIn("provider_input_status", normal)
        with self.assertRaises(ValueError):
            build_application_bundle(self.config, None, local_only=False)
        for local_only in [False, "omitted"]:
            request = {"integration": self.config, "brief": "Synthetic", "style_steer": "Synthetic"}
            if local_only is False:
                request["local_only"] = False
            proc, output = self.run_local_cli(request, suffix=f"normal-{local_only}")
            self.assertEqual(proc.returncode, 2)
            self.assertFalse(output.exists())


if __name__ == "__main__":
    unittest.main()
