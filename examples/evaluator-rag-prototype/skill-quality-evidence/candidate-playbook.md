# Skill Quality Evidence Playbook

Candidate id: `evidence-backed-skill-amendment`

Use this playbook when a PR or follow-up proposes adding, rewriting, or
amending a skill, agent, command, or rule guidance surface.

## Accepted Path

1. Name the changed guidance surface and source file.
2. Retrieve the quality contract from `docs/SKILL-DEVELOPMENT-GUIDE.md`.
3. Compare the proposed change to nearby focused examples under `skills/*/SKILL.md`.
4. Record the evidence source that justifies the change:
   - observed skill-run failure;
   - user feedback;
   - repeated review finding;
   - reference-set gap;
   - failing example or regression test.
5. Keep the scope narrow. One skill should cover one domain, workflow, or
   reusable pattern.
6. Add or update examples only when they can be validated.
7. Run the relevant validation gate:
   - `node scripts/ci/validate-skills.js`
   - `node tests/lib/skill-improvement.test.js`
   - `node tests/lib/skill-evolution.test.js`
   - `npm run catalog:check`
   - language-specific example commands such as `npx tsc --noEmit`,
     `python -m py_compile`, or `go build` when examples are touched.
8. Record validation output, source attribution, and rollback notes in the
   maintainer PR body or handoff.

## Rejected Path

Do not promote a vague skill rewrite because the prose "sounds better" without
observed failure evidence, examples, or a reference set.

Do not merge multi-domain catch-all skills that duplicate focused skills or make
activation less predictable.

Do not copy private operator context, secrets, tokens, personal paths, customer
data, or unpublished release claims into skills.

Do not update package manifests, plugin manifests, catalogs, release notes, or
publication state from the evaluator run.

## Minimum Validation

- `node scripts/ci/validate-skills.js`
- `npm run catalog:check` when catalog/package-visible skill surfaces change
- Focused skill-improvement or skill-evolution regression test when amendment
  behavior changes
- Language-specific compile/lint checks for touched examples
- `git diff --check`
- Markdown lint when docs or playbooks are touched

Preserve source attribution for contributed skill material and include rollback
guidance for the future maintainer PR.
