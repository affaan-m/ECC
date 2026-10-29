"""Operator CLI: python3 -m tasteforge <command> [ ... ].

All commands are offline and deterministic. Provider-backed operations fail
closed with exit code 2 and an actionable message; no command accepts or
reads credentials, and none can invoke a provider.
"""

from __future__ import annotations

import argparse
import json
import re
import subprocess
import sys
from pathlib import Path
from typing import Any

from . import apply as apply_mod
from . import contract as contract_mod
from . import distill as distill_mod
from . import export as export_mod
from . import interview as interview_mod
from . import pack as pack_mod
from . import provenance
from . import workflow as workflow_mod

EXIT_OK = 0
EXIT_INVALID = 1
EXIT_FAIL_CLOSED = 2


def _print_json(payload) -> None:
    print(json.dumps(payload, indent=2))


def cmd_provenance(args: argparse.Namespace) -> int:
    _print_json(provenance.lineage_report())
    return EXIT_OK


def cmd_inspect(args: argparse.Namespace) -> int:
    sp = pack_mod.load(args.pack)
    report = sp.inspect()
    _print_json(report)
    return EXIT_OK if report["validation"]["status"] == "valid" else EXIT_INVALID


def cmd_validate(args: argparse.Namespace) -> int:
    sp = pack_mod.load(args.pack)
    report = sp.inspect()
    v = report["validation"]
    for err in v["errors"]:
        print(f"ERROR {err}", file=sys.stderr)
    for warn in v["warnings"]:
        print(f"WARN  {warn}", file=sys.stderr)
    print(f"{report['name']}: {v['status']}")
    return EXIT_OK if v["status"] == "valid" else EXIT_INVALID


def cmd_interview(args: argparse.Namespace) -> int:
    answers = json.loads(Path(args.answers).read_text(encoding="utf-8"))
    profile = interview_mod.conduct(answers, genre=args.genre)
    out = Path(args.out) if args.out else Path(f"{args.genre}-profile.json")
    out.write_text(json.dumps(profile, indent=2), encoding="utf-8")
    print(out)
    return EXIT_OK


_OUTPUT_COMPONENT = re.compile(r"^[a-z0-9][a-z0-9_-]*$")


def _output_component(value: Any, what: str) -> str:
    """Return ``value`` only when it is safe to use as an output filename part.

    Pack names and genres come from operator-authored JSON. They are only
    used to derive default output paths, so they must never carry path
    separators or traversal; the same pattern the manifest schema declares.
    """
    if not isinstance(value, str) or not _OUTPUT_COMPONENT.fullmatch(value):
        raise ValueError(
            f"{what} must match {_OUTPUT_COMPONENT.pattern} to name an output file; pass --out"
        )
    return value


def cmd_distill(args: argparse.Namespace) -> int:
    if args.live:
        print(distill_mod._FAIL_CLOSED, file=sys.stderr)
        return EXIT_FAIL_CLOSED
    profile = json.loads(Path(args.profile).read_text(encoding="utf-8"))
    sp = pack_mod.load(args.pack) if args.pack else None
    spec = distill_mod.distill_local(profile, sp)
    out = (Path(args.out) if args.out
           else Path(f"{_output_component(profile.get('genre', 'spec'), 'profile genre')}-spec.json"))
    out.write_text(json.dumps(spec, indent=2), encoding="utf-8")
    print(out)
    return EXIT_OK


def cmd_apply(args: argparse.Namespace) -> int:
    if args.live:
        print(apply_mod._FAIL_CLOSED, file=sys.stderr)
        return EXIT_FAIL_CLOSED
    sp = pack_mod.load(args.pack)
    media = json.loads(Path(args.media).read_text(encoding="utf-8"))["clips"]
    report = apply_mod.apply_local(
        sp, media, duration=args.duration, fps=args.fps, no_repeat=args.no_repeat
    )
    out = (Path(args.out) if args.out
           else Path("out") / f"{_output_component(sp.name, 'pack name')}_apply_report.json")
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(report, indent=2), encoding="utf-8")
    print(out)
    return EXIT_OK


def cmd_export(args: argparse.Namespace) -> int:
    clips = json.loads(Path(args.events).read_text(encoding="utf-8"))["clips"]
    out_dir = Path(args.out_dir) if args.out_dir else Path("out")
    edl, fcpxml = export_mod.write_timeline(
        clips, out_dir=out_dir, fps=args.fps, title=args.title
    )
    print(edl)
    print(fcpxml)
    return EXIT_OK


def cmd_multimodal(args: argparse.Namespace) -> int:
    """Run and validate the file-driven multimodal dry-run contract."""
    config = Path(args.config)
    out_dir = Path(args.out_dir)
    receipt = workflow_mod.run_workflow(config, out_dir)
    contract_mod.validate_bundle(out_dir)
    _print_json(receipt)
    return EXIT_OK


def build_parser() -> argparse.ArgumentParser:
    ap = argparse.ArgumentParser(
        prog="tasteforge",
        description=(
            "Repeatable taste-driven video workflow (offline, deterministic; "
            "provider operations fail closed)"
        ),
    )
    sub = ap.add_subparsers(dest="command", required=True)

    p = sub.add_parser("provenance", help="print the recovered-source lineage")
    p.add_argument("--json", action="store_true", help="(output is always JSON)")
    p.set_defaults(func=cmd_provenance)

    p = sub.add_parser("inspect", help="inspect and validate a style pack")
    p.add_argument("pack", help="pack directory containing pack.json")
    p.add_argument("--json", action="store_true", help="(output is always JSON)")
    p.set_defaults(func=cmd_inspect)

    p = sub.add_parser("validate", help="validate a style pack; exit 1 on errors")
    p.add_argument("pack", help="pack directory containing pack.json")
    p.set_defaults(func=cmd_validate)

    p = sub.add_parser("interview", help="taste interview answers -> profile")
    p.add_argument("--answers", required=True, help="JSON {question_id: answer}")
    p.add_argument("--genre", default="untitled")
    p.add_argument("--out", help="output profile path (default <genre>-profile.json)")
    p.set_defaults(func=cmd_interview)

    p = sub.add_parser("distill", help="profile (+ pack) -> style spec (offline)")
    p.add_argument("--profile", required=True, help="profile JSON from `interview`")
    p.add_argument("--pack", help="optional pack dir for measured grounding")
    p.add_argument("--out", help="output spec path")
    p.add_argument("--live", action="store_true",
                   help="refused: provider distillation fails closed")
    p.set_defaults(func=cmd_distill)

    p = sub.add_parser("apply", help="apply a pack's cadence to local media")
    p.add_argument("--pack", required=True, help="pack directory")
    p.add_argument("--media", required=True,
                   help='JSON {"clips": [{"path", "duration", "name"?}]}')
    p.add_argument("--duration", type=float, default=None,
                   help="target seconds (default: sum of media durations)")
    p.add_argument("--fps", type=float, default=None,
                   help="sequence fps (overrides pack fps)")
    p.add_argument("--no-repeat", action="store_true",
                   help="use each source once; reject insufficient or short clips")
    p.add_argument("--out", help="output report path")
    p.add_argument("--live", action="store_true",
                   help="refused: provider generation fails closed")
    p.set_defaults(func=cmd_apply)

    p = sub.add_parser("export", help="timeline events -> EDL + FCPXML")
    p.add_argument("--events", required=True,
                   help='JSON {"clips": [{"path", "duration", "name"?}]}')
    p.add_argument("--out-dir", default=None)
    p.add_argument("--fps", type=float, default=24.0)
    p.add_argument("--title", default="taste-forge")
    p.set_defaults(func=cmd_export)

    p = sub.add_parser(
        "multimodal",
        help="file contract -> image/video/3D dry-run manifests and evidence receipt",
    )
    p.add_argument("--config", required=True, help="workflow JSON contract")
    p.add_argument("--out-dir", required=True, help="new evidence bundle directory")
    p.set_defaults(func=cmd_multimodal)

    return ap


def main(argv: list[str] | None = None) -> int:
    ap = build_parser()
    args = ap.parse_args(argv)
    try:
        return args.func(args)
    except (distill_mod.ProviderDisabledError, apply_mod.ProviderDisabledError) as exc:
        print(str(exc), file=sys.stderr)
        return EXIT_FAIL_CLOSED
    except FileNotFoundError as exc:
        print(f"ERROR {exc}", file=sys.stderr)
        return EXIT_INVALID
    except subprocess.CalledProcessError:
        print("ERROR local media processing failed", file=sys.stderr)
        return EXIT_INVALID
    except workflow_mod.MediaToolUnavailable:
        print("ERROR local media processing unavailable", file=sys.stderr)
        return EXIT_INVALID
    except ValueError as exc:
        print(f"ERROR {exc}", file=sys.stderr)
        return EXIT_INVALID


if __name__ == "__main__":
    sys.exit(main())
