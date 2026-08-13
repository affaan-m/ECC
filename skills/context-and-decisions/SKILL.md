---
name: context-and-decisions
description: >-
  Govern stable domain context with a narrowly scoped CONTEXT.md when needed, and route hard-to-reverse decisions to ECC's existing architecture-decision-records skill. Use when domain terms require repeated explanation, one term has multiple meanings, unclear language causes module-boundary mistakes, or domain semantics must remain separate from architecture decisions.
---

# Domain Context and Decision Handoff

Govern “what these business terms mean” separately from “why this option was chosen.” Do not create an empty shell when no stable content exists.

## Domain Context Artifact: Domain Language Only

When terms require repeated explanation, one term has multiple meanings, or unclear language causes module-boundary errors, first reuse the repository's existing glossary/domain-model document or the `context` role in `.governance/docs-map.json`. Only when no equivalent exists should you lazily create the default `CONTEXT.md` from `templates/context.example.md`.

Record only:

- domain terms and precise definitions;
- relationships among core concepts;
- confirmed ambiguities and the chosen interpretation;
- ambiguities still awaiting confirmation from a domain owner.

Do not include implementation details, current state, task schedules, full requirements, decision rationale, or history. Keep those in code/MAP, STATUS/Issue Tracker, Spec, ADR, and LOG respectively. Terms must be traceable to code, contracts, or business evidence. Mark unconfirmed items as `needs confirmation`; do not guess.

## ADR Handoff: Reuse the Existing Capability

This skill does not define a second ADR directory, numbering scheme, lifecycle, or template. When a decision is hard to reverse, would confuse a future reader without context, and involves a real tradeoff:

1. Read and execute `architecture-decision-records`, preserving the repository's existing ADR location and format.
2. If no convention exists, let that skill choose the minimum viable location; do not create a separate system here.
3. Link to the ADR from `CONTEXT.md`, the project map, or the relevant Spec/Issue instead of copying the decision body.
4. When a decision is accepted, superseded, or deprecated, append an event to project history according to the living-document rules.

Routine implementation details, easily reversible changes, and short-lived experiments do not need ADRs.

## When to Activate

- Domain terms are repeatedly re-explained or ambiguous language causes implementation drift.
- The project needs a stable domain-language entry point but has no equivalent document.
- Context work uncovers a durable decision that should be handed to `architecture-decision-records`.

## Anti-Patterns

- Copying current tasks, schedules, full requirements, or implementation details into `CONTEXT.md`.
- Creating empty context files or a second ADR system for completeness.
- Treating unconfirmed domain interpretations as facts, or copying ADR bodies into maps and logs.

## Related Skills

- `architecture-decision-records`: the sole ADR methodology for hard-to-reverse decisions.
- `living-docs-governance`: lifecycle maintenance for the project map, status, and history.
- `docs-governance`: cross-capability routing and closeout order.

## Scheduling and Task Boundary

Keep tasks, status, blockers, and schedules in the project's existing tracker, such as GitHub Issues or Linear, as the single source of truth. Use local `.scratch/` only when no external tracker exists and the project explicitly adopts it. Do not put schedules in `CONTEXT.md`, ADRs, PROJECT_STATUS, or the history index database.
