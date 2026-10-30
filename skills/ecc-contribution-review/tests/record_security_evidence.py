"""Record a pinned Bandit scan with the exact scanned source hashes."""

import argparse
import hashlib
import json
import subprocess
import sys
import tempfile
from importlib.metadata import version
from pathlib import Path

SCRIPTS = Path("skills/ecc-contribution-review/scripts")
BANDIT_VERSION = "1.9.4"


def source_hashes(repo: Path) -> dict[str, str]:
    return {
        path.relative_to(repo).as_posix(): hashlib.sha256(path.read_bytes()).hexdigest()
        for path in sorted((repo / SCRIPTS).rglob("*.py"))
    }


def validate_report(report: dict, sources: dict[str, str]) -> None:
    expected = {"scanner": "bandit", "version": BANDIT_VERSION, "sha256": sources}
    if report.get("source_provenance") != expected:
        raise ValueError("Bandit source provenance does not match current source content")
    if set(report.get("metrics", {})) - {"_totals"} != set(sources):
        raise ValueError("Bandit scanned inventory does not match source provenance")


def record(repo: Path, output: Path) -> int:
    if version("bandit") != BANDIT_VERSION:
        raise RuntimeError(f"Bandit {BANDIT_VERSION} is required")
    before = source_hashes(repo)
    with tempfile.TemporaryDirectory() as directory:
        raw = Path(directory) / "bandit.json"
        result = subprocess.run(
            [sys.executable, "-m", "bandit", "-r", SCRIPTS.as_posix(), "-f", "json", "-o", str(raw)],
            cwd=repo, check=False,
        )
        if result.returncode not in {0, 1}:
            raise RuntimeError(f"Bandit scan failed with exit {result.returncode}")
        report = json.loads(raw.read_text())
    if before != source_hashes(repo):
        raise RuntimeError("Source changed during the Bandit scan; evidence discarded")
    recorded = {
        **report,
        "source_provenance": {"scanner": "bandit", "version": BANDIT_VERSION, "sha256": before},
    }
    validate_report(recorded, before)
    output.write_text(json.dumps(recorded, indent=2, sort_keys=True) + "\n")
    return 1 if report.get("errors") or report.get("results") else result.returncode


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    return record(Path(__file__).resolve().parents[3], args.output)


if __name__ == "__main__":
    raise SystemExit(main())
