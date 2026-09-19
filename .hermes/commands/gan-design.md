---
description: Run a generator/evaluator design loop for frontend or visual work with bounded iterations and scoring.
---

Parse the following from $ARGUMENTS:
1. `brief` — the user's description of the design to create
2. `--max-iterations N` — (optional, default 10) maximum design-evaluate cycles
3. `--pass-threshold N` — (optional, default 7.5) weighted score to pass (higher default for design)

## GAN-Style Design Harness

A two-agent loop (Generator + Evaluator) focused on frontend design quality. No planner — the brief IS the spec.

This is the same mode Anthropic used for their frontend design experiments, where they saw creative breakthroughs like the 3D Dutch art museum with CSS perspective and doorway navigation.

### Setup
1. Create `gan-harness/` directory
2. Write the brief directly as `gan-harness/spec.md`
3. Write a design-focused `gan-harness/eval-rubric.md` with extra weight on Design Quality and Originality

### Design-Specific Eval Rubric
```markdown
### Design Quality (weight: 0.35)
### Originality (weight: 0.30)
### Craft (weight: 0.25)
### Functionality (weight: 0.10)
```

Note: Originality weight is higher (0.30 vs 0.20) to push for creative breakthroughs. Functionality weight is lower since design mode focuses on visual quality.

### Loop
Same as `/project:gan-build` Phase 2, but:
- Skip the planner
- Use the design-focused rubric
- Generator prompt emphasizes visual quality over feature completeness
- Evaluator prompt emphasizes "would this win a design award?" over "do all features work?"

### Key Difference from gan-build
The Generator is told: "Your PRIMARY goal is visual excellence. A stunning half-finished app beats a functional ugly one. Push for creative leaps — unusual layouts, custom animations, distinctive color work."
