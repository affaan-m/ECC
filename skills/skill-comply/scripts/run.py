"""CLI entry point for skill-comply."""

from __future__ import annotations

import argparse
import logging
import sys
from pathlib import Path
from typing import Any

import yaml

from scripts.grader import grade
from scripts.report import generate_report
from scripts.runner import run_scenario
from scripts.scenario_generator import generate_scenarios
from scripts.spec_generator import generate_spec

logger = logging.getLogger(__name__)


def _positive_int(value: str) -> int:
    number = int(value)
    if number < 1:
        raise argparse.ArgumentTypeError(f"must be a positive integer, got {value}")
    return number


def main() -> None:
    logging.basicConfig(level=logging.INFO, format="%(message)s")

    parser = argparse.ArgumentParser(
        description="skill-comply: Measure skill compliance rates",
    )
    parser.add_argument(
        "skill",
        type=Path,
        help="Path to skill/rule file to test",
    )
    parser.add_argument(
        "--model",
        default="sonnet",
        help="Model for scenario execution (default: sonnet)",
    )
    parser.add_argument(
        "--gen-model",
        default="haiku",
        help="Model for spec/scenario generation (default: haiku)",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Generate spec and scenarios without executing",
    )
    parser.add_argument(
        "--output",
        type=Path,
        default=None,
        help="Output report path (default: results/<skill-name>.md)",
    )

    parser.add_argument(
        "--max-turns",
        type=_positive_int,
        default=30,
        help="Turn cap per scenario; long multi-step workflows need more (default: 30)",
    )
    parser.add_argument(
        "--timeout",
        type=_positive_int,
        default=900,
        help="Seconds per scenario before the partial trace is graded (default: 900)",
    )
    parser.add_argument(
        "--fixtures",
        type=Path,
        default=None,
        help="Directory copied into every scenario sandbox (plans, config, sources)",
    )

    args = parser.parse_args()

    if args.fixtures is not None and not args.fixtures.is_dir():
        logger.error("Error: Fixtures directory not found: %s", args.fixtures)
        sys.exit(1)

    if not args.skill.is_file():
        logger.error("Error: Skill file not found: %s", args.skill)
        sys.exit(1)

    results_dir = Path(__file__).parent.parent / "results"
    results_dir.mkdir(exist_ok=True)

    # Step 1: Generate compliance spec
    logger.info("[1/4] Generating compliance spec from %s...", args.skill.name)
    spec = generate_spec(args.skill, model=args.gen_model)
    logger.info("       %d steps extracted", len(spec.steps))

    # Step 2: Generate scenarios
    spec_yaml = yaml.dump({
        "steps": [
            {"id": s.id, "description": s.description, "required": s.required}
            for s in spec.steps
        ]
    })
    logger.info("[2/4] Generating scenarios (3 prompt strictness levels)...")
    scenarios = generate_scenarios(args.skill, spec_yaml, model=args.gen_model)
    logger.info("       %d scenarios generated", len(scenarios))

    for s in scenarios:
        logger.info("       - %s: %s", s.level_name, s.description[:60])

    if args.dry_run:
        logger.info("\n[dry-run] Spec and scenarios generated. Skipping execution.")
        logger.info("\nSpec: %s (%d steps)", spec.id, len(spec.steps))
        for step in spec.steps:
            marker = "*" if step.required else " "
            logger.info("  [%s] %s: %s", marker, step.id, step.description)
        return

    # Step 3: Execute scenarios
    logger.info("[3/4] Executing scenarios (model=%s)...", args.model)
    graded_results: list[tuple[str, Any, list[Any]]] = []
    timed_out_levels: tuple[str, ...] = ()

    for scenario in scenarios:
        logger.info("       Running %s...", scenario.level_name)
        run = run_scenario(
            scenario,
            model=args.model,
            max_turns=args.max_turns,
            timeout=args.timeout,
            fixtures_dir=args.fixtures,
        )
        if run.timed_out:
            timed_out_levels += (scenario.level_name,)
            logger.warning(
                "       %s hit the %ds timeout; its partial trace is graded, "
                "so compliance may be understated.",
                scenario.level_name, args.timeout,
            )
        result = grade(spec, list(run.observations))
        graded_results.append((scenario.level_name, result, list(run.observations)))
        logger.info("       %s: %.0f%%", scenario.level_name, result.compliance_rate * 100)

    # Step 4: Generate report
    skill_name = args.skill.parent.name if args.skill.stem == "SKILL" else args.skill.stem
    output_path = args.output or results_dir / f"{skill_name}.md"
    logger.info("[4/4] Generating report...")

    report = generate_report(args.skill, spec, graded_results, scenarios=scenarios)
    conditions = [
        "> Execution boundary: setup supplies a local gh simulation and a local bare origin. "
        "This report verifies no live GitHub pull request, merge, or hosted CI result.",
    ]
    if timed_out_levels:
        conditions += [
            f"> Incomplete execution: {len(timed_out_levels)} scenario(s) timed out. "
            "Their partial traces were graded; the reported compliance is not a completed run.",
        ]
    report = report.replace("\n\n", "\n\n" + "\n".join(conditions) + "\n\n", 1)
    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text(report, encoding="utf-8")
    logger.info("       Report saved to %s", output_path)

    # Summary
    if not graded_results:
        logger.warning("No scenarios were executed.")
        return
    overall = sum(r.compliance_rate for _, r, _obs in graded_results) / len(graded_results)
    logger.info("\n%s", "=" * 50)
    label = "Partial-trace Compliance (incomplete)" if timed_out_levels else "Overall Compliance"
    logger.info("%s: %.0f%%", label, overall * 100)
    if overall < spec.threshold_promote_to_hook:
        logger.info(
            "Recommendation: Some steps have low compliance. "
            "Consider promoting them to hooks. See the report for details."
        )


if __name__ == "__main__":
    main()
