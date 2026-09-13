"""Local asset handoff rejects unsupported provenance and changed files."""
import json
import struct
import tempfile
import unittest
from pathlib import Path

from tasteforge.assets import ingest_assets, validate_assets


class AssetTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name).resolve()
        (self.root / 'clip.mp4').write_bytes(b'existing media')
        self.config = self.root / 'input.json'
        self.receipt = self.root / 'receipt.json'
        self.asset = dict(id='clip', modality='video', path='clip.mp4',
                          origin='local_passthrough')

    def ingest(self, assets=None, **extra):
        self.config.write_text(json.dumps(dict(assets=assets or [self.asset], **extra)))
        return ingest_assets(self.config, self.receipt)

    def test_roundtrip_and_lineage(self):
        (self.root / 'genre.json').write_text('{}')
        result = self.ingest(input_artifacts=['genre.json'], genre_spec='genre.json')
        self.assertEqual(validate_assets(self.receipt), result)
        self.assertEqual(result['provider_calls'], 0)
        self.assertIs(result['provider_execution'], False)
        self.assertEqual(result['assets'][0]['bytes'], 14)
        self.assertEqual(result['genre_spec']['sha256'], result['input_artifacts'][0]['sha256'])

    def test_external_result_requires_evidence_and_identifier(self):
        self.asset['origin'] = 'external_result'
        with self.assertRaises(ValueError):
            self.ingest()
        (self.root / 'provider.json').write_text('{"status":"completed"}')
        self.asset['provider_provenance'] = dict(provider='fal', request_id='abc',
                                                evidence_path='provider.json')
        result = self.ingest()
        self.assertEqual(result['assets'][0]['provider_provenance']['request_id'], 'abc')
        self.assertFalse(result['provider_execution'])
        (self.root / 'provider.json').write_text('{}')
        with self.assertRaises(ValueError):
            validate_assets(self.receipt)

    def test_recovered_does_not_infer_provider(self):
        self.asset['origin'] = 'recovered_unverified'
        result = self.ingest()
        self.assertNotIn('provider_provenance', result['assets'][0])

    def test_changed_media_and_lineage_rejected(self):
        self.ingest()
        (self.root / 'clip.mp4').write_bytes(b'changed')
        with self.assertRaises(ValueError):
            validate_assets(self.receipt)

    def test_glb_header(self):
        path = self.root / 'model.glb'
        path.write_bytes(struct.pack('<4sII', b'glTF', 2, 12))
        self.asset.update(modality='3d_asset', path='model.glb')
        self.ingest()
        self.receipt.unlink()
        for header in [(b'xxxx', 2, 12), (b'glTF', 1, 12), (b'glTF', 2, 99)]:
            path.write_bytes(struct.pack('<4sII', *header))
            with self.assertRaises(ValueError):
                self.ingest()

    def test_duplicate_invalid_remote_empty_and_special(self):
        with self.assertRaises(ValueError):
            self.ingest([self.asset, self.asset])
        for update in [dict(modality='audio'), dict(path='https://example.org/a.mp4'),
                       dict(path='.'), dict(id=''), dict(origin='generated')]:
            with self.assertRaises(ValueError):
                self.ingest([{**self.asset, **update}])

    def test_symlink_and_symlink_parent(self):
        (self.root / 'link.mp4').symlink_to(self.root / 'clip.mp4')
        with self.assertRaises(ValueError):
            self.ingest([{**self.asset, 'path': 'link.mp4'}])
        (self.root / 'alias').symlink_to(self.root, target_is_directory=True)
        with self.assertRaises(ValueError):
            self.ingest([{**self.asset, 'path': 'alias/clip.mp4'}])

    def test_no_overwrites_or_collisions(self):
        self.ingest()
        original = self.receipt.read_bytes()
        with self.assertRaises(ValueError):
            self.ingest()
        self.assertEqual(original, self.receipt.read_bytes())
        with self.assertRaises(ValueError):
            ingest_assets(self.config, self.config)

    def test_tampered_receipt_operation_and_duplicates(self):
        result = self.ingest()
        for patch in [dict(provider_calls=1), dict(provider_calls=False),
                      dict(provider_execution=True), dict(assets=result['assets'] * 2)]:
            self.receipt.write_text(json.dumps({**result, **patch}))
            with self.assertRaises(ValueError):
                validate_assets(self.receipt)

    def test_bundle_binds_exact_request_and_revalidates(self):
        from tasteforge.workflow import run_workflow
        workflow = self.root / 'workflow.json'
        workflow.write_text(json.dumps(dict(
            schema_version=1, run_id='assets-test', seed=42,
            genres=[dict(number=1, slug='flash', label='Flash', references=['clip.mp4'],
                         signature=dict(materials=['chrome'], motion=['orbit'],
                                        composition=['center'], avoid=['mud']))])))
        bundle = self.root / 'bundle'
        run_workflow(workflow, bundle, probe=lambda path: dict(
            duration=6.0, width=1920, height=1080, fps=24.0, codec='fixture',
            sample_times=[0.75, 2.25, 3.75], scene_changes=[0.75, 2.25]))
        self.asset['request_id'] = 'assets-test-1-video'
        result = self.ingest(bundle_dir='bundle')
        self.assertEqual(result['assets'][0]['genre_slug'], 'flash')
        self.assertEqual(validate_assets(self.receipt), result)
        self.receipt.unlink()
        self.asset['request_id'] = 'assets-test-1-image'
        with self.assertRaises(ValueError):
            self.ingest(bundle_dir='bundle')
        self.asset['request_id'] = 'assets-test-1-video'
        self.asset['genre_slug'] = 'invented'
        with self.assertRaises(ValueError):
            self.ingest(bundle_dir='bundle')
        result['assets'][0]['style_fingerprint'] = 'fabricated'
        self.receipt.write_text(json.dumps(result))
        with self.assertRaises(ValueError):
            validate_assets(self.receipt)

    def test_invalid_provenance_and_lineage_shapes(self):
        for provenance in [None, {}, dict(provider='fal', evidence_path='clip.mp4'),
                           dict(provider='fal', request_id='', evidence_path='clip.mp4'),
                           dict(provider='fal', request_id='id', evidence_path='missing.json')]:
            with self.assertRaises(ValueError):
                self.ingest([{**self.asset, 'origin': 'external_result',
                              'provider_provenance': provenance}])
        with self.assertRaises(ValueError):
            self.ingest(input_artifacts='clip.mp4')
        with self.assertRaises(ValueError):
            self.ingest([{**self.asset, 'provider_provenance': {'provider': 'fal'}}])
        with self.assertRaises(ValueError):
            self.ingest([{**self.asset, 'genre_slug': 'invented'}])

    def test_special_file_and_missing_output_directory(self):
        import os
        os.mkfifo(self.root / 'pipe')
        with self.assertRaises(ValueError):
            self.ingest([{**self.asset, 'path': 'pipe'}])
        self.receipt = self.root / 'missing' / 'receipt.json'
        with self.assertRaises(ValueError):
            self.ingest()

    def test_mutated_lineage_and_invalid_receipt_bindings(self):
        (self.root / 'genre.json').write_text('{}')
        result = self.ingest(genre_spec='genre.json')
        (self.root / 'genre.json').write_text('{"changed":true}')
        with self.assertRaises(ValueError):
            validate_assets(self.receipt)
        for patch in [dict(schema='wrong'), dict(input_artifacts=None),
                      dict(genre_spec=None)]:
            self.receipt.write_text(json.dumps({**result, **patch}))
            with self.assertRaises(ValueError):
                validate_assets(self.receipt)

    def test_invalid_json_shapes(self):
        for value in [[], {}, {'assets': []}, {'assets': [None]}]:
            self.config.write_text(json.dumps(value))
            with self.assertRaises(ValueError):
                ingest_assets(self.config, self.receipt)


if __name__ == '__main__':
    unittest.main()
