from __future__ import annotations

import math
import subprocess
import tempfile
from collections.abc import Callable
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

from cartoon_pipeline.generators.storyboard import Storyboard
from cartoon_pipeline.utils.files import (
    UnsafeOutputPathError,
    prepare_output_directory,
    safe_output_file,
)


class RenderError(RuntimeError):
    """Raised when a local video asset cannot be rendered safely."""


class FFmpegProcessor:
    def __init__(
        self,
        ffmpeg_path: str = "ffmpeg",
        frames_per_second: int = 12,
        seconds_per_scene: int = 4,
        runner: Callable[..., subprocess.CompletedProcess] = subprocess.run,
    ) -> None:
        if frames_per_second < 1 or seconds_per_scene < 1:
            raise ValueError("Video frame rate and scene duration must be positive")
        self.ffmpeg_path = ffmpeg_path
        self.frames_per_second = frames_per_second
        self.seconds_per_scene = seconds_per_scene
        self.runner = runner

    def process(self, storyboard: Storyboard, output_directory: Path) -> tuple[Path, Path]:
        try:
            output_directory = prepare_output_directory(output_directory)
            landscape = safe_output_file(output_directory, "landscape.mp4")
            vertical = safe_output_file(output_directory, "vertical.mp4")
        except UnsafeOutputPathError as exc:
            raise RenderError("Unsafe cartoon output path") from exc
        self._render_variant(storyboard, landscape, (1280, 720), "landscape")
        self._render_variant(storyboard, vertical, (720, 1280), "vertical")
        return landscape, vertical

    def _render_variant(
        self,
        storyboard: Storyboard,
        target: Path,
        dimensions: tuple[int, int],
        label: str,
    ) -> None:
        try:
            safe_output_file(target.parent, target.name)
            with tempfile.TemporaryDirectory(
                prefix="cartoon-frames-", dir=target.parent
            ) as frame_directory:
                frame_path = Path(frame_directory)
                temporary_video = frame_path / "render.mp4"
                self._create_frames(storyboard, frame_path, dimensions)
                self.runner(
                    [
                        self.ffmpeg_path,
                        "-hide_banner",
                        "-loglevel",
                        "error",
                        "-y",
                        "-framerate",
                        str(self.frames_per_second),
                        "-i",
                        str(frame_path / "frame-%04d.png"),
                        "-c:v",
                        "libx264",
                        "-preset",
                        "veryfast",
                        "-pix_fmt",
                        "yuv420p",
                        "-movflags",
                        "+faststart",
                        "-an",
                        str(temporary_video),
                    ],
                    check=True,
                    capture_output=True,
                    timeout=180,
                )
                if not temporary_video.is_file() or temporary_video.stat().st_size == 0:
                    raise RenderError(f"The {label} video encoder produced no output")
                safe_output_file(target.parent, target.name)
                temporary_video.replace(target)
        except UnsafeOutputPathError as exc:
            raise RenderError(f"Unsafe output path for the {label} video") from exc
        except (OSError, subprocess.SubprocessError) as exc:
            raise RenderError(f"Unable to render the {label} cartoon video") from exc

    def _create_frames(
        self, storyboard: Storyboard, directory: Path, dimensions: tuple[int, int]
    ) -> None:
        frame_count = self.frames_per_second * self.seconds_per_scene * len(storyboard.beats)
        for frame_number in range(frame_count):
            scene_index = min(
                frame_number // (self.frames_per_second * self.seconds_per_scene),
                len(storyboard.beats) - 1,
            )
            frame_in_scene = frame_number % (
                self.frames_per_second * self.seconds_per_scene
            )
            progress = frame_in_scene / max(
                1, self.frames_per_second * self.seconds_per_scene - 1
            )
            image = _draw_frame(
                storyboard.title, storyboard.beats[scene_index], progress, dimensions
            )
            image.save(directory / f"frame-{frame_number:04d}.png", format="PNG")


def _draw_frame(
    title: str,
    caption: str,
    progress: float,
    dimensions: tuple[int, int],
) -> Image.Image:
    width, height = dimensions
    image = Image.new("RGB", dimensions, (185, 225, 250))
    draw = ImageDraw.Draw(image)
    font = ImageFont.load_default()
    _draw_sky(draw, width, height)
    _draw_character(draw, width, height, progress)
    _draw_text_panel(draw, title, caption, font, width, height)
    return image


def _draw_sky(draw: ImageDraw.ImageDraw, width: int, height: int) -> None:
    draw.ellipse((width * 0.78, height * 0.07, width * 0.93, height * 0.21), fill="#FFD66B")
    draw.rectangle((0, height * 0.69, width, height), fill="#91CE8A")
    draw.ellipse((width * 0.1, height * 0.67, width * 0.45, height * 1.05), fill="#91CE8A")


def _draw_character(
    draw: ImageDraw.ImageDraw, width: int, height: int, progress: float
) -> None:
    center_x = width * (0.32 + progress * 0.32)
    center_y = height * 0.56
    size = min(width, height) * 0.18
    body = (center_x - size, center_y - size, center_x + size, center_y + size)
    draw.ellipse(body, fill="#F39B58", outline="#8F512F", width=max(2, int(size * 0.04)))
    eye_size = max(3, int(size * 0.08))
    for offset in (-0.3, 0.3):
        x = center_x + size * offset
        draw.ellipse(
            (x - eye_size, center_y - size * 0.18, x + eye_size, center_y + size * 0.02),
            fill="#24324A",
        )
    draw.arc(
        (center_x - size * 0.28, center_y - size * 0.05, center_x + size * 0.28, center_y + size * 0.38),
        start=10,
        end=170,
        fill="#8F512F",
        width=max(2, int(size * 0.04)),
    )
    _draw_star(draw, center_x + size * 1.35, center_y - size * 1.15, size * 0.28)


def _draw_star(
    draw: ImageDraw.ImageDraw, center_x: float, center_y: float, radius: float
) -> None:
    points = []
    for index in range(10):
        angle = -1.5708 + index * 0.6283
        distance = radius if index % 2 == 0 else radius * 0.45
        points.append(
            (center_x + distance * math.cos(angle), center_y + distance * math.sin(angle))
        )
    draw.polygon(points, fill="#FFF2A8", outline="#C79A38")


def _draw_text_panel(
    draw: ImageDraw.ImageDraw,
    title: str,
    caption: str,
    font: ImageFont.ImageFont,
    width: int,
    height: int,
) -> None:
    panel_top = int(height * 0.78)
    draw.rounded_rectangle(
        (width * 0.06, panel_top, width * 0.94, height * 0.96),
        radius=max(8, int(height * 0.025)),
        fill="#FFFFFF",
        outline="#4A7C59",
        width=max(2, int(height * 0.004)),
    )
    draw.text((width * 0.09, panel_top + height * 0.025), title[:70], fill="#24324A", font=font)
    _draw_wrapped_caption(
        draw, caption, font, width * 0.09, panel_top + height * 0.075, width * 0.82
    )


def _draw_wrapped_caption(
    draw: ImageDraw.ImageDraw,
    caption: str,
    font: ImageFont.ImageFont,
    x: float,
    y: float,
    max_width: float,
) -> None:
    lines: list[str] = []
    current = ""
    for word in caption.split():
        candidate = f"{current} {word}".strip()
        if current and draw.textlength(candidate, font=font) > max_width:
            lines.append(current)
            current = word
        else:
            current = candidate
    if current:
        lines.append(current)
    for index, line in enumerate(lines[:3]):
        draw.text((x, y + index * 22), line, fill="#24324A", font=font)
