#!/usr/bin/env python3
"""Install curated skills into a native Codex discovery directory."""

import argparse
import json
import os
from pathlib import Path
import re
import sys

ROOT = Path(__file__).resolve().parents[1]
NAME = re.compile(r"ecc-[a-z0-9]+(?:-[a-z0-9]+)*\Z")


def catalog(root=ROOT):
    data = json.loads((root / "skills.json").read_text(encoding="utf-8"))
    profiles = data["profiles"]
    if not profiles or not set(data["default_profiles"]) <= profiles.keys():
        raise ValueError("Invalid default profiles")
    names = set()
    for profile, entries in profiles.items():
        if not re.fullmatch(r"[a-z][a-z0-9-]*", profile) or not entries:
            raise ValueError(f"Invalid profile: {profile}")
        for name in entries:
            if not NAME.fullmatch(name):
                raise ValueError(f"Invalid skill name: {name}")
            source = root / "skills" / name
            if source.is_symlink() or not source.is_dir():
                raise ValueError(f"Skill must be a real directory: {source}")
            for item in source.rglob("*"):
                if item.is_symlink():
                    raise ValueError(f"Symlinks inside a skill are not supported: {item}")
            text = (source / "SKILL.md").read_text(encoding="utf-8")
            if not text.startswith(f"---\nname: {name}\n"):
                raise ValueError(f"Skill name does not match its directory: {source}")
            names.add(name)
    actual = {p.name for p in (root / "skills").iterdir() if p.is_dir()}
    if names != actual:
        raise ValueError(f"Catalog mismatch: {sorted(names ^ actual)}")
    return data


def parser():
    cli = argparse.ArgumentParser(description=__doc__)
    scope = cli.add_mutually_exclusive_group()
    scope.add_argument("--user", action="store_true", help="Install for all projects (default)")
    scope.add_argument("--project", type=Path, metavar="DIR", help="Install into DIR/.agents/skills")
    scope.add_argument("--dest", type=Path, metavar="DIR", help="Use an explicit skills directory")
    cli.add_argument("--profile", action="append", metavar="NAME", help="Repeat to select profiles; 'all' includes infra")
    cli.add_argument("--dry-run", action="store_true", help="Validate and print the plan without writing")
    cli.add_argument("--uninstall", action="store_true", help="Remove only selected links pointing to this checkout")
    cli.add_argument("--list", action="store_true", help="List available profiles and skills without writing")
    return cli


def destination(args):
    if args.dest is not None:
        return args.dest.expanduser().absolute()
    if args.project is not None:
        project = args.project.expanduser().absolute()
        if not project.is_dir():
            raise ValueError(f"Project directory does not exist: {project}")
        return project / ".agents" / "skills"
    return Path.home() / ".agents" / "skills"


def same_link(link, source):
    return link.is_symlink() and link.resolve() == source.resolve()


def plan_install(target, names, uninstall=False, root=ROOT):
    ancestor = target
    while not os.path.lexists(ancestor):
        ancestor = ancestor.parent
    if not ancestor.is_dir():
        raise ValueError(f"Destination or its existing parent is not a directory: {ancestor}")
    # Resolve the destination before checking containment, including symlinked parents.
    resolved = target.resolve()
    if resolved == (root / "skills").resolve() or (root / "skills").resolve() in resolved.parents:
        raise ValueError("The installation destination cannot be inside the source skills")
    plan, conflicts = [], []
    for name in names:
        source, link = root / "skills" / name, target / name
        if same_link(link, source):
            action = "remove" if uninstall else "keep"
        elif os.path.lexists(link):
            if uninstall:
                action = "skip-unowned"
            else:
                conflicts.append(str(link))
                continue
        else:
            action = "absent" if uninstall else "link"
        plan.append((action, link, source))
    if conflicts:
        raise ValueError("Existing skills will not be overwritten:\n  " + "\n  ".join(conflicts))
    return plan


def apply(plan):
    created = []
    try:
        for action, link, source in plan:
            if action == "link":
                link.parent.mkdir(parents=True, exist_ok=True)
                # symlink() fails if another process has created this path since preflight.
                link.symlink_to(source, target_is_directory=True)
                created.append((link, source))
            elif action == "remove":
                if not same_link(link, source):
                    raise ValueError(f"Link changed after preflight; refusing to remove: {link}")
                link.unlink()
    except (OSError, ValueError):
        for link, source in reversed(created):
            if same_link(link, source):
                link.unlink()
        raise


def main(argv=None):
    cli = parser()
    args = cli.parse_args(argv)
    try:
        data = catalog()
        if args.list:
            for name, skills in data["profiles"].items():
                default = " (default)" if name in data["default_profiles"] else ""
                print(f"{name}{default}: {', '.join(skills)}")
            return 0
        selected = args.profile or data["default_profiles"]
        unknown = set(selected) - data["profiles"].keys() - {"all"}
        if unknown:
            raise ValueError(f"Unknown profiles: {', '.join(sorted(unknown))}; use --list")
        if "all" in selected:
            selected = list(data["profiles"])
        names = sorted({skill for name in selected for skill in data["profiles"][name]})
        target = destination(args)
        plan = plan_install(target, names, uninstall=args.uninstall)
        print(f"Codex skills: {target}")
        for action, link, source in plan:
            suffix = f" -> {source}" if action == "link" else ""
            print(f"{action}: {link.name}{suffix}")
        if args.dry_run:
            print("Dry run: no files changed.")
        else:
            apply(plan)
            print("Done. Links follow this checkout; uninstall before moving or deleting it.")
        return 0
    except (OSError, ValueError, KeyError, TypeError) as error:
        print(f"error: {error}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main())
