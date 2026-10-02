# ruff: noqa: N802 -- fake methods preserve Resolve API names
"""Resolve adapter regression tests; no connection to Resolve is made."""

import json
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

from tasteforge.resolve import allocate_placements, apply_placements, probe_asset


class Item:
    def __init__(self, request):
        self.request = request
        self.start = request["recordFrame"]
        self.frames = request["endFrame"] + 1
        self.props = {"Opacity": 100, "CompositeMode": 0}

    def GetStart(self):
        return self.start

    def GetEnd(self):
        return None if self.start is None else self.start + self.frames

    def GetDuration(self):
        return self.frames

    def GetClipEnabled(self):
        return True

    def GetMediaPoolItem(self):
        return self.request["mediaPoolItem"]

    def GetProperty(self, key=None):
        return self.props.copy() if key is None else self.props[key]

    def SetProperty(self, key, value):
        self.props[key] = value
        return True


class Media:
    def __init__(self, path):
        self.path = path

    def GetClipProperty(self, key):
        return self.path


class Timeline:
    def __init__(self):
        self.tracks = {1: []}

    def GetName(self):
        return "target"

    def GetSetting(self, key):
        return "30"

    def GetTrackCount(self, kind):
        return len(self.tracks) if kind == "video" else 0

    def GetItemListInTrack(self, kind, track):
        return self.tracks[track]

    def AddTrack(self, kind):
        self.tracks[len(self.tracks) + 1] = []
        return True


class Pool:
    def __init__(self, timeline, fault=None, host_mode="inclusive"):
        self.timeline, self.fault, self.calls = timeline, fault, []
        self.host_mode = host_mode

    def ImportMedia(self, paths):
        return [Media(paths[0])]

    def AppendToTimeline(self, requests):
        request = requests[0]
        self.calls.append(request)
        item = Item(request)
        if self.host_mode == "exclusive":
            item.frames -= 1
        self.timeline.tracks[request["trackIndex"]].append(item)
        if self.fault == "null":
            item.start = None
        if self.fault == "shift":
            item.start += 1
        if self.fault == "trim":
            item.frames -= 1
        if self.fault == "later" and len(self.calls) == 2:
            self.timeline.tracks[2][0].frames -= 1
        if self.fault == "disabled":
            item.GetClipEnabled = lambda: False
        if self.fault == "property":
            item.SetProperty = lambda key, value: True
        if self.fault == "path":
            item.request["mediaPoolItem"].path = "/wrong.mov"
        if self.fault == "track":
            self.timeline.tracks[request["trackIndex"]].remove(item)
        if self.fault == "base":
            self.timeline.tracks[1].append(Item(request))
        return [item]


class ResolveTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.path = Path(self.tmp.name) / "asset.mov"
        self.path.write_bytes(b"fixture")
        self.events = [
            dict(
                id="a",
                asset=str(self.path),
                record_frame=0,
                frames=10,
                opacity=88,
                composite=22,
            ),
            dict(
                id="b",
                asset=str(self.path),
                record_frame=5,
                frames=10,
                opacity=100,
                composite=0,
            ),
            dict(
                id="c",
                asset=str(self.path),
                record_frame=10,
                frames=5,
                opacity=50,
                composite=22,
            ),
        ]
        self.probe = lambda path: dict(fps=30, frames=20, has_alpha=True)

    def plan(self, events=None, **kwargs):
        return allocate_placements(
            self.events if events is None else events,
            fps=30,
            base_track_count=1,
            probe=self.probe,
            **kwargs,
        )

    def apply(self, fault=None, source_end_mode="inclusive", host_mode="inclusive"):
        tl = Timeline()
        pool = Pool(tl, fault, host_mode)
        result = apply_placements(
            tl,
            pool,
            self.events,
            source_timeline="source",
            source_end_mode=source_end_mode,
            fps=30,
            base_track_count=1,
            probe=self.probe,
        )
        return result, pool

    def test_overlap_coloring_and_inclusive_source_end(self):
        plan = self.plan()
        self.assertEqual([p["track"] for p in plan], [2, 3, 2])
        receipt, pool = self.apply()
        self.assertEqual(pool.calls[0]["endFrame"], 9)
        self.assertEqual(receipt["placements"][0]["actual"]["end"], 10)
        self.assertTrue(receipt["preservation"]["base_tracks_match"])
        self.assertNotIn("track", self.events[0])

    def test_readback_failure_never_returns_receipt(self):
        for fault in (
            "null",
            "shift",
            "trim",
            "later",
            "base",
            "disabled",
            "property",
            "path",
            "track",
        ):
            with self.subTest(fault=fault), self.assertRaises(RuntimeError):
                self.apply(fault)

    def test_occupied_overlay_tracks_rejected_before_append(self):
        tl = Timeline()
        tl.tracks[2] = [object()]
        pool = Pool(tl)
        with self.assertRaises(ValueError):
            apply_placements(
                tl,
                pool,
                self.events,
                source_timeline="source",
                source_end_mode="inclusive",
                fps=30,
                base_track_count=1,
                probe=self.probe,
            )
        self.assertEqual(pool.calls, [])

    def test_invalid_contract(self):
        for key, value in [
            ("frames", 1.5),
            ("frames", True),
            ("frames", 0),
            ("record_frame", -1),
            ("opacity", float("nan")),
            ("opacity", 101),
            ("composite", None),
            ("asset", self.tmp.name),
        ]:
            with self.subTest(key=key, value=value), self.assertRaises(ValueError):
                self.plan([{**self.events[0], key: value}])
        with self.assertRaises(ValueError):
            self.plan([self.events[0], self.events[0]])

    def test_metadata_gates(self):
        for metadata in [
            dict(fps=24, frames=20, has_alpha=True),
            dict(fps=30, frames=2, has_alpha=True),
            dict(fps=30, frames=20, has_alpha=False),
        ]:
            with self.subTest(metadata=metadata), self.assertRaises(ValueError):
                allocate_placements(
                    [{**self.events[0], "requires_alpha": True}],
                    fps=30,
                    base_track_count=1,
                    probe=lambda p: metadata,
                )

    def test_timeline_fps_mismatch_before_mutation(self):
        tl = Timeline()
        tl.GetSetting = lambda key: "24"
        pool = Pool(tl)
        with self.assertRaises(ValueError):
            apply_placements(
                tl,
                pool,
                self.events,
                source_timeline="source",
                source_end_mode="inclusive",
                fps=30,
                base_track_count=1,
                probe=self.probe,
            )
        self.assertEqual(pool.calls, [])

    def test_exclusive_host_and_receipt(self):
        receipt, pool = self.apply(source_end_mode="exclusive", host_mode="exclusive")
        self.assertEqual(pool.calls[0]["endFrame"], 10)
        self.assertEqual(receipt["source_end_mode"], "exclusive")
        self.assertEqual(receipt["placements"][0]["actual"]["duration"], 10)

    def test_mode_mismatch_fails_without_retry(self):
        for mode, host in [("inclusive", "exclusive"), ("exclusive", "inclusive")]:
            tl = Timeline()
            pool = Pool(tl, host_mode=host)
            with self.assertRaises(RuntimeError):
                apply_placements(
                    tl,
                    pool,
                    self.events,
                    source_timeline="source",
                    source_end_mode=mode,
                    fps=30,
                    base_track_count=1,
                    probe=self.probe,
                )
            self.assertEqual(len(pool.calls), 1)

    def test_mode_must_be_explicit_and_valid(self):
        with self.assertRaises(ValueError):
            self.apply(source_end_mode="auto")
        with self.assertRaises(TypeError):
            apply_placements(
                Timeline(),
                None,
                self.events,
                source_timeline="source",
                fps=30,
                base_track_count=1,
                probe=self.probe,
            )


class ProbeTests(unittest.TestCase):
    def test_ffprobe_alpha_and_frame_count(self):
        stream = dict(
            avg_frame_rate="30000/1001",
            r_frame_rate="30000/1001",
            nb_read_frames="42",
            pix_fmt="yuva444p10le",
        )
        with patch(
            "tasteforge.resolve.subprocess.run",
            return_value=SimpleNamespace(stdout=json.dumps(dict(streams=[stream]))),
        ) as run:
            result = probe_asset(Path("/asset.mov"))
        self.assertEqual(result, dict(fps="30000/1001", frames=42, has_alpha=True))
        self.assertIn("-count_frames", run.call_args.args[0])

    def test_probe_rejects_no_video_and_ambiguous_rate(self):
        for streams in [[], [dict(avg_frame_rate="24", r_frame_rate="30")]]:
            with (
                patch(
                    "tasteforge.resolve.subprocess.run",
                    return_value=SimpleNamespace(
                        stdout=json.dumps(dict(streams=streams))
                    ),
                ),
                self.assertRaises(ValueError),
            ):
                probe_asset(Path("/asset.mov"))
