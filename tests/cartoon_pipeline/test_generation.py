import json
import os
import subprocess
from dataclasses import replace
from datetime import date
from pathlib import Path

import pytest

import cartoon_pipeline.generate as generate_module
import cartoon_pipeline.processors.video as video_module
from cartoon_pipeline.episode_io import load_episode, save_episode
from cartoon_pipeline.generate import generate_daily_episode
from cartoon_pipeline.generators.storyboard import generate_storyboard
from cartoon_pipeline.models import Episode
from cartoon_pipeline.processors.video import FFmpegProcessor, RenderError, _draw_frame
from cartoon_pipeline.utils.files import (
    UnsafeOutputPathError,
    prepare_output_directory,
)


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


def test_empty_episode_description_survives_manifest_round_trip(tmp_path: Path) -> None:
    manifest_path = generate_daily_episode(
        tmp_path,
        Path("config/content_policy.yaml"),
        date(2026, 11, 23),
        processor=FakeProcessor(),
    )
    episode = load_episode(manifest_path)

    saved_path = save_episode(replace(episode, description=""), tmp_path)

    assert load_episode(saved_path).description == ""


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
    runner_options: list[dict] = []

    def fake_runner(command: list[str], **kwargs) -> subprocess.CompletedProcess:
        commands.append(command)
        runner_options.append(kwargs)
        Path(command[-1]).write_bytes(b"fake-video")
        return subprocess.CompletedProcess(command, 0)

    output = tmp_path / "out"
    paths = FFmpegProcessor(
        frames_per_second=1,
        seconds_per_scene=1,
        runner=fake_runner,
    ).process(generate_storyboard(date(2026, 11, 23)), output)

    assert all(path.read_bytes() == b"fake-video" for path in paths)
    assert all(options.get("shell", False) is False for options in runner_options)
    assert len(commands) == 2


def test_vertical_caption_is_scaled_to_video_dimensions() -> None:
    image = _draw_frame(
        "The Patient Little Seed",
        "Friends take turns watering it and waiting.",
        0.5,
        (720, 1280),
    )
    pixels = image.load()
    text_rows = [
        y
        for y in range(int(image.height * 0.78), int(image.height * 0.96))
        for x in range(int(image.width * 0.06), int(image.width * 0.94))
        if pixels[x, y] == (36, 50, 74)
    ]

    assert text_rows
    assert max(text_rows) - min(text_rows) >= 20
    assert max(text_rows) < int(image.height * 0.95)


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


def test_processor_rejects_symlinked_ancestor_before_creating_output(
    tmp_path: Path,
) -> None:
    outside = tmp_path / "outside"
    outside.mkdir()
    linked_parent = tmp_path / "linked-parent"
    linked_parent.symlink_to(outside, target_is_directory=True)

    with pytest.raises(RenderError, match="Unsafe"):
        FFmpegProcessor(
            frames_per_second=1,
            seconds_per_scene=1,
            runner=lambda *args, **kwargs: subprocess.CompletedProcess(args, 0),
        ).process(
            generate_storyboard(date(2026, 11, 23)),
            linked_parent / "nested" / "output",
        )

    assert list(outside.iterdir()) == []


def test_output_directory_rejects_parent_traversal_through_symlink(
    tmp_path: Path,
) -> None:
    outside_child = tmp_path / "outside" / "child"
    outside_child.mkdir(parents=True)
    linked_parent = tmp_path / "linked-parent"
    linked_parent.symlink_to(outside_child, target_is_directory=True)

    with pytest.raises(UnsafeOutputPathError, match="parent traversal"):
        prepare_output_directory(linked_parent / ".." / "episode")

    assert not (tmp_path / "outside" / "episode").exists()
    assert not (tmp_path / "episode").exists()


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


def test_second_asset_replacement_failure_restores_previous_episode(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    output = tmp_path / "out"
    output.mkdir()
    landscape = output / "landscape.mp4"
    vertical = output / "vertical.mp4"
    manifest = output / "episode.json"
    landscape.write_bytes(b"old-landscape")
    vertical.write_bytes(b"old-vertical")
    manifest.write_text("old-manifest", encoding="utf-8")
    original_replace = os.replace
    failed = False

    def fail_vertical_once(source, destination) -> None:
        nonlocal failed
        if Path(destination) == vertical and not failed:
            failed = True
            raise OSError("injected replacement failure")
        original_replace(source, destination)

    monkeypatch.setattr("cartoon_pipeline.processors.video.os.replace", fail_vertical_once)

    def fake_runner(command: list[str], **kwargs) -> subprocess.CompletedProcess:
        Path(command[-1]).write_bytes(b"new-video")
        return subprocess.CompletedProcess(command, 0)

    with pytest.raises(RenderError):
        FFmpegProcessor(
            frames_per_second=1, seconds_per_scene=1, runner=fake_runner
        ).process(generate_storyboard(date(2026, 11, 23)), output)

    assert failed is True
    assert landscape.read_bytes() == b"old-landscape"
    assert vertical.read_bytes() == b"old-vertical"
    assert manifest.read_text(encoding="utf-8") == "old-manifest"


def test_processor_retains_recovery_backup_if_restore_fails(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    output = tmp_path / "out"
    output.mkdir()
    landscape = output / "landscape.mp4"
    vertical = output / "vertical.mp4"
    landscape.write_bytes(b"old-landscape")
    vertical.write_bytes(b"old-vertical")
    original_replace = os.replace
    restoration_started = False

    def fail_replacement_and_restore(source, destination) -> None:
        nonlocal restoration_started
        source_path = Path(source)
        if Path(destination) == vertical and source_path.parent.name.startswith(
            "cartoon-output-"
        ):
            raise OSError("injected replacement failure")
        if Path(destination) == landscape and source_path.name == "landscape.mp4":
            if restoration_started:
                raise OSError("injected restoration failure")
            restoration_started = True
        original_replace(source, destination)

    monkeypatch.setattr(video_module.os, "replace", fail_replacement_and_restore)

    def fake_runner(command: list[str], **kwargs) -> subprocess.CompletedProcess:
        Path(command[-1]).write_bytes(b"new-video")
        return subprocess.CompletedProcess(command, 0)

    with pytest.raises(RenderError, match="recovery copies retained") as error:
        FFmpegProcessor(
            frames_per_second=1, seconds_per_scene=1, runner=fake_runner
        ).process(generate_storyboard(date(2026, 11, 23)), output)

    recovery_directories = list(output.glob("cartoon-previous-*"))
    assert len(recovery_directories) == 1
    assert (recovery_directories[0] / "landscape.mp4").read_bytes() == b"old-landscape"
    assert str(recovery_directories[0]) in str(error.value)


def test_generation_restores_previous_episode_if_manifest_save_fails(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    output = tmp_path / "out"
    output.mkdir()
    expected = {
        "landscape.mp4": b"old-landscape",
        "vertical.mp4": b"old-vertical",
        "episode.json": b"old-manifest",
    }
    for name, contents in expected.items():
        (output / name).write_bytes(contents)

    def fail_save(*args, **kwargs):
        raise OSError("injected manifest failure")

    monkeypatch.setattr(generate_module, "save_episode", fail_save)

    with pytest.raises(OSError, match="manifest failure"):
        generate_daily_episode(
            output,
            Path("config/content_policy.yaml"),
            date(2026, 11, 23),
            processor=FakeProcessor(),
        )

    assert {name: (output / name).read_bytes() for name in expected} == expected


def test_generation_retains_recovery_backup_if_restore_fails(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    output = tmp_path / "out"
    output.mkdir()
    expected = {
        "landscape.mp4": b"old-landscape",
        "vertical.mp4": b"old-vertical",
        "episode.json": b"old-manifest",
    }
    for name, contents in expected.items():
        (output / name).write_bytes(contents)

    def fail_save(*args, **kwargs):
        raise OSError("injected manifest failure")

    original_replace = os.replace

    def fail_restore(source, destination) -> None:
        if Path(source).parent.name.startswith("cartoon-backup-"):
            raise OSError("injected restoration failure")
        original_replace(source, destination)

    monkeypatch.setattr(generate_module, "save_episode", fail_save)
    monkeypatch.setattr(generate_module.os, "replace", fail_restore)

    with pytest.raises(RuntimeError, match="recovery copies retained") as error:
        generate_daily_episode(
            output,
            Path("config/content_policy.yaml"),
            date(2026, 11, 23),
            processor=FakeProcessor(),
        )

    recovery_directories = list(output.glob("cartoon-backup-*"))
    assert len(recovery_directories) == 1
    assert (recovery_directories[0] / "landscape.mp4").read_bytes() == b"old-landscape"
    assert str(recovery_directories[0]) in str(error.value)
