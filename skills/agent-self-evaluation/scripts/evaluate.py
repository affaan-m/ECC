#!/usr/bin/env python3
"""Standalone agent output evaluator using the 5-axis rubric.

Reads a task description and agent output from stdin or files,
scores each axis, and prints a structured evaluation report.

Usage:
    # Pipe output directly
    echo "Task: Add retry logic" | evaluate.py --output response.txt

    # From files
    evaluate.py --task task.txt --output response.txt

    # Interactive (reads task from prompt, output from stdin)
    evaluate.py --interactive

The evaluator uses keyword heuristics + structural checks as a first pass.
For production use, pair with an LLM judge for semantic understanding.
"""

import argparse
import re
import sys
from dataclasses import dataclass, field
from typing import Optional

# Tunable thresholds for evaluation heuristics
WALL_OF_TEXT_WORDS = 200
SUMMARY_CHECK_WORDS = 300
SUMMARY_CHECK_FIRST_N = 100
TASK_OUTPUT_RATIO_HIGH = 15
TASK_OUTPUT_RATIO_MEDIUM = 8


@dataclass
class AxisScore:
    name: str
    score: int
    evidence: list[str] = field(default_factory=list)
    improvement: Optional[str] = None


def count_words(text: str) -> int:
    return len(text.split())


def check_accuracy(text: str) -> AxisScore:
    """Check for verifiable claims, tool output references, error signs."""
    evidence = []
    deductions = 0
    score = 5

    # Positive signals: verified claims
    verified_patterns = [
        (r"(?i)(tests?\s+pass|all\s+tests?\s+passing|\d+\s+passed)", "Tests passing"),
        (r"(?i)(exit\s+code\s*[:=]?\s*0|exited\s+with\s+0)", "Clean exit code"),
        (r"(?i)(lint.*clean|no\s+lint\s+errors|0\s+errors)", "Lint clean"),
        (r"(?i)(verified|confirmed|validated)\s+(with|against|using|by)", "Explicit verification"),
        (r"(?i)(grep|rg)\s+.*\b(found|matched|returned)", "Grep confirmed"),
    ]
    for pattern, label in verified_patterns:
        if re.search(pattern, text):
            evidence.append(f"+ {label}")

    # Negative signals: unverified claims
    danger_patterns = [
        (r"(?i)(should\s+work|probably\s+fine|should\s+be\s+ok)", "Hedged claim without verification"),
        (r"(?i)(I\s+think|I\s+believe|I\s+assume|might\s+be)", "Speculation without evidence"),
        (r"(?i)(untested|not\s+tested|haven'?t\s+tested)", "Explicitly untested"),
        (r"(?i)(TODO|FIXME|HACK|WORKAROUND)", "Unresolved TODO/FIXME"),
    ]
    for pattern, label in danger_patterns:
        if re.search(pattern, text):
            deductions += 1
            evidence.append(f"- {label}")

    if deductions >= 3:
        score = 2
    elif deductions == 2:
        score = 3
    elif deductions == 1:
        score = 4

    if not evidence:
        evidence.append("No verification signals detected — score assumes correctness")

    result = AxisScore(name="Accuracy", score=score, evidence=evidence)
    if score < 5:
        result.improvement = "Cite specific tool outputs (test results, exit codes, grep findings) to back claims"
    return result


def check_completeness(text: str) -> AxisScore:
    """Check for requirement coverage, edge cases, error handling."""
    evidence = []
    score = 5

    # Positive signals
    completeness_signals = [
        (r"(?i)(edge\s*cases?|corner\s*cases?)", "Edge cases addressed"),
        (r"(?i)(error\s*handling|exception\s*handling|try/except|try\s*{)", "Error handling present"),
        (r"(?i)(all\s+\w+\s+(methods|endpoints|routes))", "Full coverage claimed"),
        (r"(?i)(verification|verified\s+that|confirmed\s+that)", "Verification step present"),
    ]
    for pattern, label in completeness_signals:
        if re.search(pattern, text):
            evidence.append(f"+ {label}")

    # Gaps
    gap_signals = [
        (r"(?i)(not\s+covered|not\s+handled|out\s+of\s+scope)", "Explicit gap acknowledged"),
        (r"(?i)(only\s+(works|handles|supports)\s+\w+)", "Limited scope noted"),
        (r"(?i)(assume[sd]?\s+that|assuming\s+the)", "Assumption without verification"),
    ]
    deductions = 0
    for pattern, label in gap_signals:
        if re.search(pattern, text):
            deductions += 1
            evidence.append(f"- {label}")

    if deductions >= 2:
        score = 3
    elif deductions == 1:
        score = 4

    if not evidence:
        evidence.append("No completeness signals — unable to assess coverage")

    result = AxisScore(name="Completeness", score=score, evidence=evidence)
    if score < 5:
        result.improvement = "List what was covered AND what was intentionally excluded, with reasoning"
    return result


def _check_jargon(text: str) -> tuple[int, list[str]]:
    """Return clarity deductions for unexplained domain jargon."""
    jargon = [
        (r"\b(idempotent|race condition|deadlock|thundering herd)\b", "concurrency"),
        (r"\b(exponential backoff|circuit breaker|bulkhead)\b", "resilience"),
        (r"\b(ACID|CAP|eventual consistency|linearizability)\b", "database theory"),
    ]
    explanation_pattern = r"(?i)({domain}|means|refers to|i\.e\.|in other words)"
    for pattern, domain in jargon:
        has_term = re.search(pattern, text, re.IGNORECASE)
        explains_term = re.search(explanation_pattern.format(domain=domain), text)
        if has_term and not explains_term:
            return 1, [f"- Domain term used without explanation ({domain})"]
    return 0, []


def _check_summary(text: str) -> tuple[int, list[str]]:
    """Return clarity deduction when long output lacks an early summary."""
    summary_terms = ["summary", "tldr", "overview", "in short"]
    has_early_summary = any(term in ' '.join(text.split()[:SUMMARY_CHECK_FIRST_N]).lower() for term in summary_terms)
    if not has_early_summary and count_words(text) > SUMMARY_CHECK_WORDS:
        return 1, ["- No summary/TLDR in first 100 words (text is 300+ words)"]
    return 0, []


def check_clarity(text: str) -> AxisScore:
    """Check for structure, readability, jargon handling."""
    evidence = []
    deductions = 0

    if re.search(r"^#{1,3}\s+", text, re.MULTILINE):
        evidence.append("+ Uses headings for structure")
    if re.search(r"```", text):
        evidence.append("+ Uses code blocks")
    if re.search(r"^\s*[-*]\s+", text, re.MULTILINE):
        evidence.append("+ Uses bullet points")

    for paragraph in [p for p in text.split("\n\n") if p.strip()]:
        if count_words(paragraph) > WALL_OF_TEXT_WORDS:
            deductions += 1
            evidence.append("- Wall-of-text paragraph (>200 words without break)")
            break

    jargon_deductions, jargon_evidence = _check_jargon(text)
    summary_deductions, summary_evidence = _check_summary(text)
    deductions += jargon_deductions + summary_deductions
    evidence.extend(jargon_evidence + summary_evidence)

    if deductions >= 3:
        score = 2
    elif deductions == 2:
        score = 3
    elif deductions == 1:
        score = 4
    else:
        score = 5

    if not evidence:
        evidence.append("+ Well-structured with no clarity issues detected")

    result = AxisScore(name="Clarity", score=score, evidence=evidence)
    if score < 5:
        result.improvement = "Add headings, break long paragraphs, define domain terms on first use"
    return result


def check_actionability(text: str) -> AxisScore:
    """Check if the user can act on the output immediately."""
    evidence = []
    score = 5
    deductions = 0

    # Positive signals
    actionable_signals = [
        (r"(?i)(merge|PR|pull request).*?(created|ready|open)", "PR created"),
        (r"(?i)(run|execute)\s+[`\"']?[\w./-]+", "Specific run command given"),
        (r"(?i)(next\s+steps?|follow[- ]up|what\s+to\s+do)", "Next steps provided"),
        (r"(?i)(file\s+(created|written|modified|updated)\s+at)", "File path specified"),
    ]
    for pattern, label in actionable_signals:
        if re.search(pattern, text):
            evidence.append(f"+ {label}")

    # Negative signals
    vague_signals = [
        (r"(?i)(you\s+(should|could|might\s+want\s+to))\s+\w+", "Vague suggestion without specifics"),
        (r"(?i)(consider|maybe|perhaps)\s+\w+ing", "Non-committal suggestion"),
        (r"(?i)(figure\s+out|look\s+into|investigate)\s", "Defers work to user"),
    ]
    for pattern, label in vague_signals:
        if re.search(pattern, text):
            deductions += 1
            evidence.append(f"- {label}")

    if deductions >= 3:
        score = 2
    elif deductions == 2:
        score = 3
    elif deductions == 1:
        score = 4

    if not evidence:
        evidence.append("No actionability signals — user may need to ask 'what now?'")

    result = AxisScore(name="Actionability", score=score, evidence=evidence)
    if score < 5:
        result.improvement = "End with a single clear action: 'Merge this PR', 'Run ./deploy.sh', or 'Review the 3 changed files'"
    return result


def check_conciseness(text: str, task: Optional[str] = None) -> AxisScore:
    """Check for redundancy, filler, information density."""
    evidence = []
    score = 5
    wc = count_words(text)

    # Heuristic: task-to-output ratio
    if task:
        task_wc = count_words(task)
        ratio = wc / max(task_wc, 1)
        if ratio > TASK_OUTPUT_RATIO_HIGH:
            evidence.append(f"- Output is {ratio:.0f}x longer than task description (high ratio)")
            score = min(score, 3)
        elif ratio > TASK_OUTPUT_RATIO_MEDIUM:
            evidence.append(f"- Output is {ratio:.0f}x longer than task description")
            score = min(score, 4)

    # Redundancy signals
    redundancy_checks = [
        (r"(?i)(as\s+(I|we)\s+(mentioned|said|noted|discussed)\s+(earlier|above|before))",
         "Refers back to earlier statement (possible repetition)"),
        (r"(?i)(to\s+summarize|in\s+summary|in\s+conclusion|to\s+conclude)",
         "Has explicit summary (good if needed, flag if redundant)"),
        (r"(?i)(let\s+me\s+(explain|break\s+this\s+down|walk\s+you\s+through))",
         "Meta-commentary adds words without information"),
    ]
    redundant_count = 0
    for pattern, label in redundancy_checks:
        matches = re.findall(pattern, text)
        if len(matches) > 2:
            redundant_count += 1
            evidence.append(f"- '{label}' appears {len(matches)} times")

    if redundant_count >= 2:
        score = min(score, 3)
    elif redundant_count == 1:
        score = min(score, 4)

    if not evidence and score == 5:
        evidence.append("+ No redundancy detected. Information density appears good.")

    result = AxisScore(name="Conciseness", score=score, evidence=evidence)
    if score < 5:
        result.improvement = "Cut meta-commentary, remove repeated points, trim examples to one representative case"
    return result


def evaluate(task: Optional[str], output: str) -> list[AxisScore]:
    """Run all 5 axis checks and return scored results."""
    return [
        check_accuracy(output),
        check_completeness(output),
        check_clarity(output),
        check_actionability(output),
        check_conciseness(output, task),
    ]


def format_report(scores: list[AxisScore]) -> str:
    """Format scores into a readable evaluation report."""
    avg = sum(s.score for s in scores) / len(scores)
    lines = []
    lines.append("=" * 60)
    lines.append("AGENT SELF-EVALUATION REPORT")
    lines.append("=" * 60)
    lines.append(f"Summary: Overall score {avg:.1f}/5 across 5 quality axes.")
    lines.append("")

    for s in scores:
        bar = "█" * s.score + "░" * (5 - s.score)
        lines.append(f"  {s.name:<15} {bar} {s.score}/5")
        lines.extend(f"    {e}" for e in s.evidence)
        if s.improvement:
            lines.append(f"    → {s.improvement}")
        lines.append("")

    lines.append(f"  {'OVERALL':<15} {avg:.1f}/5")
    lines.append("")

    # Critical issues (axes ≤ 2)
    critical = [(s, s.improvement or "No improvement suggested") for s in scores if s.score <= 2]
    lines.append("CRITICAL ISSUES (axes ≤ 2):")
    if critical:
        for s, imp in critical:
            lines.append(f"  [{s.name}] Score {s.score}/5 — {imp}")
    else:
        lines.append("  None")

    lines.append("")
    lines.append("Self-check: Would the user agree with this assessment? [Yes/No + brief justification]")
    lines.append("")

    # Top improvements (axes scoring < 4, ranked by impact)
    improvements = [(s, s.improvement) for s in scores if s.improvement and s.score < 4]
    lines.append("TOP IMPROVEMENTS:")
    if improvements:
        for i, (s, imp) in enumerate(sorted(improvements, key=lambda x: x[0].score), 1):
            lines.append(f"  {i}. [{s.name}] {imp}")
    else:
        lines.append("  No axes below 4. Strong output across all dimensions.")

    lines.append("")

    # Verdict
    min_score = min(s.score for s in scores)
    if min_score <= 2:
        verdict = f"Redo with specific fixes. Weakest axis: {min(scores, key=lambda s: s.score).name} ({min_score}/5)."
    elif any(s.score <= 3 for s in scores):
        weak = [s.name for s in scores if s.score <= 3]
        verdict = f"Fix {'/'.join(weak)} issues, then deliver."
    elif avg >= 4.5:
        verdict = "Deliver as-is. No changes needed."
    else:
        verdict = "Deliver as-is. Minor improvements noted above."
    lines.append(f"VERDICT: {verdict}")

    return "\n".join(lines)


def _read_file_or_text(path: Optional[str], *, required: bool = False) -> Optional[str]:
    """Read a file path or return inline text when allowed."""
    if path is None:
        return None
    try:
        with open(path) as f:
            return f.read()
    except FileNotFoundError:
        if required:
            print(f"Error: output file '{path}' not found", file=sys.stderr)
            sys.exit(1)
        return path


def _read_input(args: argparse.Namespace) -> tuple[Optional[str], str]:
    """Read task and output for interactive, file, or pipe mode."""
    if args.interactive:
        task = input("Task description: ").strip()
        print("Paste agent output (Ctrl+D to finish):")
        return task, sys.stdin.read()
    if args.output:
        return _read_file_or_text(args.task), _read_file_or_text(args.output, required=True) or ""
    return _read_file_or_text(args.task), sys.stdin.read()


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Evaluate agent output against the 5-axis rubric"
    )
    parser.add_argument("--task", help="Task description (file path or inline text)")
    parser.add_argument("--output", help="Agent output to evaluate (file path)")
    parser.add_argument("--interactive", action="store_true", help="Prompt for task and read output from stdin")
    args = parser.parse_args()

    task, output = _read_input(args)
    if not output:
        print("Error: no output to evaluate", file=sys.stderr)
        sys.exit(1)

    scores = evaluate(task, output)
    print(format_report(scores))


if __name__ == "__main__":
    main()
