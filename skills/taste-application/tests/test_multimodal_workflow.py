import hashlib
import json
import tempfile
import unittest
from pathlib import Path

from tasteforge.contract import ContractError, validate_bundle
from tasteforge.workflow import parse_feature_output, run_workflow


class FeatureExtractionTests(unittest.TestCase):
    def test_ffmpeg_metadata_becomes_timestamped_style_and_scene_features(self):
        output = """
frame:0 pts:0 pts_time:0.75
lavfi.signalstats.YAVG=51
lavfi.signalstats.SATAVG=40
lavfi.signalstats.HUEAVG=15
lavfi.scene_score=0.42
frame:1 pts:1 pts_time:2.25
lavfi.signalstats.YAVG=204
lavfi.signalstats.SATAVG=70
lavfi.signalstats.HUEAVG=20
lavfi.scene_score=0.08
"""
        parsed = parse_feature_output(output)
        self.assertEqual(parsed["scene_changes"], [0.75])
        self.assertEqual([sample["time"] for sample in parsed["style_samples"]], [0.75, 2.25])
        self.assertAlmostEqual(parsed["style_samples"][0]["luma"], 0.2)
        self.assertAlmostEqual(parsed["style_samples"][1]["luma"], 0.8)
        self.assertEqual(parsed["style_samples"][0]["hue"], 15.0)


class MultimodalWorkflowTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.root = Path(self.tmp.name)
        self.references = []
        for name, payload in (
            ("flash.mov", b"flash-ethereal-reference"),
            ("cyber.mov", b"3d-cyber-glitch-reference"),
            ("fluid.mov", b"fluid-sketch-reference"),
        ):
            path = self.root / name
            path.write_bytes(payload)
            self.references.append(path)
        self.editorial = self.root / "FINAL_canvas.edl"
        self.editorial.write_text("TITLE: FINAL_canvas\nFCM: NON-DROP FRAME\n", encoding="utf-8")

        self.config = {
            "schema_version": 1,
            "run_id": "fixture-run",
            "seed": 20260819,
            "evidence_files": [str(self.editorial)],
            "genres": [
                {
                    "number": 1,
                    "slug": "flash-ethereal",
                    "label": "Flash Ethereal",
                    "references": [str(self.references[0])],
                    "signature": {
                        "materials": ["glass bloom", "white phosphor"],
                        "motion": ["hard-cut flash", "slow orbital drift"],
                        "composition": ["high-key centered subject"],
                        "avoid": ["muddy shadows"],
                    },
                },
                {
                    "number": 2,
                    "slug": "3d-cyber-glitch",
                    "label": "3D Cyber Glitch",
                    "references": [str(self.references[1])],
                    "signature": {
                        "materials": ["wireframe chrome", "scanline emissive"],
                        "motion": ["depth orbit", "macroblock rupture"],
                        "composition": ["full-frame 3D interstitial"],
                        "avoid": ["decorative corner mesh"],
                    },
                },
                {
                    "number": 3,
                    "slug": "fluid-sketch",
                    "label": "Fluid Sketch",
                    "references": [str(self.references[2])],
                    "signature": {
                        "materials": ["ink wash", "graphite edge"],
                        "motion": ["nonlinear contour flow", "paper bleed"],
                        "composition": ["negative-space drawing field"],
                        "avoid": ["rigid neon grid"],
                    },
                },
            ],
        }
        self.config_path = self.root / "workflow.json"
        self.config_path.write_text(json.dumps(self.config), encoding="utf-8")

    def tearDown(self):
        self.tmp.cleanup()

    @staticmethod
    def fake_probe(path: Path) -> dict:
        return {
            "duration": 6.0,
            "width": 1920,
            "height": 1080,
            "fps": 24.0,
            "codec": "fixture",
            "sample_times": [0.75, 2.25, 3.75, 5.25],
            "style_samples": [
                {"time": 0.75, "luma": 0.2, "saturation": 0.4},
                {"time": 2.25, "luma": 0.8, "saturation": 0.7},
            ],
            "scene_changes": [0.75, 2.25, 5.25],
        }

    def test_file_driven_run_emits_distinct_genres_and_all_modality_manifests(self):
        out = self.root / "out"
        receipt = run_workflow(self.config_path, out, probe=self.fake_probe)

        self.assertTrue(receipt["dry_run"])
        self.assertEqual(receipt["provider_calls"], 0)
        self.assertEqual(len(receipt["references"]), 3)
        self.assertEqual(len(receipt["evidence_files"]), 1)
        self.assertEqual(receipt["evidence_files"][0]["kind"], "editorial")
        self.assertEqual(len(receipt["evidence_files"][0]["sha256"]), 64)
        self.assertTrue(all(len(ref["sha256"]) == 64 for ref in receipt["references"]))
        emitted = {
            path.relative_to(out).as_posix()
            for path in out.rglob("*")
            if path.is_file() and path.name != "receipt.json"
        }
        bound = {artifact["path"] for artifact in receipt["evidence_artifacts"]}
        self.assertEqual(bound, emitted)
        self.assertTrue({
            "manifests/image.json", "manifests/video.json", "manifests/3d_asset.json"
        }.issubset(bound))
        self.assertTrue(receipt["evidence_artifacts"])
        for artifact in receipt["evidence_artifacts"]:
            self.assertGreater(artifact["bytes"], 0)
            self.assertEqual(len(artifact["sha256"]), 64)
            self.assertIn("genre_numbers", artifact)
            self.assertIn("modalities", artifact)
            self.assertFalse(artifact["provider_execution"])
            self.assertTrue(artifact["provenance"])
            for source in artifact["provenance"]:
                self.assertTrue(source["reference_path"])
                self.assertEqual(len(source["reference_sha256"]), 64)
                self.assertIn("reference_times", source)
                self.assertIn(source["time_basis"], {"media_seconds", "whole_file"})

        specs = [json.loads(path.read_text()) for path in sorted((out / "genres").glob("*.json"))]
        self.assertEqual([spec["number"] for spec in specs], [1, 2, 3])
        self.assertEqual(len({spec["style_fingerprint"] for spec in specs}), 3)
        self.assertEqual({spec["label"] for spec in specs}, {
            "Flash Ethereal", "3D Cyber Glitch", "Fluid Sketch"
        })
        for spec in specs:
            temporal = spec["measured_features"]["temporal"]
            style = spec["measured_features"]["style"]
            self.assertEqual(temporal["scene_change_count"], 3)
            self.assertGreater(temporal["scene_interval_variance"], 0)
            self.assertAlmostEqual(style["luma_mean"], 0.5)
            self.assertAlmostEqual(style["saturation_mean"], 0.55)

        for modality in ("image", "video", "3d_asset"):
            manifest = json.loads((out / "manifests" / f"{modality}.json").read_text())
            self.assertEqual(manifest["modality"], modality)
            self.assertEqual(manifest.get("provider_calls"), 0)
            self.assertIs(manifest.get("provider_execution"), False)
            self.assertIs(manifest.get("dry_run"), True)
            self.assertIs(manifest.get("submit"), False)
            self.assertEqual(len(manifest["requests"]), 3)
            self.assertTrue(all(request["prompt"] for request in manifest["requests"]))
            self.assertTrue(all(request["dry_run"] for request in manifest["requests"]))
            self.assertTrue(all(request["provider_call_mode"] == "disabled" for request in manifest["requests"]))
            self.assertTrue(all(request.get("provider_calls") == 0 for request in manifest["requests"]))
            self.assertTrue(all(request.get("provider_execution") is False for request in manifest["requests"]))
            self.assertTrue(all(request.get("dry_run") is True for request in manifest["requests"]))
            self.assertTrue(all(request.get("submit") is False for request in manifest["requests"]))
            self.assertTrue(all(request["endpoint_candidate"] for request in manifest["requests"]))
            self.assertTrue(all(request["request_body"]["prompt"] == request["prompt"]
                                for request in manifest["requests"]))

        validate_bundle(out)
        recipe = json.loads((out / "resolve" / "effect_recipe.json").read_text())
        self.assertEqual(recipe["seed"], self.config["seed"])
        self.assertFalse(recipe["periodic"])
        cv_events = [event for event in recipe["events"] if event["requires_subject_anchor"]]
        self.assertTrue(cv_events)
        self.assertTrue(all(event["subject_anchor"]["source_ref_sha256"] for event in cv_events))
        self.assertTrue(all(event["placement"]["max_coverage"] <= 0.35 for event in recipe["events"]))

    def test_probe_and_hash_use_stable_bytes_and_fail_on_source_mutation(self):
        original = self.references[0].read_bytes()
        observed = []

        def mutating_probe(snapshot: Path) -> dict:
            observed.append(snapshot.read_bytes())
            self.references[0].write_bytes(b"mutated-during-probe")
            return self.fake_probe(snapshot)

        with self.assertRaisesRegex(ValueError, "mutat|changed|stable"):
            run_workflow(self.config_path, self.root / "race-out", probe=mutating_probe)

        self.assertEqual(observed, [original])

    def test_symlinked_output_root_is_rejected_before_writes(self):
        real_output = self.root / "real-output"
        real_output.mkdir()
        linked_output = self.root / "linked-output"
        linked_output.symlink_to(real_output, target_is_directory=True)

        with self.assertRaisesRegex(ValueError, "symlink|output"):
            run_workflow(self.config_path, linked_output, probe=self.fake_probe)

        self.assertEqual(list(real_output.iterdir()), [])

    def test_symlinked_output_intermediate_is_rejected_without_escape(self):
        out = self.root / "out"
        out.mkdir()
        victim = self.root / "victim"
        victim.mkdir()
        (out / "manifests").symlink_to(victim, target_is_directory=True)

        with self.assertRaisesRegex(ValueError, "symlink|output"):
            run_workflow(self.config_path, out, probe=self.fake_probe)

        self.assertEqual(list(victim.iterdir()), [])

    def test_non_directory_output_intermediate_is_rejected(self):
        out = self.root / "out"
        out.mkdir()
        (out / "genres").write_text("not a directory", encoding="utf-8")

        with self.assertRaisesRegex(ValueError, "directory|output"):
            run_workflow(self.config_path, out, probe=self.fake_probe)

        self.assertEqual((out / "genres").read_text(encoding="utf-8"), "not a directory")

    def test_short_timeline_never_emits_out_of_bounds_forced_events(self):
        self.config["seed"] = 15
        self.config["resolve_duration"] = 6.0
        self.config_path.write_text(json.dumps(self.config), encoding="utf-8")
        out = self.root / "short-out"

        run_workflow(self.config_path, out, probe=self.fake_probe)

        recipe = json.loads((out / "resolve" / "effect_recipe.json").read_text())
        timeline = recipe["timeline_duration"]
        self.assertGreaterEqual(len(recipe["events"]), 3)
        for event in recipe["events"]:
            self.assertGreaterEqual(event["time"], 0)
            self.assertLessEqual(event["time"] + event["duration"], timeline)

    def test_workflow_rejects_dry_run_false_before_output(self):
        self.config["dry_run"] = False
        self.config_path.write_text(json.dumps(self.config), encoding="utf-8")
        out = self.root / "not-dry-run"

        with self.assertRaisesRegex(ValueError, "dry_run|dry-run"):
            run_workflow(self.config_path, out, probe=self.fake_probe)

        self.assertFalse(out.exists())

    def test_bundle_receipt_requires_exact_disabled_provider_state(self):
        for field, unsafe in (
            ("dry_run", False),
            ("provider_calls", False),
            ("provider_calls", 1),
            ("provider_execution", True),
        ):
            with self.subTest(field=field, unsafe=unsafe):
                out = self.root / f"receipt-provider-{field}-{unsafe!s}"
                run_workflow(self.config_path, out, probe=self.fake_probe)
                receipt_path = out / "receipt.json"
                receipt = json.loads(receipt_path.read_text(encoding="utf-8"))
                receipt[field] = unsafe
                digest_payload = dict(receipt)
                digest_payload.pop("receipt_sha256")
                receipt["receipt_sha256"] = hashlib.sha256(
                    json.dumps(digest_payload, sort_keys=True, separators=(",", ":")).encode("utf-8")
                ).hexdigest()
                receipt_path.write_text(json.dumps(receipt), encoding="utf-8")

                with self.assertRaisesRegex(ContractError, "dry-run boundary"):
                    validate_bundle(out)

    def test_receipt_binds_source_duration_and_rejects_out_of_range_times(self):
        for label in ("duration", "time"):
            with self.subTest(field=label):
                out = self.root / f"receipt-bound-{label}"
                run_workflow(self.config_path, out, probe=self.fake_probe)
                receipt_path = out / "receipt.json"
                receipt = json.loads(receipt_path.read_text(encoding="utf-8"))
                if label == "duration":
                    receipt["references"][0]["source_duration"] = 7.0
                else:
                    artifact = next(
                        item for item in receipt["evidence_artifacts"]
                        if item["provenance"][0]["time_basis"] == "media_seconds"
                    )
                    artifact["provenance"][0]["reference_times"] = [6.1]
                digest_payload = dict(receipt)
                digest_payload.pop("receipt_sha256")
                receipt["receipt_sha256"] = hashlib.sha256(
                    json.dumps(digest_payload, sort_keys=True, separators=(",", ":")).encode("utf-8")
                ).hexdigest()
                receipt_path.write_text(json.dumps(receipt), encoding="utf-8")

                with self.assertRaisesRegex(ContractError, "duration|time|evidence"):
                    validate_bundle(out)

    def test_recipe_evidence_duration_must_match_cited_receipt_source(self):
        out = self.root / "recipe-source-duration"
        run_workflow(self.config_path, out, probe=self.fake_probe)
        recipe_path = out / "resolve" / "effect_recipe.json"
        recipe = json.loads(recipe_path.read_text(encoding="utf-8"))
        event = next(item for item in recipe["events"] if item.get("requires_subject_anchor"))
        event["evidence"].update({"time": 99.0, "source_duration": 100.0})
        event["subject_anchor"].update({"evidence_time": 99.0, "source_duration": 100.0})
        recipe_path.write_text(json.dumps(recipe, indent=2, sort_keys=True) + "\n", encoding="utf-8")

        receipt_path = out / "receipt.json"
        receipt = json.loads(receipt_path.read_text(encoding="utf-8"))
        artifact = next(
            item for item in receipt["evidence_artifacts"]
            if item["path"] == "resolve/effect_recipe.json"
        )
        artifact["bytes"] = recipe_path.stat().st_size
        artifact["sha256"] = hashlib.sha256(recipe_path.read_bytes()).hexdigest()
        digest_payload = dict(receipt)
        digest_payload.pop("receipt_sha256")
        receipt["receipt_sha256"] = hashlib.sha256(
            json.dumps(digest_payload, sort_keys=True, separators=(",", ":")).encode("utf-8")
        ).hexdigest()
        receipt_path.write_text(json.dumps(receipt), encoding="utf-8")

        with self.assertRaisesRegex(ContractError, "source duration|reference"):
            validate_bundle(out)

    def test_receipt_rehash_rejects_mutated_available_source(self):
        out = self.root / "mutation-out"
        run_workflow(self.config_path, out, probe=self.fake_probe)

        self.references[0].write_bytes(b"mutated-after-receipt")

        with self.assertRaisesRegex(ContractError, "source|reference|SHA-256|mutat"):
            validate_bundle(out)

    def test_explicit_allow_unavailable_policy_supports_offline_validation(self):
        out = self.root / "offline-out"
        receipt = run_workflow(self.config_path, out, probe=self.fake_probe)
        self.assertEqual(receipt.get("source_availability_policy"), "allow_unavailable")
        for source in [*self.references, self.editorial]:
            source.unlink()

        validate_bundle(out)

    def test_validation_rejects_symlinked_bundle_root(self):
        out = self.root / "real-bundle"
        run_workflow(self.config_path, out, probe=self.fake_probe)
        linked = self.root / "linked-bundle"
        linked.symlink_to(out, target_is_directory=True)

        with self.assertRaisesRegex(ContractError, "symlink"):
            validate_bundle(linked)

    def test_validation_rejects_symlinked_bundle_intermediate(self):
        out = self.root / "bundle"
        run_workflow(self.config_path, out, probe=self.fake_probe)
        external = self.root / "external-manifests"
        (out / "manifests").rename(external)
        (out / "manifests").symlink_to(external, target_is_directory=True)

        with self.assertRaisesRegex(ContractError, "symlink"):
            validate_bundle(out)

    def test_receipt_is_deterministic_across_output_directories(self):
        first = run_workflow(self.config_path, self.root / "first", probe=self.fake_probe)
        second = run_workflow(self.config_path, self.root / "second", probe=self.fake_probe)

        self.assertEqual(first, second)
        self.assertEqual(first["receipt_sha256"], second["receipt_sha256"])


if __name__ == "__main__":
    unittest.main()
