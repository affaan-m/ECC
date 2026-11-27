# Skill Adaptation Policy

ECC accepts ideas from outside repos, but shipped skills need to become ECC-native surfaces.

## Default Rule

When a contribution starts from another open-source repo, prompt pack, plugin, harness, or personal config:

- copy the underlying idea, workflow, or structure
- adapt it to ECC's current install surfaces, validation flow, and repo conventions
- remove unnecessary external branding, dependency assumptions, and upstream-specific framing

The goal is reuse without turning ECC into a thin wrapper around someone else's runtime.

## When To Keep The Original Name

Keep the original skill name only when all of the following are true:

- the contribution is close to a direct port
- the name is already descriptive and neutral
- the surface still behaves like the upstream concept
- there is no better ECC-native name already in the repo

Examples:

- framework names like `nestjs-patterns`
- protocol or product names that are the subject matter, not the vendor pitch

## When To Rename

Rename the skill when ECC meaningfully expands, narrows, or repackages the original work.

Typical triggers:

- ECC adds substantial new behavior, structure, or guidance
- the original name is vendor-forward or community-brand-forward instead of workflow-forward
- the contribution overlaps an existing ECC surface and needs a clearer boundary
- the contribution now fits as a capability, operator workflow, or policy layer rather than a literal port

Examples:

- keep a reusable graph primitive as `social-graph-ranker`, but make broader workflow layers `lead-intelligence` or `connections-optimizer`
- prefer ECC-native names like `product-capability` over vague imported planning labels if the scope changed materially

## Dependency Policy

ECC prefers the narrowest native surface that gets the job done:

- `rules/` for deterministic constraints
- `skills/` for on-demand workflows
- MCP when a long-lived interactive tool boundary is justified
- local scripts/CLI for deterministic one-shot execution
- direct APIs when the remote call is narrow and does not justify MCP

Avoid shipping a skill that exists mainly to tell users to install or trust an unvetted third-party package.

If external functionality is worth keeping:

- vendor or recreate the relevant logic inside ECC when practical
- or keep the integration optional and clearly marked as external
- never let a new external dependency become the default path without explicit justification

## Review Questions

Before merging a contributed skill, answer these:

1. Is this a real reusable surface in ECC, or just documentation for another tool?
2. Does the current name still match the ECC-shaped surface?
3. Is there already an ECC skill that owns most of this behavior?
4. Are we importing a concept, or importing someone else's product identity?
5. Would an ECC user understand the purpose of this skill without knowing the upstream repo?

If those answers are weak, adapt more, narrow the scope, or do not ship it.
