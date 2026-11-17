# Sources and Scope

This contribution extends ECC's existing `benchmark-optimization-loop` skill.
It retains the baseline-first search, single-hypothesis variants, per-run ledger,
comparison against the prior accepted winner, noise and budget stops, obvious
rollback, durable promotion record, and reproducible commands.

The extension starts from the user's desired outcome before choosing metrics.
It adds explicit benchmark versions, independent expectations, complete failure
accounting, fixed standards, and a distinction between known replay cases and
independent acceptance. Correctness, quality, completion, reliability, speed,
and cost are possible objectives; thresholds and tradeoffs remain task-specific.

## Inspiration and Confirmation

- [How we made claude.ai 3x faster in two weeks](https://claude.dev/blog/how-we-made-claude-ai-faster/),
  Raymond Wang, Sam Attard, and Issac G., September 23, 2026. The relevant idea is
  to establish measurements tied to user outcomes, guide changes with benchmarks,
  and check whether the improvement holds in actual use.
- [huashu-flash](https://github.com/alchaincyf/huashu-flash), a performance workflow
  linked by the contributor's initial reading. It is background inspiration,
  not a runtime dependency.
- [docs-governance Issue #57](https://github.com/qshanx/docs-governance/issues/57),
  the confirmed requirement and provenance record: define the user's goal,
  establish a benchmark, and let AI iterate against it. Performance and image
  handling are examples rather than mandatory workflow stages.

The added text is an original formulation; it does not reproduce the article or
third-party skill prose. ECC's existing skill name and execution requirements
are preserved rather than adding a duplicate workflow. No external package,
scheduler, production credential, private project path, or user data is required.
The sample tables are illustrative and do not establish measured effectiveness
or cross-domain behavioral validation of the skill.
