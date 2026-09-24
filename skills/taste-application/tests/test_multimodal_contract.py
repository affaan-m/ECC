import hashlib
import json
import tempfile
import unittest
from pathlib import Path

from tasteforge.contract import (
    ContractError,
    validate_artifact_receipt,
    validate_effect_recipe,
    validate_genre_specs,
    validate_manifests,
    validate_provenance,
)


class GenreContractTests(unittest.TestCase):
    def test_genre_spec_requires_explicit_dry_run_true(self):
        spec = {
            "number": 1,
            "slug": "flash-ethereal",
            "style_fingerprint": "a" * 64,
            "signature": {
                "materials": ["glass bloom"],
                "motion": ["hard-cut flash"],
                "composition": ["centered subject"],
                "avoid": ["muddy shadows"],
            },
            "dry_run": False,
        }
        with self.assertRaisesRegex(ContractError, "dry-run|dry_run"):
            validate_genre_specs([spec])

    def test_empty_avoid_signature_is_rejected(self):
        spec = {
            "number": 1,
            "slug": "flash-ethereal",
            "style_fingerprint": "a" * 64,
            "signature": {
                "materials": ["glass bloom"],
                "motion": ["hard-cut flash"],
                "composition": ["centered subject"],
                "avoid": [],
            },
            "dry_run": True,
        }
        with self.assertRaisesRegex(ContractError, "avoid|empty"):
            validate_genre_specs([spec])

    def test_collapsing_references_into_one_generic_style_is_rejected(self):
        generic = {
            "signature": {
                "materials": ["cinematic"],
                "motion": ["dynamic"],
                "composition": ["beautiful"],
                "avoid": [],
            },
            "style_fingerprint": "same",
        }
        specs = [
            {**generic, "number": 1, "slug": "flash-ethereal"},
            {**generic, "number": 2, "slug": "3d-cyber-glitch"},
            {**generic, "number": 3, "slug": "fluid-sketch"},
        ]
        with self.assertRaisesRegex(ContractError, "collapsed|distinct"):
            validate_genre_specs(specs)


class ResolveRecipeContractTests(unittest.TestCase):
    def _valid_recipe(self):
        recipe = {
            "dry_run": True,
            "provider_calls": 0,
            "provider_execution": False,
            "seed": 41,
            "rng_algorithm": "python.random.Random/v1",
            "periodic": False,
            "timeline_duration": 6.0,
            "events": [
                {"time": 0.2, "duration": 0.2, "effect": "bloom", "placement": self._placement()},
                {"time": 1.1, "duration": 0.2, "effect": "bloom", "placement": self._placement()},
                {"time": 2.7, "duration": 0.2, "effect": "bloom", "placement": self._placement()},
                {"time": 5.5, "duration": 0.2, "effect": "bloom", "placement": self._placement()},
            ],
        }
        for event in recipe["events"]:
            event["evidence"] = {
                "reference_sha256": "a" * 64,
                "time": 0.5,
                "source_duration": 6.0,
            }
        return recipe

    def test_numeric_timeline_and_evidence_values_must_be_finite_reals(self):
        cases = (
            ("timeline_duration", None, float("nan")),
            ("timeline_duration", None, float("inf")),
            ("timeline_duration", None, True),
            ("time", 0, float("nan")),
            ("time", 0, float("inf")),
            ("time", 0, True),
            ("duration", 0, float("nan")),
            ("duration", 0, float("inf")),
            ("duration", 0, True),
        )
        for field, event_index, unsafe in cases:
            with self.subTest(field=field, unsafe=unsafe):
                recipe = self._valid_recipe()
                target = recipe if event_index is None else recipe["events"][event_index]
                target[field] = unsafe
                with self.assertRaisesRegex(ContractError, "finite|timeline|duration|start"):
                    validate_effect_recipe(recipe)

    def test_effect_evidence_time_must_be_within_finite_source_duration(self):
        for field, unsafe in (
            ("time", float("nan")),
            ("time", float("inf")),
            ("time", True),
            ("time", 6.1),
            ("source_duration", float("nan")),
            ("source_duration", float("inf")),
            ("source_duration", True),
        ):
            with self.subTest(field=field, unsafe=unsafe):
                recipe = self._valid_recipe()
                recipe["events"][0]["evidence"][field] = unsafe
                with self.assertRaisesRegex(ContractError, "evidence|source duration"):
                    validate_effect_recipe(recipe)

    def test_effect_recipe_requires_exact_disabled_provider_state(self):
        for field, unsafe in (
            ("dry_run", False),
            ("provider_calls", 1),
            ("provider_calls", False),
            ("provider_execution", True),
        ):
            with self.subTest(field=field):
                recipe = self._valid_recipe()
                recipe[field] = unsafe
                with self.assertRaisesRegex(ContractError, "dry-run|provider"):
                    validate_effect_recipe(recipe)

    def test_anchor_evidence_time_must_be_within_finite_source_duration(self):
        for field, unsafe in (
            ("evidence_time", float("nan")),
            ("evidence_time", float("inf")),
            ("evidence_time", True),
            ("evidence_time", 6.1),
            ("source_duration", float("nan")),
            ("source_duration", float("inf")),
            ("source_duration", True),
        ):
            with self.subTest(field=field, unsafe=unsafe):
                recipe = self._valid_recipe()
                event = recipe["events"][1]
                event.update({
                    "effect": "cv_wireframe_lock",
                    "requires_subject_anchor": True,
                    "subject_anchor": {
                        "mode": "segmentation_track",
                        "target": "primary_subject",
                        "source_ref_sha256": "a" * 64,
                        "evidence_time": 0.5,
                        "source_duration": 6.0,
                        "lost_policy": "disable_effect_until_track_recovers",
                    },
                })
                event["subject_anchor"][field] = unsafe
                with self.assertRaisesRegex(ContractError, "anchor evidence|source duration"):
                    validate_effect_recipe(recipe)

    def test_event_start_before_zero_is_rejected(self):
        recipe = self._valid_recipe()
        recipe["events"][0]["time"] = -0.01
        with self.assertRaisesRegex(ContractError, "timeline|start"):
            validate_effect_recipe(recipe)

    def test_event_end_after_timeline_is_rejected(self):
        recipe = self._valid_recipe()
        recipe["events"][-1].update({"time": 5.9, "duration": 0.2})
        with self.assertRaisesRegex(ContractError, "timeline|end"):
            validate_effect_recipe(recipe)

    def test_cv_anchor_continue_without_anchor_policy_is_rejected(self):
        recipe = self._valid_recipe()
        recipe["events"][1].update({
            "effect": "cv_wireframe_lock",
            "requires_subject_anchor": True,
            "subject_anchor": {
                "mode": "segmentation_track",
                "target": "primary_subject",
                "source_ref_sha256": "a" * 64,
                "evidence_time": 0.0,
                "lost_policy": "continue_without_anchor",
            },
        })
        with self.assertRaisesRegex(ContractError, "lost|anchor|fail"):
            validate_effect_recipe(recipe)

    def test_repeating_interval_cycle_is_rejected_as_periodic(self):
        recipe = {
            "seed": 41,
            "rng_algorithm": "python.random.Random/v1",
            "periodic": False,
            "timeline_duration": 8.0,
            "events": [
                {"time": 1.0, "effect": "bloom"},
                {"time": 2.0, "effect": "bloom"},
                {"time": 4.0, "effect": "bloom"},
                {"time": 5.0, "effect": "bloom"},
                {"time": 7.0, "effect": "bloom"},
            ],
        }
        recipe = self._complete_recipe(recipe)
        with self.assertRaisesRegex(ContractError, "periodic"):
            validate_effect_recipe(recipe)

    def test_seed_without_declared_rng_algorithm_is_rejected(self):
        recipe = {
            "seed": 41,
            "periodic": False,
            "events": [
                {"time": 1.0, "effect": "bloom"},
                {"time": 2.2, "effect": "bloom"},
                {"time": 4.9, "effect": "bloom"},
                {"time": 8.3, "effect": "bloom"},
            ],
        }
        recipe = self._complete_recipe(recipe)
        with self.assertRaisesRegex(ContractError, "seed|algorithm"):
            validate_effect_recipe(recipe)

    def test_unseeded_schedule_is_rejected(self):
        recipe = {
            "periodic": False,
            "rng_algorithm": "python.random.Random/v1",
            "events": [
                {"time": 1.0, "effect": "bloom"},
                {"time": 2.2, "effect": "bloom"},
                {"time": 4.9, "effect": "bloom"},
            ],
        }
        recipe = self._complete_recipe(recipe)
        with self.assertRaisesRegex(ContractError, "seed"):
            validate_effect_recipe(recipe)

    def test_cv_effect_with_placeholder_anchor_is_rejected(self):
        recipe = {
            "seed": 41,
            "rng_algorithm": "python.random.Random/v1",
            "periodic": False,
            "timeline_duration": 9.0,
            "events": [
                {"time": 1.0, "duration": 0.2, "effect": "bloom"},
                {
                    "time": 2.2,
                    "duration": 0.2,
                    "effect": "cv_boxes",
                    "requires_subject_anchor": True,
                    "subject_anchor": {"mode": "frame_center"},
                },
                {"time": 4.9, "duration": 0.2, "effect": "bloom"},
                {"time": 8.3, "duration": 0.2, "effect": "bloom"},
            ],
        }
        recipe = self._complete_recipe(recipe)
        with self.assertRaisesRegex(ContractError, "subject anchor"):
            validate_effect_recipe(recipe)

    def test_cv_effect_cannot_bypass_anchor_by_clearing_requirement_flag(self):
        recipe = {
            "seed": 41,
            "rng_algorithm": "python.random.Random/v1",
            "periodic": False,
            "timeline_duration": 9.0,
            "events": [
                {"time": 1.0, "duration": 0.2, "effect": "bloom", "placement": self._placement()},
                {"time": 2.2, "duration": 0.2, "effect": "cv_wireframe_lock",
                 "requires_subject_anchor": False, "placement": self._placement()},
                {"time": 4.9, "duration": 0.2, "effect": "bloom", "placement": self._placement()},
                {"time": 8.3, "duration": 0.2, "effect": "bloom", "placement": self._placement()},
            ],
        }
        recipe = self._complete_recipe(recipe)
        with self.assertRaisesRegex(ContractError, "subject anchor"):
            validate_effect_recipe(recipe)

    def _complete_recipe(self, recipe):
        recipe.update({
            "dry_run": True,
            "provider_calls": 0,
            "provider_execution": False,
        })
        recipe.setdefault("timeline_duration", 10.0)
        for event in recipe["events"]:
            event.setdefault("duration", 0.2)
            event.setdefault("placement", self._placement())
            event.setdefault("evidence", {
                "reference_sha256": "a" * 64,
                "time": 0.5,
                "source_duration": 6.0,
            })
        return recipe

    @staticmethod
    def _placement():
        return {
            "safe_area": 0.08,
            "max_coverage": 0.35,
            "occlusion_policy": "preserve_subject_face_and_readable_type",
        }


class ProvenanceContractTests(unittest.TestCase):
    def test_reference_evidence_times_must_be_finite_and_within_source_duration(self):
        for field, unsafe in (
            ("times", [float("nan")]),
            ("times", [float("inf")]),
            ("times", [True]),
            ("times", [6.1]),
            ("source_duration", float("nan")),
            ("source_duration", float("inf")),
            ("source_duration", True),
        ):
            with self.subTest(field=field, unsafe=unsafe):
                evidence = {
                    "reference_sha256": "a" * 64,
                    "times": [0.5],
                    "source_duration": 6.0,
                }
                evidence[field] = unsafe
                payload = {"rules": [{
                    "rule_id": "genre-1-materials",
                    "rule": ["glass bloom"],
                    "evidence": [evidence],
                }]}
                with self.assertRaisesRegex(ContractError, "time evidence|source duration"):
                    validate_provenance(payload)

    def test_rule_without_reference_time_evidence_is_rejected(self):
        payload = {
            "rules": [{
                "rule_id": "genre-1-materials",
                "rule": ["glass bloom"],
                "evidence": [{"reference_sha256": "a" * 64, "times": []}],
            }],
        }
        with self.assertRaisesRegex(ContractError, "time evidence"):
            validate_provenance(payload)


class ManifestContractTests(unittest.TestCase):
    def test_boolean_provider_calls_is_rejected_for_manifest_and_request(self):
        for unsafe_scope in ("manifest", "request"):
            with self.subTest(scope=unsafe_scope), tempfile.TemporaryDirectory() as tmp:
                root = Path(tmp)
                for modality in ("image", "video", "3d_asset"):
                    request = {
                        "prompt": modality,
                        "dry_run": True,
                        "submit": False,
                        "provider_calls": False if unsafe_scope == "request" and modality == "video" else 0,
                        "provider_execution": False,
                        "provider_call_mode": "disabled",
                    }
                    payload = {
                        "modality": modality,
                        "dry_run": True,
                        "submit": False,
                        "provider_calls": False if unsafe_scope == "manifest" and modality == "video" else 0,
                        "provider_execution": False,
                        "requests": [request],
                    }
                    (root / f"{modality}.json").write_text(json.dumps(payload), encoding="utf-8")
                with self.assertRaisesRegex(ContractError, "dry-run boundary"):
                    validate_manifests(root)

    def test_request_with_dry_run_false_is_rejected(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            for modality in ("image", "video", "3d_asset"):
                (root / f"{modality}.json").write_text(json.dumps({
                    "modality": modality,
                    "dry_run": True,
                    "submit": False,
                    "provider_calls": 0,
                    "provider_execution": False,
                    "requests": [{
                        "prompt": modality,
                        "dry_run": modality != "video",
                        "submit": False,
                        "provider_calls": 0,
                        "provider_execution": False,
                        "provider_call_mode": "disabled",
                    }],
                }), encoding="utf-8")
            with self.assertRaisesRegex(ContractError, "dry-run boundary"):
                validate_manifests(root)

    def test_missing_3d_asset_manifest_is_rejected(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            for modality in ("image", "video"):
                (root / f"{modality}.json").write_text(json.dumps({
                    "modality": modality,
                    "dry_run": True,
                    "provider_calls": 0,
                    "requests": [{"prompt": modality}],
                }), encoding="utf-8")
            with self.assertRaisesRegex(ContractError, "3d_asset"):
                validate_manifests(root)

    def test_manifest_with_provider_execution_enabled_is_rejected(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            for modality in ("image", "video", "3d_asset"):
                (root / f"{modality}.json").write_text(json.dumps({
                    "modality": modality,
                    "dry_run": True,
                    "provider_calls": 0,
                    "provider_execution": modality == "video",
                    "requests": [{
                        "genre_number": 1,
                        "style_fingerprint": "a" * 64,
                        "prompt": modality,
                        "submit": False,
                        "provider_call_mode": "disabled",
                        "provider_execution": False,
                    }],
                }), encoding="utf-8")
            with self.assertRaisesRegex(ContractError, "dry-run boundary"):
                validate_manifests(root)


class ArtifactReceiptContractTests(unittest.TestCase):
    def test_unbound_emitted_artifact_is_rejected(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            (root / "unbound.json").write_text("{}\n", encoding="utf-8")
            with self.assertRaisesRegex(ContractError, "unbound emitted artifact"):
                validate_artifact_receipt(root, {"evidence_artifacts": []})

    def test_provider_execution_or_missing_provenance_is_rejected(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            artifact = root / "artifact.json"
            artifact.write_text("{}\n", encoding="utf-8")
            entry = {
                "path": "artifact.json",
                "bytes": artifact.stat().st_size,
                "sha256": "a" * 64,
                "genre_numbers": [],
                "modalities": [],
                "provider_execution": True,
                "provenance": [],
            }
            with self.assertRaisesRegex(ContractError, "provider execution"):
                validate_artifact_receipt(root, {"evidence_artifacts": [entry]})

    def test_artifact_byte_tampering_is_rejected(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            artifact = root / "artifact.json"
            artifact.write_text("{}\n", encoding="utf-8")
            entry = {
                "path": "artifact.json",
                "bytes": artifact.stat().st_size,
                "sha256": "0" * 64,
                "genre_numbers": [1],
                "modalities": ["image"],
                "provider_execution": False,
                "provenance": [{
                    "reference_path": "/reference.mov",
                    "reference_sha256": "b" * 64,
                    "reference_times": [0.5],
                    "time_basis": "media_seconds",
                }],
            }
            with self.assertRaisesRegex(ContractError, "SHA-256"):
                validate_artifact_receipt(root, {"evidence_artifacts": [entry]})

    def test_unknown_provenance_source_is_rejected(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            artifact = root / "artifact.json"
            artifact.write_text("{}\n", encoding="utf-8")
            digest = hashlib.sha256(artifact.read_bytes()).hexdigest()
            receipt = {
                "references": [],
                "evidence_files": [],
                "evidence_artifacts": [{
                    "path": "artifact.json",
                    "bytes": artifact.stat().st_size,
                    "sha256": digest,
                    "genre_numbers": [1],
                    "modalities": ["image"],
                    "provider_execution": False,
                    "provenance": [{
                        "reference_path": "/unknown.mov",
                        "reference_sha256": "b" * 64,
                        "reference_times": [0.5],
                        "time_basis": "media_seconds",
                    }],
                }],
            }
            with self.assertRaisesRegex(ContractError, "unknown provenance source"):
                validate_artifact_receipt(root, receipt)

    def test_receipt_digest_mismatch_is_rejected(self):
        with tempfile.TemporaryDirectory() as tmp:
            receipt = {"evidence_artifacts": [], "receipt_sha256": "0" * 64}
            with self.assertRaisesRegex(ContractError, "receipt SHA-256"):
                validate_artifact_receipt(tmp, receipt)


if __name__ == "__main__":
    unittest.main()
