import json
import subprocess
from datetime import date
from pathlib import Path

import pytest

from cartoon_pipeline.episode_io import load_episode, save_episode
from cartoon_pipeline.generate import generate_daily_episode
from cartoon_pipeline.generators.storyboard import generate_storyboard
from cartoon_pipeline.models import Episode
from cartoon_pipeline.processors.video import FFmpegProcessor, RenderError


class FakeProcessor:
    def process(self, storyboard, output_directory: Path) -> tuple[Path, Path]:
        output_directory.mkdir(parents=True, exist_ok=True)
        landscape = output_directory / "landscape.mp4"
        vertical = output_directory / "vertical.mp4"
        landscape.write_bytes(b"fake-video")
        vertical.write_bytes(b"fake-video")
        return landscape, vertical


def test_storyboard_generation_is_deterministic_for_a_date() -> None:
    day = date(2026, 11, 23)

    assert generate_storyboard(day) == generate_storyboard(day)


def test_daily_generation_writes_reviewable_manifest_and_assets(tmp_path: Path) -> None:
    manifest_path = generate_daily_episode(
        tmp_path,
        Path("config/content_policy.yaml"),
        date(2026, 11, 23),
        processor=FakeProcessor(),
    )
    episode = load_episode(manifest_path)

    assert episode.episode_id == "2026-11-23"
    assert episode.made_for_kids is True
    assert episode.landscape_path.read_bytes() == b"fake-video"
    assert episode.vertical_path.read_bytes() == b"fake-video"


def test_episode_loader_rejects_asset_paths_outside_manifest_directory(
    tmp_path: Path,
) -> None:
    outside = tmp_path / "outside.mp4"
    outside.write_bytes(b"fake-video")
    episode_dir = tmp_path / "episode"
    episode_dir.mkdir()
    landscape = episode_dir / "landscape.mp4"
    vertical = episode_dir / "vertical.mp4"
    landscape.write_bytes(b"fake-video")
    vertical.write_bytes(b"fake-video")
    episode = Episode(
        episode_id="2026-11-23",
        title="The Patient Little Seed",
        description="A gentle story about teamwork and growing a garden.",
        story=("A seed needs help.", "Friends work together.", "A garden grows."),
        episode_date=date(2026, 11, 23),
        landscape_path=landscape,
        vertical_path=vertical,
        audience_min_age=8,
        audience_max_age=15,
        made_for_kids=True,
        original=True,
        rights_cleared=True,
        safety_reviewed=True,
        contains_personal_data=False,
    )
    manifest = save_episode(episode, episode_dir)
    content = json.loads(manifest.read_text(encoding="utf-8"))
    content["landscape_path"] = "../../outside.mp4"
    manifest.write_text(json.dumps(content), encoding="utf-8")

    try:
        load_episode(manifest)
    except ValueError as exc:
        assert "escapes" in str(exc)
    else:
        raise AssertionError("path traversal manifest should be rejected")


def test_episode_save_rejects_symlink_manifest_destination(tmp_path: Path) -> None:
    episode_dir = tmp_path / "episode"
    episode_dir.mkdir()
    landscape = episode_dir / "landscape.mp4"
    vertical = episode_dir / "vertical.mp4"
    landscape.write_bytes(b"fake-video")
    vertical.write_bytes(b"fake-video")
    outside_manifest = tmp_path / "outside.json"
    outside_manifest.write_text("do not overwrite", encoding="utf-8")
    (episode_dir / "episode.json").symlink_to(outside_manifest)
    episode = Episode(
        episode_id="2026-11-23",
        title="The Patient Little Seed",
        description="A gentle story about teamwork and growing a garden.",
        story=("A seed needs help.", "Friends work together.", "A garden grows."),
        episode_date=date(2026, 11, 23),
        landscape_path=landscape,
        vertical_path=vertical,
        audience_min_age=8,
        audience_max_age=15,
        made_for_kids=True,
        original=True,
        rights_cleared=True,
        safety_reviewed=True,
        contains_personal_data=False,
    )

    with pytest.raises(ValueError, match="symlink"):
        save_episode(episode, episode_dir)

    assert outside_manifest.read_text(encoding="utf-8") == "do not overwrite"


def test_processor_passes_arguments_without_shell_interpretation(tmp_path: Path) -> None:
    commands: list[list[str]] = []

    def fake_runner(command: list[str], **kwargs) -> subprocess.CompletedProcess:
        commands.append(command)
        Path(command[-1]).write_bytes(b"fake-video")
        return subprocess.CompletedProcess(command, 0)

    output = tmp_path / "out"
    paths = FFmpegProcessor(
        frames_per_second=1,
        seconds_per_scene=1,
        runner=fake_runner,
    ).process(generate_storyboard(date(2026, 11, 23)), output)

    assert all(path.read_bytes() == b"fake-video" for path in paths)
    assert all("shell" not in command for command in commands)
    assert len(commands) == 2


def test_processor_rejects_symlink_output_without_overwriting_target(
    tmp_path: Path,
) -> None:
    output = tmp_path / "out"
    output.mkdir()
    outside = tmp_path / "outside.mp4"
    outside.write_bytes(b"preserve")
    (output / "landscape.mp4").symlink_to(outside)

    with pytest.raises(RenderError, match="Unsafe"):
        FFmpegProcessor(
            frames_per_second=1,
            seconds_per_scene=1,
            runner=lambda *args, **kwargs: subprocess.CompletedProcess(args, 0),
        ).process(generate_storyboard(date(2026, 11, 23)), output)

    assert outside.read_bytes() == b"preserve"


def test_processor_rejects_symlink_output_directory(tmp_path: Path) -> None:
    outside = tmp_path / "outside"
    outside.mkdir()
    output = tmp_path / "out"
    output.symlink_to(outside, target_is_directory=True)

    with pytest.raises(RenderError, match="Unsafe"):
        FFmpegProcessor(
            frames_per_second=1,
            seconds_per_scene=1,
            runner=lambda *args, **kwargs: subprocess.CompletedProcess(args, 0),
        ).process(generate_storyboard(date(2026, 11, 23)), output)

    assert list(outside.iterdir()) == []


def test_processor_preserves_previous_output_if_encoding_fails(
    tmp_path: Path,
) -> None:
    output = tmp_path / "out"
    output.mkdir()
    previous = output / "landscape.mp4"
    previous.write_bytes(b"previous")

    def failing_runner(command: list[str], **kwargs) -> subprocess.CompletedProcess:
        raise subprocess.CalledProcessError(1, command)

    with pytest.raises(RenderError):
        FFmpegProcessor(
            frames_per_second=1,
            seconds_per_scene=1,
            runner=failing_runner,
        ).process(generate_storyboard(date(2026, 11, 23)), output)

    assert previous.read_bytes() == b"previous"


def test_failed_vertical_render_preserves_previous_complete_episode(
    tmp_path: Path,
) -> None:
    output = tmp_path / "out"
    output.mkdir()
    landscape = output / "landscape.mp4"
    vertical = output / "vertical.mp4"
    manifest = output / "episode.json"
    landscape.write_bytes(b"old-landscape")
    vertical.write_bytes(b"old-vertical")
    manifest.write_text("old-manifest", encoding="utf-8")
    calls = 0

    def fail_vertical(command: list[str], **kwargs) -> subprocess.CompletedProcess:
        nonlocal calls
        calls += 1
        if calls == 1:
            Path(command[-1]).write_bytes(b"new-landscape")
            return subprocess.CompletedProcess(command, 0)
        raise subprocess.CalledProcessError(1, command)

    with pytest.raises(RenderError):
        FFmpegProcessor(
            frames_per_second=1,
            seconds_per_scene=1,
            runner=fail_vertical,
        ).process(generate_storyboard(date(2026, 11, 23)), output)

    assert landscape.read_bytes() == b"old-landscape"
    assert vertical.read_bytes() == b"old-vertical"
    assert manifest.read_text(encoding="utf-8") == "old-manifest"
