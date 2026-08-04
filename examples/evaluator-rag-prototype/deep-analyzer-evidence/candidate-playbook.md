# Deep Analyzer Evidence Playbook

Candidate id: `corpus-backed-analyzer-change`

Use this playbook when a PR changes repository analysis, commit analysis,
architecture classification, workflow detection, pattern detection, or
deep-analysis risk-taxonomy behavior.

## Accepted Path

1. Name the changed analyzer surface and source file.
2. Retrieve the Deep Analyzer Evidence contract from `../ECC-Tools/README.md`
   and the follow-up logic in `../ECC-Tools/src/lib/analyzer.ts`.
3. Match the change to maintained corpus or reference evidence:
   - `../ECC-Tools/src/analyzers/fixtures/deep-analyzer-corpus.ts`
   - `../ECC-Tools/src/analyzers/deep-analyzer-corpus.test.ts`
   - `../ECC-Tools/src/lib/analyzer.compare.test.ts`
4. Compare expected outputs for the affected behavior:
   - folder type;
   - module organization;
   - test location;
   - primary language;
   - commit message type;
   - detected workflow names.
5. Add or update analyzer corpus, expected-output snapshots, fixtures,
   benchmarks, golden cases, evals, or reference sets for the same changed
   surface.
6. Run the relevant validation gate from `../ECC-Tools/`:
   - `npm test -- src/analyzers/deep-analyzer-corpus.test.ts src/lib/analyzer.compare.test.ts`
   - `npm run typecheck`
   - `npm run lint`
7. Record the corpus case, expected-output comparison, validation output, and
   rollback notes in the maintainer PR body or handoff.

## Rejected Path

Do not promote analyzer threshold, classification, or risk-taxonomy changes
without corpus, snapshot, fixture, benchmark, golden, eval, or reference-set
evidence.

Do not suppress the `Deep Analyzer Evidence` PR-risk bucket just because the
change is small. Suppress it only when co-located evidence covers the same
analyzer surface.

Do not rely only on broad manual review notes. Analyzer changes need
representative repository shapes or commit-history cases with expected outputs.

Do not post PR comments, create check runs, sync Linear, publish packages, edit
plugins, or create release artifacts from the evaluator run.

## Minimum Validation

- `npm test -- src/analyzers/deep-analyzer-corpus.test.ts src/lib/analyzer.compare.test.ts`
- `npm run typecheck`
- `npm run lint`
- `git diff --check`
- Markdown lint when docs or playbooks are touched

Preserve source attribution for analyzer evidence and include rollback guidance
for the future maintainer PR.
