"""Offline graph contracts; no provider or network access."""

import importlib.util
import json
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

SCRIPT = (
    Path(__file__).resolve().parents[1]
    / "skills/taste-application/scripts/workflow_graphs.py"
)
spec = importlib.util.spec_from_file_location("workflow_graphs", SCRIPT)
graphs = importlib.util.module_from_spec(spec)
spec.loader.exec_module(graphs)


class WorkflowGraphTests(unittest.TestCase):
    def test_style_is_compiled_and_neutral_grade_is_explicit(self):
        cfg = {
            "brief": "A dancer",
            "style_steer": "wireframe motion",
            "source_video": "https://example.org/own.mp4",
        }
        original = dict(cfg)
        first = graphs.compile_application_input(cfg)
        second = graphs.compile_application_input(
            {**cfg, "style_steer": "handheld motion"}
        )
        self.assertNotEqual(first["compiled_prompt"], second["compiled_prompt"])
        self.assertIn("WHAT", first["compiled_prompt"])
        self.assertIn("HOW", first["compiled_prompt"])
        self.assertIn("Render neutral", first["compiled_prompt"])
        self.assertEqual(cfg, original)
        self.assertEqual(
            set(first), set(graphs.load_graph("apply")["contents"]["schema"]["input"])
        )

    def test_templates_wired_and_blank(self):
        for kind in ("apply", "apply-motion", "distill", "prop3d"):
            graph = graphs.load_graph(kind)
            graphs.validate_graph(graph)
            self.assertEqual(set(graph), {"name", "title", "contents"})
            for field in graph["contents"]["schema"]["input"].values():
                self.assertEqual(field["defaultValue"], "")
                self.assertTrue(field["required"])
        nodes = graphs.load_graph("apply")["contents"]["nodes"]
        self.assertEqual(nodes["node-merge"]["input"]["target_fps"], 30)
        for name in ("node-gen1", "node-gen2", "node-gen3"):
            self.assertEqual(nodes[name]["input"]["prompt"], "$input.compiled_prompt")
            self.assertEqual(nodes[name]["input"]["audio_urls"], [])
            self.assertIs(nodes[name]["input"]["generate_audio"], False)

    def test_distill_supplied_grounding_only(self):
        cfg = {
            "genre": "Industrial",
            "measured_grounding": "Measured source: local/report.json; cadence 0.6 seconds.",
            "references": [
                "https://example.org/a",
                "https://example.org/b",
                "https://example.org/c",
            ],
        }
        data = graphs.prepare_distillation_input(cfg)
        self.assertIn(cfg["measured_grounding"], data["measured_grounding"])
        self.assertIn("Industrial", data["measured_grounding"])
        self.assertEqual(
            set(data), set(graphs.load_graph("distill")["contents"]["schema"]["input"])
        )
        rendered = json.dumps(graphs.load_graph("distill"))
        for inherited in (
            "190 sampled",
            "FlashEthereal",
            "hunyuan",
            "model_glb",
            "77 cuts",
        ):
            self.assertNotIn(inherited, rendered)
        for bad in (
            {**cfg, "genre": ""},
            {**cfg, "measured_grounding": ""},
            {**cfg, "references": cfg["references"][:2]},
        ):
            with self.assertRaises(ValueError):
                graphs.prepare_distillation_input(bad)

    def test_optional_motion_variant_preserves_application_contract(self):
        still = graphs.load_graph('apply')
        motion = graphs.load_graph('apply-motion')
        self.assertEqual(still['contents']['schema'], motion['contents']['schema'])
        self.assertNotEqual(still['name'], motion['name'])
        for name in ('node-gen1', 'node-gen2', 'node-gen3'):
            original = still['contents']['nodes'][name]['input']
            variant = motion['contents']['nodes'][name]['input']
            self.assertNotIn('video_urls', original)
            self.assertEqual(variant['video_urls'], ['$input.source_video'])
            self.assertEqual({k: v for k, v in variant.items() if k != 'video_urls'}, original)
        self.assertEqual(motion['contents']['nodes']['node-merge']['input']['target_fps'], 30)
        payload = graphs.compile_application_input({'brief': 'a', 'style_steer': 'b',
                                                   'source_video': 'https://example.org/own.mp4'})
        self.assertEqual(set(payload), set(motion['contents']['schema']['input']))

    def test_bad_inputs_fail(self):
        for source in ("file:///tmp/private", "http://example.org/a", "", 42):
            with self.assertRaises(ValueError):
                graphs.compile_application_input(
                    {"brief": "a", "style_steer": "b", "source_video": source}
                )

    def test_validator_rejects_disconnected_inputs_and_cycles(self):
        graph = graphs.load_graph("apply")
        graph["contents"]["schema"]["input"]["unused"] = {"required": True}
        with self.assertRaises(ValueError):
            graphs.validate_graph(graph)
        graph = graphs.load_graph("apply")
        graph["contents"]["nodes"]["node-xfirst"]["depends"].append("node-merge")
        with self.assertRaises(ValueError):
            graphs.validate_graph(graph)

    def test_validator_rejects_unknown_output_dependency(self):
        graph = graphs.load_graph("apply")
        graph["contents"]["output"]["unexpected"] = "$missing-node.video"
        with self.assertRaises(ValueError):
            graphs.validate_graph(graph)
        graph = graphs.load_graph("apply")
        graph["contents"]["nodes"]["output"]["fields"]["unexpected"] = (
            "$node-xlast.images"
        )
        graph["contents"]["nodes"]["output"]["depends"] = ["node-gen1"]
        with self.assertRaises(ValueError):
            graphs.validate_graph(graph)

    def test_cli_no_overwrite(self):
        with tempfile.TemporaryDirectory() as folder:
            config, out = Path(folder) / "config.json", Path(folder) / "out.json"
            config.write_text(
                json.dumps(
                    {
                        "brief": "a",
                        "style_steer": "b",
                        "source_video": "https://example.org/own.mp4",
                    }
                )
            )
            command = [
                sys.executable,
                str(SCRIPT),
                "--kind",
                "apply",
                "--config",
                str(config),
                "--out",
                str(out),
            ]
            self.assertEqual(subprocess.run(command, capture_output=True).returncode, 0)
            before = out.read_bytes()
            self.assertNotEqual(
                subprocess.run(command, capture_output=True).returncode, 0
            )
            self.assertEqual(out.read_bytes(), before)


if __name__ == "__main__":
    unittest.main()
