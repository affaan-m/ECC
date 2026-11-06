"""Regressions for receipt ownership and self-contained harness documentation."""
import copy
import sys
import unittest
from pathlib import Path
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'scripts'))
import compile_contribution_review as compiler  # noqa: E402
from test_compile_contribution_review import worked  # noqa: E402


class PacketReviewFixTests(unittest.TestCase):
    def test_compile_does_not_mutate_output_receipt(self):
        receipt = compiler._output_receipt(False)
        before = copy.deepcopy(receipt)
        with patch.object(compiler, '_output_receipt', return_value=receipt):
            packet = compiler.compile_contract(worked(), Path('observation.json'))
        self.assertEqual(before, receipt)
        self.assertIsNot(receipt, packet['returnReceipt'])
        self.assertEqual(packet['semanticChecksum'], compiler.checksum(packet))

    def test_harness_documentation_targets_exist_and_match_canonical(self):
        repo = ROOT.parents[1]
        for harness in ('.agents', '.cursor'):
            mirror = repo / harness / 'skills/ecc-contribution-review'
            for relative in ('docs/WORKFLOW.md', 'docs/DESIGN.md',
                             'references/contribution-review-contract.md'):
                with self.subTest(harness=harness, target=relative):
                    target = mirror / relative
                    self.assertTrue(target.is_file(), str(target))
                    self.assertEqual((ROOT / relative).read_bytes(), target.read_bytes())
