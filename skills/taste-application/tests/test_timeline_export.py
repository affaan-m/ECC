"""Failing-first tests for the timeline timebase and EDL/FCPXML export.

Numeric expectations are canonicalized from the recovered gen4
``taste/timeline.py`` self-checks and the recovered ``flashethereal-cut.edl``.
"""

from __future__ import annotations

import sys
import tempfile
import unittest
import xml.etree.ElementTree as ET
from fractions import Fraction
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[1] / "scripts"
sys.path.insert(0, str(REPO_ROOT))

from tasteforge import export, timeline  # noqa: E402

CLIPS = [
    {"path": "/tmp/media/a.mov", "duration": 1.5, "name": "alpha"},
    {"path": "/tmp/media/b.mov", "duration": 2.25, "name": "beta"},
    {"path": "/tmp/media/c.mov", "duration": 0.75, "name": "gamma"},
]


class TimebaseTests(unittest.TestCase):
    def test_ntsc_snap(self):
        self.assertEqual(timeline.fps_fraction(29.97), Fraction(30000, 1001))
        self.assertEqual(timeline.fps_fraction(23.976), Fraction(24000, 1001))
        self.assertEqual(timeline.fps_fraction(24), Fraction(24, 1))

    def test_negative_fps_rejected(self):
        with self.assertRaises(ValueError):
            timeline.fps_fraction(-3)

    def test_seconds_to_frames_rounds_half_away_from_zero(self):
        self.assertEqual(timeline.seconds_to_frames(0.5, 24), 12)
        self.assertEqual(timeline.seconds_to_frames(1.25, 24), 30)

    def test_rational_time_strings(self):
        self.assertEqual(timeline.frames_to_rational(1, 29.97), "1001/30000s")
        self.assertEqual(timeline.frames_to_rational(30, 29.97), "1001/1000s")
        self.assertEqual(timeline.frames_to_rational(120, 24), "5s")
        self.assertEqual(timeline.seconds_to_rational(2.5, 24), "5/2s")

    def test_timecode_drop_frame(self):
        self.assertEqual(timeline.frames_to_timecode(1800, 29.97), "00:01:00:02")
        self.assertEqual(timeline.frames_to_timecode(17982, 29.97), "00:10:00:00")
        self.assertEqual(timeline.frames_to_timecode(24, 24), "00:00:01:00")


class EDLTests(unittest.TestCase):
    def test_build_edl_header_and_events(self):
        text = export.build_edl(CLIPS, fps=24.0, title="unittest-cut")
        lines = text.splitlines()
        self.assertEqual(lines[0], "TITLE: UNITTEST-CUT")
        self.assertIn("FCM: NON-DROP FRAME", lines)
        event_lines = [ln for ln in lines if ln[:1].isdigit()]
        self.assertEqual(len(event_lines), 3)
        self.assertIn("* FROM CLIP NAME: a.mov", text)

    def test_edl_roundtrip_parses(self):
        text = export.build_edl(CLIPS, fps=24.0, title="rt")
        events = export.parse_edl(text)
        self.assertEqual(len(events), 3)
        self.assertEqual(events[0]["name"], "a.mov")
        self.assertEqual(events[-1]["record_in"], 90)  # 1.5+2.25 s at 24fps
        self.assertEqual(events[-1]["duration_frames"], 18)

    def test_ntsc_edl_is_drop_frame(self):
        text = export.build_edl(CLIPS, fps=29.97, title="ntsc")
        self.assertIn("FCM: DROP FRAME", text)


class FCPXMLTests(unittest.TestCase):
    def test_build_fcpxml_structure(self):
        text = export.build_fcpxml(CLIPS, fps=24.0, title="tf-test")
        root = ET.fromstring(text)
        self.assertEqual(root.tag, "fcpxml")
        self.assertIn("version", root.attrib)
        assets = root.findall("./resources/asset")
        self.assertEqual(len(assets), 3)
        clips = root.findall(".//asset-clip")
        self.assertEqual(len(clips), 3)

    def test_fcpxml_durations_are_rational_and_exact(self):
        text = export.build_fcpxml(CLIPS, fps=24.0, title="tf-test")
        root = ET.fromstring(text)
        clips = root.findall(".//asset-clip")
        # 1.5s @24 -> "7/2s"? No: quantized frames=36 -> "3/2s"
        self.assertEqual(clips[0].get("duration"), "3/2s")
        total = sum(Fraction(c.get("duration").rstrip("s")) for c in clips)
        self.assertEqual(total, Fraction(int(4.5 * 24), 24))

    def test_zero_or_negative_duration_rejected(self):
        with self.assertRaises(ValueError):
            export.build_fcpxml([{"path": "x", "duration": 0}], fps=24)
        with self.assertRaises(ValueError):
            export.build_edl([], fps=24)


class WriteTimelineTests(unittest.TestCase):
    def test_write_timeline_emits_both_formats(self):
        with tempfile.TemporaryDirectory() as td:
            edl, fcpxml = export.write_timeline(CLIPS, out_dir=td, title="wt")
            self.assertTrue(Path(edl).exists())
            self.assertTrue(Path(fcpxml).exists())
            self.assertIn("TITLE: WT", Path(edl).read_text())


if __name__ == "__main__":
    unittest.main()
