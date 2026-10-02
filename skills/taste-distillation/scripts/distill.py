#!/usr/bin/env python3
"""Distill a semantic style spec into an existing pack. Stage 2 of taste-forge.

mint.py measures what a camera can measure: color statistics, cut rhythm,
grain. That covers the half of "taste" that is numeric. This stage covers the
other half - the part a colorist would say out loud. It shows the pack's own
stills to a vision model and asks for the vocabulary back: focal length,
lighting, framing, mood, and crucially what to *avoid*.

That vocabulary is what apply.py feeds to a text-conditioned video model,
which cannot consume a .cube LUT or a shot-length histogram. So the pack ends
up carrying both representations of the same look, and each one goes to the
consumer that can actually use it.

Unlike stage 1 this stage is fal-dependent and costs money, hence
``--dry-run`` (or ``TASTE_FORGE_DRY_RUN=1``), which exercises the entire path
with stub responses and no API key.

    python distill.py --genre flashethereal
    python distill.py --genre flashethereal --no-props --dry-run
"""

from __future__ import annotations

import argparse
import json
import logging
import re
import sys
from datetime import datetime, timezone
from pathlib import Path

from taste import falapi
from taste import pack as pack_mod

log = logging.getLogger("taste.distill")

# The contract with the VLM. Values are examples, not data: they show the
# model the expected type of each field, and falapi reuses the same dict to
# synthesize dry-run output, so offline runs exercise real parsing.
SPEC_SCHEMA: dict = {
    "palette_description": "dominant colors and how they are distributed",
    "grain": "texture/noise character, e.g. fine 35mm grain",
    "lighting": "key/fill/practical sources and their quality",
    "focal_length": "apparent focal length and its perspective effect, e.g. 35mm",
    "camera_motion": "how the camera moves, or that it is locked off",
    "subject_framing": "how subjects sit in frame; headroom, rule-of-thirds, negative space",
    "grade_description": "the color grade in colorist language",
    "mood_adjectives": ["adjective", "adjective", "adjective"],
    "avoid": ["thing to avoid", "thing to avoid"],
}

REQUIRED_KEYS = tuple(SPEC_SCHEMA)
LIST_KEYS = tuple(k for k, v in SPEC_SCHEMA.items() if isinstance(v, list))

BASE_PROMPT = (
    "You are a cinematographer and colorist analyzing frames from ONE "
    "cohesive body of work. All images share a single visual style; describe "
    "that shared style, not the individual subjects.\n\n"
    "Be concrete and technical. Prefer 'anamorphic 40mm, shallow, oval bokeh' "
    "over 'cinematic'. The 'avoid' list should name the failure modes a "
    "generative video model would fall into when imitating this look "
    "(for example: over-saturated skin, plastic highlights, drifting camera).\n\n"
    "Output STRICT JSON only. No markdown fence, no prose before or after."
)

STRICTER_SUFFIX = (
    "\n\nYour previous reply could not be parsed as JSON. Reply with a single "
    "JSON object and nothing else. Start your reply with '{' and end it with "
    "'}'. Do not wrap it in a code fence. Do not add commentary. Every key "
    "listed must be present; use a short string (or list of strings) for each."
)


# ---------------------------------------------------------------------------
# JSON extraction / repair
# ---------------------------------------------------------------------------


def extract_json(text: str) -> dict:
    """Pull a JSON object out of a model reply.

    Models wrap JSON in code fences and preambles even when told not to, so a
    bare ``json.loads`` fails on output that is otherwise perfectly good.
    Fenced content is tried first, then the outermost balanced ``{...}``.
    """
    if not text or not text.strip():
        raise ValueError("empty response")

    candidates: list[str] = []
    for m in re.finditer(r"```(?:json)?\s*(.+?)```", text, re.DOTALL | re.IGNORECASE):
        candidates.append(m.group(1))
    candidates.append(text)

    for chunk in candidates:
        chunk = chunk.strip()
        try:
            obj = json.loads(chunk)
            if isinstance(obj, dict):
                return obj
        except json.JSONDecodeError:
            pass
        span = _balanced_object(chunk)
        if span:
            try:
                obj = json.loads(span)
                if isinstance(obj, dict):
                    return obj
            except json.JSONDecodeError:
                continue

    raise ValueError(f"no JSON object found in response: {text[:200]!r}")


def _balanced_object(text: str) -> str | None:
    start = text.find("{")
    if start < 0:
        return None
    depth = 0
    in_str = False
    esc = False
    for i in range(start, len(text)):
        ch = text[i]
        if in_str:
            if esc:
                esc = False
            elif ch == "\\":
                esc = True
            elif ch == '"':
                in_str = False
            continue
        if ch == '"':
            in_str = True
        elif ch == "{":
            depth += 1
        elif ch == "}":
            depth -= 1
            if depth == 0:
                return text[start : i + 1]
    return None


def validate_spec(obj: dict) -> tuple[dict, list[str]]:
    """Coerce a parsed object onto the schema. Returns (spec, problems).

    Type drift is repaired rather than rejected - a model returning
    ``"moody, warm"`` where a list was asked for is close enough to salvage.
    Genuinely missing keys are reported so the caller can decide to retry.
    """
    spec: dict = {}
    problems: list[str] = []

    for key in REQUIRED_KEYS:
        val = obj.get(key)
        if key in LIST_KEYS:
            if isinstance(val, str):
                items = [p.strip() for p in re.split(r"[,;\n]", val) if p.strip()]
                spec[key] = items
                problems.append(f"{key}: string coerced to list")
            elif isinstance(val, list):
                spec[key] = [str(v).strip() for v in val if str(v).strip()]
            else:
                spec[key] = []
                problems.append(f"{key}: missing")
        else:
            if isinstance(val, str) and val.strip():
                spec[key] = val.strip()
            elif val is None or (isinstance(val, str) and not val.strip()):
                spec[key] = ""
                problems.append(f"{key}: missing")
            else:
                spec[key] = json.dumps(val) if isinstance(val, (dict, list)) else str(val)
                problems.append(f"{key}: {type(val).__name__} coerced to string")

    extra = [k for k in obj if k not in REQUIRED_KEYS]
    if extra:
        spec["extra"] = {k: obj[k] for k in extra}

    return spec, problems


# ---------------------------------------------------------------------------
# still selection
# ---------------------------------------------------------------------------


def detail_score(path: Path) -> float:
    """Variance of the Laplacian - a standard sharpness/detail proxy.

    The image-to-3d step gets exactly one frame, so it should be the crispest
    one available: a motion-blurred transition frame reconstructs into mush.
    """
    try:
        import cv2  # noqa: PLC0415 - optional at call time

        img = cv2.imread(str(path), cv2.IMREAD_GRAYSCALE)
        if img is None:
            return 0.0
        return float(cv2.Laplacian(img, cv2.CV_64F).var())
    except Exception as exc:  # noqa: BLE001 - scoring is best-effort
        log.debug("detail scoring failed for %s: %s", path.name, exc)
        return 0.0


def pick_stills(stills: list[Path], limit: int) -> list[Path]:
    """Spread the selection across the whole pack rather than taking a prefix.

    Stills are named per reference, so the first N are all from ref #1 - which
    would describe one reference's style and call it the genre's.
    """
    if limit <= 0 or len(stills) <= limit:
        return list(stills)
    step = len(stills) / limit
    return [stills[min(len(stills) - 1, int(i * step))] for i in range(limit)]


# ---------------------------------------------------------------------------
# stages
# ---------------------------------------------------------------------------



def build_grounding(sp) -> str:
    """Turn the minted measurements into a factual preamble for the VLM.

    The first ungrounded run of this pipeline produced a spec asserting
    "no apparent color grading... absence of warmth or coolness" for a
    reference set whose midtones measure a*+24.9 b*-17.5. A vision model
    shown a handful of stills judges them semantically and cannot integrate
    a chroma distribution across two hundred frames, so it reports what the
    content looks like and misses the systematic grade entirely.

    Stating the measurements as facts up front inverts the dependency: the
    model is no longer voting on whether a grade exists, only describing how
    the measured one manifests. Anything numeric belongs here; the model is
    left to do the part it is actually good at, which is language.
    """
    grade = sp.read_json(sp.grade_path)
    cad = sp.read_json(sp.cadence_path)
    if not grade:
        return ""

    lines = ["MEASURED GROUND TRUTH for this reference set, from numeric analysis of "
             "the sampled frames. These are FACTS. Do not contradict them. Do not "
             "describe this footage as neutral, ungraded, or clinical:"]

    bp, wp = grade.get("black_point"), grade.get("white_point")
    if bp is not None:
        lines.append(f"- black point L*{bp:.1f}, white point L*{wp:.1f}, "
                     f"contrast (std L*) {grade.get('contrast', 0):.1f}")

    zones = grade.get("zones") or []
    if zones:
        centers = [7.5, 25, 45, 65, 87.5]
        z = " | ".join(
            f"L*{c:.0f} a*{v[0]:+.1f} b*{v[2]:+.1f}"
            for c, v in zip(centers, zones)
        )
        lines.append(f"- chroma by luminance zone: {z}")
        peak = max(range(len(zones)), key=lambda i: zones[i][0] ** 2 + zones[i][2] ** 2)
        lines.append(f"- the colour identity is concentrated at L*{centers[peak]:.0f}; "
                     f"state where it sits and what it does there")

    pal = grade.get("palette") or []
    if pal:
        lines.append("- dominant palette: " + ", ".join(h for h, _ in pal[:5]))

    if grade.get("noise_sigma") is not None:
        lines.append(f"- measured grain sigma {grade['noise_sigma']:.4f} (encode noise, "
                     f"not necessarily aesthetic grain - judge that from the images)")

    if cad:
        lines.append(f"- cut rhythm: {cad.get('n_shots')} shots, mean "
                     f"{cad.get('mean_shot', 0):.2f}s, {cad.get('cuts_per_min', 0):.0f} "
                     f"cuts/min, rhythm variance {cad.get('rhythm_variance', 0):.2f}")

    lines.append("")
    lines.append("Describe HOW that measured grade manifests visually. Do not judge "
                 "whether it exists. Write DIRECTIVE instructions for a generative "
                 "video model.")
    lines.append("BANNED words: varied, mixed, dynamic, various, inconsistent, some, "
                 "often, sometimes, likely, neutral, clinical. Every field must COMMIT "
                 "to one specific choice; if the references differ, name the DOMINANT one.")
    lines.append("")
    return "\n".join(lines)


# Words that describe a distribution rather than a choice. A generative model
# cannot render "varied lighting"; it renders one lighting setup, so a spec
# that hedges has simply moved the decision back onto whoever reads it.
#
# The ban is stated in the grounding prompt and the model still violated it in
# roughly one run in three, which is why this is enforced in code rather than
# left as an instruction. Enforcement is per-field: only the offending fields
# are sent back, so a good spec is not thrown away because one line hedged.
BANNED_WORDS = (
    "varied", "mixed", "dynamic", "various", "inconsistent", "some",
    "often", "sometimes", "likely", "neutral", "clinical", "several",
    "a mix of", "ranging from", "generally", "typically", "or ",
)


def banned_hits(spec: dict) -> dict[str, list[str]]:
    """Fields that hedge, and which words they hedged with."""
    out: dict[str, list[str]] = {}
    for key, val in spec.items():
        text = " ".join(str(v) for v in val) if isinstance(val, list) else str(val or "")
        low = text.lower()
        hits = [w for w in BANNED_WORDS if w in low]
        if hits:
            out[key] = hits
    return out


def _rewrite_prompt(base: str, hits: dict[str, list[str]], spec: dict) -> str:
    lines = [base, "", "Your previous answer hedged. These fields are unusable:"]
    for key, words in hits.items():
        lines.append(f"- {key}: contains {', '.join(repr(w.strip()) for w in words)} "
                     f"-> currently {spec.get(key)!r}")
    lines.append("")
    lines.append("Rewrite the WHOLE JSON. For each field above, name the single "
                 "dominant choice you actually see. If two options are close, pick "
                 "the one that appears in more frames and say only that one.")
    return "\n".join(lines)


def describe(image_urls: list[str], grounding: str = "") -> tuple[dict, dict]:
    """Ask the VLM for the style spec, repairing once if it does not parse.

    Returns ``(spec, provenance)``.
    """
    attempts: list[dict] = []
    base = (grounding + BASE_PROMPT) if grounding else BASE_PROMPT
    prompt = base

    best: tuple[dict, dict] | None = None
    for attempt in (1, 2, 3):
        raw = falapi.vlm_describe(image_urls, prompt, SPEC_SCHEMA)
        record = {"attempt": attempt, "chars": len(raw or "")}
        try:
            parsed = extract_json(raw)
        except ValueError as exc:
            record["error"] = str(exc)[:200]
            attempts.append(record)
            log.warning("attempt %d did not parse (%s)", attempt, exc)
            prompt = base + STRICTER_SUFFIX
            continue

        spec, problems = validate_spec(parsed)
        record["problems"] = problems
        attempts.append(record)

        missing = [p for p in problems if p.endswith(": missing")]
        if missing and attempt == 1:
            log.warning("attempt 1 incomplete (%s); retrying stricter", ", ".join(missing))
            prompt = base + STRICTER_SUFFIX
            continue

        hits = banned_hits(spec)
        record["hedged"] = {k: v for k, v in hits.items()}
        prov = {"attempts": attempts, "endpoint": falapi.ENDPOINTS["vlm"],
                "hedged_fields": sorted(hits)}
        if not hits:
            return spec, prov

        # Keep the best answer seen so far, so three hedged attempts still
        # yield the least-hedged one rather than an exception.
        if best is None or len(hits) < len(banned_hits(best[0])):
            best = (spec, prov)
        if attempt < 3:
            log.warning("attempt %d hedged on %s; asking it to commit",
                        attempt, ", ".join(sorted(hits)))
            prompt = _rewrite_prompt(base, hits, spec)
            continue
        log.warning("still hedging on %s after 3 attempts; keeping best",
                    ", ".join(sorted(banned_hits(best[0]))))
        return best

    if best is not None:
        return best
    raise SystemExit(
        "the vision model never returned usable JSON after 3 attempts; "
        f"detail: {json.dumps(attempts)}"
    )


def mint_prop(sp: pack_mod.StylePack, stills: list[Path]) -> dict | None:
    """Turn the highest-detail still into a GLB and store it in the pack."""
    scored = sorted(((detail_score(p), p) for p in stills), key=lambda t: -t[0])
    if not scored:
        return None
    score, hero = scored[0]
    print(f"  prop source    : {hero.name} (detail {score:.1f})")

    url = falapi.upload(hero)
    mesh_url = falapi.image_to_3d(url)
    dest = sp.props_dir / f"{hero.stem}.glb"
    falapi.download(mesh_url, dest)
    return {
        "source_still": hero.name,
        "detail_score": round(score, 3),
        "mesh_url": mesh_url,
        "file": dest.name,
        "endpoint": falapi.ENDPOINTS["image_to_3d"],
    }


def distill(
    genre: str,
    root: str = "stylepacks",
    max_stills: int = 6,
    props: bool = True,
) -> pack_mod.StylePack:
    sp = pack_mod.load(genre, root=root)
    all_stills = sp.stills()
    if not all_stills:
        raise SystemExit(
            f"pack '{genre}' has no stills under {sp.stills_dir} - run mint.py first"
        )

    chosen = pick_stills(all_stills, max_stills)
    mode = "DRY RUN" if falapi.is_dry_run() else "live"
    print(f"distilling '{genre}' [{mode}] from {len(chosen)}/{len(all_stills)} stills")

    urls = falapi.upload_many(chosen)
    print(f"  uploaded       : {len(urls)} still(s)")

    grounding = build_grounding(sp)
    if grounding:
        print(f"  grounding VLM with {len(grounding.splitlines())} measured facts")
    spec, provenance = describe(urls, grounding=grounding)

    spec["source"] = {
        "pack": genre,
        "generated": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "stills": [p.name for p in chosen],
        "dry_run": falapi.is_dry_run(),
        **provenance,
    }
    sp.write_json(sp.spec_path, spec)
    print(f"  spec           : {sp.spec_path}")

    prop_info = None
    if props:
        try:
            prop_info = mint_prop(sp, chosen)
        except falapi.FalError as exc:
            # A failed prop should not throw away a spec that already cost a
            # VLM call; the spec is the load-bearing artifact here.
            log.error("prop minting failed, spec kept: %s", exc)
            print(f"  !! prop failed : {exc}", file=sys.stderr)
    else:
        print("  props          : skipped (--no-props)")

    sp.manifest["distill"] = {
        "generated": spec["source"]["generated"],
        "stills_used": [p.name for p in chosen],
        "vlm_endpoint": falapi.ENDPOINTS["vlm"],
        "vlm_model": falapi.VLM_MODEL,
        "dry_run": falapi.is_dry_run(),
        "prop": prop_info,
    }
    sp.save()

    _report(sp, spec, prop_info)
    return sp


def _report(sp: pack_mod.StylePack, spec: dict, prop_info: dict | None) -> None:
    print(f"\n  === {sp.name} spec ===")
    for key in REQUIRED_KEYS:
        val = spec.get(key)
        shown = ", ".join(val) if isinstance(val, list) else (val or "-")
        if len(shown) > 88:
            shown = shown[:85] + "..."
        print(f"  {key:<20}: {shown}")
    if prop_info:
        print(f"  {'prop':<20}: props/{prop_info['file']}")
    print(f"\n  pack -> {sp.dir}")
    print(f"  next: python apply.py --genre {sp.name} --style-steer '...' --brief '...'")


def main() -> None:
    ap = argparse.ArgumentParser(
        description="Distill a semantic style spec into an existing style pack (stage 2)."
    )
    ap.add_argument("--genre", required=True, help="existing pack name, e.g. flashethereal")
    ap.add_argument("--root", default="stylepacks")
    ap.add_argument("--max-stills", type=int, default=6,
                    help="how many stills to show the vision model (cost scales with this)")
    ap.add_argument("--props", dest="props", action="store_true", default=True,
                    help="mint a GLB prop from the highest-detail still (default)")
    ap.add_argument("--no-props", dest="props", action="store_false",
                    help="skip 3D prop minting")
    ap.add_argument("--dry-run", action="store_true",
                    help="stub every network call; no API key needed, no spend")
    ap.add_argument("--verbose", "-v", action="store_true")
    a = ap.parse_args()

    logging.basicConfig(
        level=logging.DEBUG if a.verbose else logging.INFO,
        format="%(levelname)s %(name)s: %(message)s",
    )
    if a.dry_run:
        falapi.enable_dry_run()

    try:
        # Check credentials before uploading anything, so a missing key costs
        # nothing and reports once.
        if not falapi.is_dry_run():
            falapi.api_key()
        distill(a.genre, a.root, a.max_stills, a.props)
    except (FileNotFoundError, falapi.FalError) as exc:
        raise SystemExit(f"distill failed: {exc}") from exc


if __name__ == "__main__":
    main()
