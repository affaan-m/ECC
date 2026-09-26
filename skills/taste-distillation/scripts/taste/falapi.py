"""Thin, auditable wrapper over ``fal_client``.

Everything in taste-forge that touches the network goes through here, for
three reasons:

* **Swappability.** Hosted model IDs churn. Every endpoint lives in one
  ``ENDPOINTS`` dict at the top of this module, so re-pointing the pipeline at
  a newer model is a one-line edit rather than a grep across the codebase.
* **Dry runs.** Setting ``TASTE_FORGE_DRY_RUN=1`` makes every call return a
  plausible, deterministic stub instead of hitting the network. The whole
  pipeline can then be exercised end-to-end with no API key and no spend,
  which is what makes the CLIs testable.
* **Auditability.** Uploads are cached; submissions are attempted once.
  Live transport requires ``TASTE_FORGE_ALLOW_LIVE=1``. Logs omit provider
  payloads, signed URL details and raw transport exceptions.

Credentials are read from the ``FAL_KEY`` environment variable and are never
written to disk, logged, or embedded in a payload.
"""

from __future__ import annotations

import hashlib
import json
import logging
import os
import random
import shutil
import threading
import time
import urllib.request
import urllib.parse
import tempfile
from pathlib import Path
from typing import Any, Iterable

log = logging.getLogger("taste.falapi")

# ---------------------------------------------------------------------------
# endpoints
# ---------------------------------------------------------------------------
#
# These are DEFAULTS, not guarantees. fal.ai model ids, their payload keys and
# their response shapes drift faster than this repo will; treat any entry here
# as something to verify against https://fal.ai/models before a production run
# and update in place. Nothing else in the codebase hardcodes an endpoint id,
# so a swap here propagates everywhere.
ENDPOINTS: dict[str, str] = {
    # Vision-language description of reference stills -> style spec JSON.
    "vlm": "fal-ai/any-llm/vision",
    # Style/character reference image + prompt -> short video shot.
    "reference_to_video": "bytedance/seedance-2.5/reference-to-video",
    # Still -> textured GLB, used to mint reusable props.
    "image_to_3d": "fal-ai/hunyuan-3d/v3.1/pro/image-to-3d",
    # Prompt -> textured GLB, for props the reference implies but never shows.
    "text_to_3d": "fal-ai/hunyuan-3d/v3.1/pro/text-to-3d",
    # Mesh post-processing.
    "retopology": "fal-ai/hunyuan-3d/v3.1/smart-topology",
    "part_split": "tripo3d/tripo/segment",
    "retexture": "fal-ai/meshy/v5/retexture",
    # Prompt (+ optional reference images) -> still image.
    "text_to_image": "fal-ai/nano-banana-pro",
    "image_edit": "fal-ai/nano-banana-pro/edit",
    # ffmpeg utility endpoints.
    "extract_frame": "fal-ai/ffmpeg-api/extract-frame",
    "compose": "fal-ai/ffmpeg-api/compose",
    "merge_videos": "fal-ai/ffmpeg-api/merge-videos",
    # Locally rendered turntable frames -> video. This is the only way a 3D
    # asset gets back into the video pipeline (see TIERS notes below).
    "images_to_video": "fal-ai/ffmpeg-api/images-to-video",
}

# Alternates, verified live, kept as a table rather than as prose because the
# right choice is a budget decision the caller should be able to make per run.
#
# The reference-to-video line is where the money goes and where the naming is
# most treacherous. Two specific traps, both confirmed against fal's catalogue:
#
#  * There is no Kling 3.0 reference-to-video. The v3 line is text-to-video,
#    image-to-video and motion-control only; reference-to-video exists solely
#    on the o3 line.
#  * Seedance 2.5 is roughly 4x the price of Kling o3 pro for the same 5
#    seconds ($2.37 vs $0.56 at 720p), which it earns on multi-reference
#    fidelity - it takes up to 50 mixed image/video/audio references - and
#    does not earn if you are conditioning on a single still, which is what
#    this pipeline does by default.
TIERS: dict[str, dict[str, str]] = {
    "reference_to_video": {
        "best": "bytedance/seedance-2.5/reference-to-video",     # ~$0.473/s @720p
        "value": "fal-ai/kling-video/o3/pro/reference-to-video",  # ~$0.112/s
        "audio": "fal-ai/veo3.1/reference-to-video",              # native dialogue
        "cheap": "minimax/h3/reference-to-video",                 # ~$0.05/s @480p
    },
    "image_to_3d": {
        "best": "fal-ai/hunyuan-3d/v3.1/pro/image-to-3d",  # $0.375, up to 8 views
        "fast": "fal-ai/hunyuan-3d/v3.1/rapid/image-to-3d",  # $0.225, single view
        "value": "tripo3d/h3.1/image-to-3d",                 # $0.20, quad option
        "game": "meshy/v7/image-to-3d",                      # $1.20, rig + anim
    },
    "text_to_3d": {
        "best": "fal-ai/hunyuan-3d/v3.1/pro/text-to-3d",
        "fast": "fal-ai/hunyuan-3d/v3.1/rapid/text-to-3d",
        "value": "tripo3d/h3.1/text-to-3d",
    },
    "text_to_image": {
        "best": "fal-ai/nano-banana-pro",       # $0.15 flat, strongest identity
        "value": "fal-ai/flux-2-pro",           # $0.03 first MP
        "instruct": "openai/gpt-image-2",       # best typography / instructions
    },
}


def use_tier(slot: str, tier: str) -> str:
    """Repoint one slot at a named tier. Returns the endpoint now in use."""
    table = TIERS.get(slot)
    if not table or tier not in table:
        raise FalError(
            f"no tier '{tier}' for slot '{slot}'; "
            f"have {sorted(table) if table else 'no tiers'}"
        )
    ENDPOINTS[slot] = table[tier]
    return ENDPOINTS[slot]


# fal has NO endpoint that renders a mesh to images or video. The catalogue
# splits 3D into image-to-3d, text-to-3d and 3d-to-3d, and every member of
# 3d-to-3d emits another mesh - there is no 3d-to-image or 3d-to-video
# category at all. So a minted GLB cannot re-enter the video graph on fal.
#
# It can re-enter locally: render a turntable here (taste/render3d.py), then
# either assemble the frames with local ffmpeg or push them through
# ``images_to_video`` above. That is why the 3D branch is not a dead end even
# though the platform has no renderer.
NO_RENDER_ENDPOINT = True

# Model id used with the multi-provider VLM endpoint above. Also a default.
VLM_MODEL = "google/gemini-flash-2.5"

DRY_RUN_ENV = "TASTE_FORGE_DRY_RUN"
DRY_RUN_HOST = "https://dry-run.taste-forge.local"

DEFAULT_TIMEOUT = 600
MAX_ATTEMPTS = 1
BACKOFF_BASE = 2.0

# Statuses worth retrying: rate limits, queue hiccups, upstream 5xx. Anything
# else (401/403 bad key, 404 dead endpoint, 422 bad payload) is a permanent
# failure and retrying it just burns wall-clock time.
_TRANSIENT_STATUS = {408, 409, 425, 429, 500, 502, 503, 504}


class FalError(RuntimeError):
    """Any failure originating from the fal layer."""


class MissingKeyError(FalError):
    """``FAL_KEY`` is not set and this is not a dry run."""


# ---------------------------------------------------------------------------
# mode + credentials
# ---------------------------------------------------------------------------


def is_dry_run() -> bool:
    """True when ``TASTE_FORGE_DRY_RUN`` is set to a truthy value.

    Read live rather than snapshotted at import so a CLI's ``--dry-run`` flag
    can enable it after this module is already imported.
    """
    return os.environ.get(DRY_RUN_ENV, "").strip().lower() in {"1", "true", "yes", "on"}


def enable_dry_run() -> None:
    """Turn on dry-run mode for this process (what ``--dry-run`` calls)."""
    os.environ[DRY_RUN_ENV] = "1"


def require_live() -> None:
    """Require explicit process-level authorization before any live transport."""
    if os.environ.get("TASTE_FORGE_ALLOW_LIVE") != "1":
        raise FalError("live transport requires TASTE_FORGE_ALLOW_LIVE=1")


def safe_url(url: str) -> str:
    """Log only origin: paths, queries and userinfo can carry signed secrets."""
    try:
        parsed = urllib.parse.urlsplit(url)
        return f"{parsed.scheme}://{parsed.hostname or '[invalid-host]'}"
    except ValueError:
        return "[invalid-url]"


def api_key() -> str:
    """Return ``FAL_KEY`` after live opt-in. Never logs the value."""
    require_live()
    key = os.environ.get("FAL_KEY", "").strip()
    if not key:
        raise MissingKeyError(
            "FAL_KEY is not set.\n"
            "  Get a key at https://fal.ai/dashboard/keys, then either:\n"
            "    export FAL_KEY='...'\n"
            "  or run the pipeline offline with no key and no spend:\n"
            f"    export {DRY_RUN_ENV}=1      (or pass --dry-run)"
        )
    return key


def _fal():
    """Import ``fal_client`` lazily so dry runs work even if it is absent."""
    try:
        import fal_client  # noqa: PLC0415 - deliberate lazy import
    except ImportError as exc:  # pragma: no cover - environment dependent
        raise FalError(
            "the 'fal_client' package is required for live calls: pip install fal-client"
        ) from exc
    return fal_client


# ---------------------------------------------------------------------------
# core: submit
# ---------------------------------------------------------------------------


def _is_transient(exc: BaseException) -> bool:
    status = getattr(exc, "status_code", None)
    if status is None:
        status = getattr(getattr(exc, "response", None), "status_code", None)
    if isinstance(status, int):
        return status in _TRANSIENT_STATUS
    name = type(exc).__name__.lower()
    if "timeout" in name or "connection" in name:
        return True
    return isinstance(exc, (TimeoutError, ConnectionError))


def _preview(payload: dict, limit: int = 600) -> str:
    try:
        text = json.dumps(payload, default=str)
    except Exception:  # pragma: no cover - defensive
        text = repr(payload)
    return text if len(text) <= limit else text[:limit] + f"... (+{len(text) - limit} chars)"


def submit(
    endpoint: str,
    payload: dict,
    timeout: int = DEFAULT_TIMEOUT,
    *,
    max_attempts: int = MAX_ATTEMPTS,
) -> dict:
    """Submit once. Ambiguous failures must be reconciled before another job.

    ``max_attempts`` is retained for call compatibility but never resubmits.
    """
    if is_dry_run():
        log.info("[dry-run] model request (payload omitted)")
        return _stub(endpoint, payload)

    require_live()
    api_key()
    try:
        result = _fal().subscribe(
            endpoint, arguments=payload, with_logs=False, client_timeout=timeout,
        )
        return result if isinstance(result, dict) else {"output": result}
    except Exception:
        # Exception strings can include keys, signed URLs and provider payloads.
        # Do not print or chain them into caller tracebacks.
        raise FalError(
            "fal call failed after one attempt; job acceptance may be unknown. "
            "Reconcile provider job status before requesting another generation."
        ) from None


# ---------------------------------------------------------------------------
# uploads (cached)
# ---------------------------------------------------------------------------

_UPLOAD_CACHE: dict[tuple[str, int, int], str] = {}
_UPLOAD_LOCK = threading.Lock()


def _cache_key(path: Path) -> tuple[str, int, int]:
    st = path.stat()
    return (str(path.resolve()), st.st_mtime_ns, st.st_size)


def upload(path: str | Path) -> str:
    """Upload a local file and return its URL, memoized per (path, mtime, size).

    apply.py reuses the same handful of stills across every shot in a run and
    across concurrent workers; without this cache each of those becomes a
    redundant multi-megabyte POST.
    """
    if not is_dry_run():
        require_live()
    p = Path(path)
    if not p.exists():
        raise FalError(f"cannot upload, file does not exist: {p}")

    key = _cache_key(p)
    with _UPLOAD_LOCK:
        hit = _UPLOAD_CACHE.get(key)
    if hit and (is_dry_run() == hit.startswith(DRY_RUN_HOST + "/")):
        log.debug("upload cache hit: %s", p.name)
        return hit

    if is_dry_run():
        url = f"{DRY_RUN_HOST}/uploads/{_digest(str(key))}/{p.name}"
        log.info("[dry-run] would upload %s (%d bytes) -> %s", p, key[2], url)
    else:
        api_key()
        try:
            url = _fal().upload_file(str(p))
        except Exception:
            raise FalError("fal upload failed; provider details omitted") from None
        log.info("uploaded %s -> %s", p.name, safe_url(url))

    with _UPLOAD_LOCK:
        _UPLOAD_CACHE[key] = url
    return url


def upload_many(paths: Iterable[str | Path]) -> list[str]:
    return [upload(p) for p in paths]


def clear_upload_cache() -> None:
    with _UPLOAD_LOCK:
        _UPLOAD_CACHE.clear()


# ---------------------------------------------------------------------------
# response parsing
# ---------------------------------------------------------------------------


def parse_urls(result: Any) -> list[str]:
    """Collect every URL in a response, depth-first, in order.

    Response envelopes differ per endpoint (``video.url``, ``images[].url``,
    ``model_mesh.url``, bare strings). Walking for URLs rather than indexing a
    fixed path means an endpoint swap does not silently return ``None``.
    """
    found: list[str] = []

    def walk(node: Any) -> None:
        if isinstance(node, str):
            if node.startswith(("http://", "https://", "data:")):
                found.append(node)
        elif isinstance(node, dict):
            if isinstance(node.get("url"), str):
                found.append(node["url"])
            for k, v in node.items():
                if k != "url":
                    walk(v)
        elif isinstance(node, (list, tuple)):
            for v in node:
                walk(v)

    walk(result)
    seen: set[str] = set()
    return [u for u in found if not (u in seen or seen.add(u))]


def first_url(result: Any, endpoint: str) -> str:
    urls = parse_urls(result)
    if not urls:
        raise FalError(
            "no URL in provider response; response shape may have changed "
            "(provider payload omitted)"
        )
    return urls[0]


def _mesh_url(result: Any, endpoint: str) -> str:
    """The GLB out of a 3D response, addressed by key rather than by position.

    ``first_url`` would work only as long as ``model_glb`` happens to be the
    first URL-bearing key in the response. It is today; the response also
    carries a ``thumbnail`` PNG and a ``model_urls`` block with obj/fbx/mtl,
    so a key reordering upstream would quietly start returning a preview image
    where a mesh is expected - and a preview image downloads fine, so nothing
    would fail until Blender refused to open it.
    """
    if isinstance(result, dict):
        for path in (("model_glb", "url"), ("model_urls", "glb", "url"),
                     ("model_mesh", "url"), ("model", "url")):
            node: Any = result
            for key in path:
                node = node.get(key) if isinstance(node, dict) else None
                if node is None:
                    break
            if isinstance(node, str) and node:
                return node
    return first_url(result, endpoint)


def _text_of(result: dict) -> str:
    """Best-effort extraction of the text body from an LLM/VLM response."""
    for key in ("output", "text", "response", "content", "answer"):
        val = result.get(key)
        if isinstance(val, str) and val.strip():
            return val
    choices = result.get("choices")
    if isinstance(choices, list) and choices:
        msg = choices[0].get("message") if isinstance(choices[0], dict) else None
        if isinstance(msg, dict) and isinstance(msg.get("content"), str):
            return msg["content"]
    return json.dumps(result)


# ---------------------------------------------------------------------------
# named helpers
# ---------------------------------------------------------------------------


def vlm_describe(
    image_urls: list[str],
    prompt: str,
    schema_hint: dict | str | None = None,
    *,
    timeout: int = 240,
) -> str:
    """Describe reference stills. Returns the model's raw text output.

    ``schema_hint`` should be a dict of ``field -> example value``; it is
    rendered into the prompt as the required output shape and doubles as the
    template for the dry-run stub, so callers get back something that actually
    parses without a key.
    """
    full = prompt
    if schema_hint:
        shape = (
            json.dumps(schema_hint, indent=2)
            if isinstance(schema_hint, dict)
            else str(schema_hint)
        )
        full = f"{prompt}\n\nReturn ONLY JSON matching this shape:\n{shape}"

    payload = {
        "model": VLM_MODEL,
        "prompt": full,
        "image_urls": list(image_urls),
    }
    if image_urls:
        # Some VLM endpoints take a single image_url instead of a list; sending
        # both is harmless and makes the call survive that variation.
        payload["image_url"] = image_urls[0]

    result = submit(ENDPOINTS["vlm"], payload, timeout)
    if is_dry_run() and isinstance(schema_hint, dict):
        # Shape the stub to the caller's own schema so downstream JSON parsing
        # and validation are genuinely exercised offline.
        return json.dumps(_stub_from_schema(schema_hint), indent=2)
    return _text_of(result)


# Hunyuan v3.1 takes multi-view as NAMED PER-ANGLE FIELDS, not as a list.
# There is no `input_image_urls` and no `multi_view` flag - an earlier version
# of this module invented both, which would have silently degraded every
# multi-view mint to single-view (only `input_image_url` is read) while
# appearing to work. Order matters: this is the sequence the endpoint's own
# docs list, and it is roughly the order of usefulness.
VIEW_FIELDS = (
    "input_image_url",       # front - the only required one
    "back_image_url",
    "left_image_url",
    "right_image_url",
    "left_front_image_url",  # 45-degree, v3.1 exclusive
    "right_front_image_url",
    "top_image_url",
    "bottom_image_url",
)


def image_to_3d(
    image_url: str | list[str],
    *,
    pbr: bool = True,
    face_count: int | None = None,
    geometry_only: bool = False,
    views: dict[str, str] | None = None,
    timeout: int = 900,
) -> str:
    """Mint a textured GLB from one still, or from up to 8 named views.

    Multi-view is the biggest quality lever on this endpoint: given only a
    front view the model has to invent the back of the object, and it invents
    something plausible and wrong.

    Pass ``views`` when you know which angle each image is - e.g.
    ``{"input_image_url": front, "back_image_url": back}``. Passing a bare
    list assigns images to :data:`VIEW_FIELDS` in order, which is a guess and
    is only correct if the caller actually sorted them that way; a wrong angle
    label is worse than omitting the view entirely, because the model trusts
    it. When in doubt, send one image.

    ``pbr`` requests physically-based maps (metallic, roughness, normal). Without
    them the mesh lights like painted cardboard in Blender, which defeats the
    point of minting it. It is ignored when ``geometry_only`` is set.

    Note the endpoint's own input guidance: simple background, single object,
    object filling >50% of frame. Busy reference stills - collages, wide shots,
    anything with several subjects - produce garbage meshes. Generate a clean
    single-object plate first if the pack's stills are not that.
    """
    if views:
        payload: dict = {k: v for k, v in views.items() if k in VIEW_FIELDS and v}
        if "input_image_url" not in payload:
            raise FalError("views must include 'input_image_url' (the front view)")
    else:
        urls = [image_url] if isinstance(image_url, str) else list(image_url)
        if not urls:
            raise FalError("image_to_3d needs at least one image")
        payload = {f: u for f, u in zip(VIEW_FIELDS, urls[:len(VIEW_FIELDS)])}

    payload["generate_type"] = "Geometry" if geometry_only else "Normal"
    if not geometry_only:
        payload["enable_pbr"] = bool(pbr)
    if face_count:
        # Endpoint range is 40k-1.5M; clamp rather than let it 422.
        payload["face_count"] = int(max(40_000, min(1_500_000, face_count)))

    result = submit(ENDPOINTS["image_to_3d"], payload, timeout)
    return _mesh_url(result, ENDPOINTS["image_to_3d"])


def text_to_3d(prompt: str, *, pbr: bool = True, timeout: int = 900) -> str:
    """Mint a textured GLB from a description. Returns the mesh URL.

    The complement to image_to_3d: use it for props the reference *implies*
    but never shows cleanly enough to lift - the pack's spec describes the
    world, and this generates objects that belong in it.
    """
    payload = {"prompt": prompt, "text": prompt, "pbr": pbr}
    result = submit(ENDPOINTS["text_to_3d"], payload, timeout)
    return _mesh_url(result, ENDPOINTS["text_to_3d"])


def retopologize(mesh_url: str, *, quad: bool = True, timeout: int = 900) -> str:
    """Rebuild a generated mesh's topology as clean quads (or tris).

    Generated meshes are dense and chaotic - fine for a render, painful to
    edit or rig. This is what makes a minted prop actually usable in Blender.
    """
    payload = {"mesh_url": mesh_url, "input_mesh_url": mesh_url,
               "topology": "quad" if quad else "triangle"}
    result = submit(ENDPOINTS["retopology"], payload, timeout)
    return first_url(result, ENDPOINTS["retopology"])


def split_parts(mesh_url: str, *, timeout: int = 900) -> list[str]:
    """Segment a mesh into separately editable parts. Returns part URLs."""
    payload = {"mesh_url": mesh_url, "input_mesh_url": mesh_url}
    result = submit(ENDPOINTS["part_split"], payload, timeout)
    parts = result.get("parts") or result.get("meshes") or []
    urls = [p.get("url") for p in parts if isinstance(p, dict) and p.get("url")]
    return urls or [first_url(result, ENDPOINTS["part_split"])]


def images_to_video(
    image_urls: list[str], *, fps: float = 24.0, timeout: int = 900
) -> str:
    """Assemble ordered frames into a video.

    Exists here for one reason: fal cannot render a mesh, so a turntable has
    to be rendered locally and then re-enter the graph as frames.
    """
    payload = {"image_urls": image_urls, "fps": fps}
    result = submit(ENDPOINTS["images_to_video"], payload, timeout)
    return first_url(result, ENDPOINTS["images_to_video"])


def reference_to_video(
    image_url: str,
    prompt: str,
    duration: float,
    *,
    resolution: str = "1080p",
    timeout: int = 900,
) -> str:
    """Generate one shot from a style-reference image. Returns the video URL.

    ``duration`` arrives as a float from ``Cadence.plan_shots`` but hosted
    video models quantize to whole seconds within a supported range, so it is
    rounded and clamped here. Callers that care about the discrepancy should
    record both values (apply.py does).
    """
    payload = {
        "prompt": prompt,
        "reference_image_urls": [image_url],
        # Same reasoning as vlm_describe: cover both singular and plural key
        # spellings so a payload-schema drift does not break the run.
        "image_url": image_url,
        "duration": quantize_duration(duration),
        "resolution": resolution,
    }
    result = submit(ENDPOINTS["reference_to_video"], payload, timeout)
    return first_url(result, ENDPOINTS["reference_to_video"])


def quantize_duration(duration: float, lo: int = 3, hi: int = 12) -> int:
    """Round a planned shot length onto the video model's supported grid."""
    return int(max(lo, min(hi, round(float(duration)))))


def text_to_image(
    prompt: str,
    image_refs: list[str] | None = None,
    *,
    timeout: int = 300,
) -> list[str]:
    """Generate stills, optionally conditioned on reference images."""
    payload: dict[str, Any] = {"prompt": prompt, "num_images": 1}
    if image_refs:
        payload["image_urls"] = list(image_refs)
    result = submit(ENDPOINTS["text_to_image"], payload, timeout)
    urls = parse_urls(result)
    if not urls:
        raise FalError(f"no image URL in response from {ENDPOINTS['text_to_image']}")
    return urls


def extract_frame(video_url: str, timestamp: float, *, timeout: int = 300) -> str:
    """Pull a single frame out of a hosted video. Returns the image URL."""
    payload = {"video_url": video_url, "timestamp": round(float(timestamp), 3)}
    result = submit(ENDPOINTS["extract_frame"], payload, timeout)
    return first_url(result, ENDPOINTS["extract_frame"])


def compose(tracks: list[dict], *, timeout: int = 900) -> str:
    """Composite timeline tracks into one video. Returns the output URL.

    ``tracks`` is passed straight through so the caller owns the timeline
    shape; the ffmpeg-api track schema is another default worth verifying
    before a live run.
    """
    result = submit(ENDPOINTS["compose"], {"tracks": tracks}, timeout)
    return first_url(result, ENDPOINTS["compose"])


def merge_videos(video_urls: list[str], *, timeout: int = 900) -> str:
    """Concatenate videos end to end. Returns the merged URL."""
    if not video_urls:
        raise FalError("merge_videos() needs at least one video URL")
    payload = {"video_urls": list(video_urls)}
    result = submit(ENDPOINTS["merge_videos"], payload, timeout)
    return first_url(result, ENDPOINTS["merge_videos"])


# ---------------------------------------------------------------------------
# download
# ---------------------------------------------------------------------------


MAX_DOWNLOAD_BYTES = 2 * 1024 * 1024 * 1024  # bounded large video/GLB downloads


def _validate_download_url(url: str) -> None:
    try:
        parsed = urllib.parse.urlsplit(url)
        host = parsed.hostname or ""
        valid = (parsed.scheme == "https" and not parsed.username
                 and not parsed.password and parsed.port in (None, 443)
                 and (host == "fal.media" or host.endswith(".fal.media")))
    except ValueError:
        valid = False
    if not valid:
        raise FalError("download requires HTTPS on an approved fal.media host")


class _SafeRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        _validate_download_url(newurl)
        return super().redirect_request(req, fp, code, msg, headers, newurl)


def download(url: str, dest: str | Path) -> Path:
    """Bounded HTTPS download; failed transfers preserve existing destinations."""
    dest = Path(dest)
    if is_dry_run():
        dest.parent.mkdir(parents=True, exist_ok=True)
        dest.write_bytes(b"taste-forge dry-run placeholder\n")
        log.info("[dry-run] would download from %s", safe_url(url))
        return dest

    require_live()
    _validate_download_url(url)
    dest.parent.mkdir(parents=True, exist_ok=True)
    log.info("downloading from %s", safe_url(url))
    req = urllib.request.Request(url, headers={"User-Agent": "taste-forge"})
    opener = urllib.request.build_opener(_SafeRedirect())
    temporary = None
    try:
        with opener.open(req, timeout=300) as resp:
            declared = getattr(resp, "headers", {}).get("Content-Length")
            expected = int(declared) if declared is not None else None
            if expected is not None and not 0 <= expected <= MAX_DOWNLOAD_BYTES:
                raise FalError("download declares an invalid or excessive size")
            with tempfile.NamedTemporaryFile(dir=dest.parent, prefix=".taste-download-",
                                             delete=False) as fh:
                temporary = Path(fh.name)
                total = 0
                while True:
                    chunk = resp.read(min(1024 * 1024, MAX_DOWNLOAD_BYTES - total + 1))
                    if not chunk:
                        break
                    total += len(chunk)
                    if total > MAX_DOWNLOAD_BYTES:
                        raise FalError("download exceeds maximum allowed size")
                    fh.write(chunk)
                if expected is not None and total != expected:
                    raise FalError("download length does not match declared size")
        os.replace(temporary, dest)
        temporary = None
    except FalError:
        raise
    except Exception:
        raise FalError("download failed; existing destination preserved") from None
    finally:
        if temporary is not None:
            temporary.unlink(missing_ok=True)
    return dest


# ---------------------------------------------------------------------------
# dry-run stubs
# ---------------------------------------------------------------------------


def _digest(*parts: Any) -> str:
    h = hashlib.sha256("|".join(str(p) for p in parts).encode("utf-8"))
    return h.hexdigest()[:12]


def _stub_from_schema(schema: dict) -> dict:
    """Build a stub object with the same keys and types as ``schema``."""
    out: dict[str, Any] = {}
    for key, example in schema.items():
        if isinstance(example, list):
            out[key] = [f"dry-run-{key}-{i}" for i in range(1, 4)]
        elif isinstance(example, bool):
            out[key] = example
        elif isinstance(example, (int, float)):
            out[key] = example
        else:
            out[key] = f"dry-run {key}: {example}" if example else f"dry-run {key}"
    return out


def _stub(endpoint: str, payload: dict) -> dict:
    """A plausible, deterministic response for ``endpoint``.

    Deterministic because it is keyed on the payload digest: two different
    shots get two different URLs, so a dry-run manifest still demonstrates
    that every shot was distinct and reproducible.
    """
    tag = _digest(endpoint, sorted(payload.items(), key=lambda kv: kv[0]))
    base = f"{DRY_RUN_HOST}/{tag}"

    if endpoint == ENDPOINTS["vlm"]:
        return {"output": json.dumps({"note": "dry-run VLM output", "payload_digest": tag})}
    if endpoint in (ENDPOINTS["retopology"], ENDPOINTS["part_split"]):
        return {"parts": [{"url": f"{base}/part_{i}.glb"} for i in range(3)],
                "model_mesh": {"url": f"{base}/retopo.glb"}}
    if endpoint in (ENDPOINTS["image_to_3d"], ENDPOINTS["text_to_3d"]):
        return {
            "model_mesh": {
                "url": f"{base}/mesh.glb",
                "file_name": "mesh.glb",
                "content_type": "model/gltf-binary",
                "file_size": 1_048_576,
            }
        }
    if endpoint == ENDPOINTS["reference_to_video"]:
        return {
            "video": {"url": f"{base}/shot.mp4", "content_type": "video/mp4"},
            "seed": int(tag[:6], 16),
        }
    if endpoint == ENDPOINTS["text_to_image"]:
        return {"images": [{"url": f"{base}/image.png", "width": 1920, "height": 1080}]}
    if endpoint == ENDPOINTS["extract_frame"]:
        return {"image": {"url": f"{base}/frame.png", "content_type": "image/png"}}
    if endpoint in (ENDPOINTS["compose"], ENDPOINTS["merge_videos"],
                    ENDPOINTS["images_to_video"]):
        return {"video": {"url": f"{base}/out.mp4", "content_type": "video/mp4"}}

    return {"output": {"url": f"{base}/output.bin"}, "endpoint": endpoint}
