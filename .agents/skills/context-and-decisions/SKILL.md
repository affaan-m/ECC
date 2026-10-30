---
name: context-and-decisions
description: >-
  Govern stable domain context with a narrowly scoped CONTEXT.md when needed, and route hard-to-reverse decisions to ECC's existing architecture-decision-records skill. Use when domain terms require repeated explanation, one term has multiple meanings, unclear language causes module-boundary mistakes, or domain semantics must remain separate from architecture decisions.
---

# Domain Context and Decision Handoff

Govern “what these business terms mean” separately from “why this option was chosen.” Do not create an empty shell when no stable content exists.

## Domain Context Artifact: Domain Language Only

When terms require repeated explanation, one term has multiple meanings, or unclear language causes module-boundary errors, first reuse the repository's existing glossary/domain-model document or the `context` role in `.governance/docs-map.json`. If an existing context map identifies separate business contexts, follow its links to the relevant glossary; ask when the topic's owner is unclear. Different contexts may legitimately use the same word differently. Do not create a glossary for every directory or impose one meaning across unrelated contexts. Only when no equivalent exists and a term has been resolved should you propose the default `CONTEXT.md` from `templates/context.example.md`. Obtain the user's explicit approval to create that new artifact before writing it, and stay within the authorized documentation scope. General permission to update documentation does not itself approve a new artifact; editing an existing mapped glossary within the authorized scope does not require a new-artifact approval.

Record only:

- domain terms and precise definitions;
- relationships among core concepts;
- confirmed ambiguities and the chosen interpretation;
- ambiguities still awaiting confirmation from a domain owner.

Do not include implementation details, current state, task schedules, full requirements, decision rationale, or history. Keep those in code/MAP, STATUS/Issue Tracker, Spec, ADR, and LOG respectively. Terms must be traceable to code, contracts, or business evidence. Mark unconfirmed items as `needs confirmation`; do not guess.

## Refine Language During the Conversation

This is an active modeling workflow, not a requirement to rewrite the glossary whenever another skill reads it.

- **Challenge contradictions.** Compare the user's wording with the glossary. If “cancellation” already means cancelling an entire order but the request permits cancelling one line, explain that distinction and ask which meaning is intended; do not silently redefine the term.
- **Separate overloaded concepts.** For “account,” establish whether the speaker means the customer organization, a person's login, or a billing relationship. Propose a precise term for each distinct concept. Record rejected synonyms only where they really denote the same concept in this context.
- **Probe relationships with concrete scenarios.** Ask, for example, whether one customer can have multiple logins, or what happens to an invoice when only part of an order is cancelled. Scenarios expose boundaries; they are questions, not invented business rules.
- **Check claims against evidence.** Inspect relevant code, tests, contracts, and existing records. If the implementation cancels only whole orders, surface the mismatch with the proposed partial-cancellation rule. Code demonstrates current behavior, not the business owner's desired behavior; do not decide which is correct by yourself.
- **Capture confirmed terms as they settle.** Within an authorized documentation edit, update the existing glossary at that point instead of deferring all definitions until closeout. Keep definitions to one or two sentences, with a source and context-specific avoided synonyms where useful. Do not rewrite code, contracts, or accepted decisions merely to match a proposed term. In discussion-only or read-only work, present the proposed wording without writing files.

Use the project's existing glossary format. For a new document, the [context template](templates/context.example.md) provides a compact starting point; omit sections without real content. Include business-specific concepts, not generic programming vocabulary such as timeouts or utility functions.

## ADR Handoff: Reuse the Existing Capability

This skill does not define a second ADR directory, numbering scheme, lifecycle, or template. When a decision is hard to reverse, would confuse a future reader without context, and involves a real tradeoff:

1. Read and execute `architecture-decision-records`, preserving the repository's existing ADR location, format, and explicit approval gates for initialization and writing.
2. If no convention exists, let that skill choose the minimum viable location; do not create a separate system here.
3. Link to the ADR from `CONTEXT.md`, the project map, or the relevant Spec/Issue instead of copying the decision body.
4. When a decision is accepted, superseded, or deprecated, append an event to project history according to the living-document rules.

Routine implementation details, easily reversible changes, and short-lived experiments do not need ADRs.

## When to Activate

- Domain terms are repeatedly re-explained or ambiguous language causes implementation drift.
- The project needs a stable domain-language entry point but has no equivalent document.
- Context work uncovers a durable decision that should be handed to `architecture-decision-records`.

Merely consuming established vocabulary during an ordinary bug fix does not require a modeling session or new documentation.

## When to Use

Use this skill when stable domain language needs one evidence-backed home, or when context work reveals a hard-to-reverse decision that belongs in the repository's existing ADR system.

## How It Works

1. Reuse the mapped context or glossary artifact when one exists; create `CONTEXT.md` only when no equivalent source of truth is available and the user has explicitly approved creating that new artifact.
2. Challenge conflicting language, probe concrete edge cases, and cross-check claims against code and contracts before recording confirmed definitions and relationships. Keep unresolved interpretations explicit without mixing in implementation or task state.
3. Route durable tradeoffs to `architecture-decision-records` and link the resulting ADR instead of copying its rationale into context documents.
4. Keep schedules, blockers, and execution status in the existing issue tracker.

## Examples

- Define an overloaded business term once and link it to the code or contract that proves its meaning.
- Mark a domain interpretation as `needs confirmation` until a domain owner resolves it.
- Hand off a durable storage or boundary decision to the existing ADR workflow and link it from the context artifact.

## Anti-Patterns

- Copying current tasks, schedules, full requirements, or implementation details into `CONTEXT.md`.
- Creating empty context files or a second ADR system for completeness.
- Treating unconfirmed domain interpretations as facts, or copying ADR bodies into maps and logs.
- Renaming distinct business concepts as synonyms, or forcing separate contexts into one universal glossary.
- Treating a glossary update as permission to change implementation, or treating code as proof of the intended business rule.

## Related Skills

- `architecture-decision-records`: the sole ADR methodology for hard-to-reverse decisions.
- `living-docs-governance`: lifecycle maintenance for the project map, status, and history.
- `docs-governance`: cross-capability routing and closeout order.

## Scheduling and Task Boundary

Keep tasks, status, blockers, and schedules in the project's existing tracker, such as GitHub Issues or Linear, as the single source of truth. Use local `.scratch/` only when no external tracker exists and the project explicitly adopts it. Do not put schedules in `CONTEXT.md`, ADRs, PROJECT_STATUS, or the history index database.

## Attribution

The active terminology-refinement workflow adapts Matt Pocock's MIT-licensed `domain-modeling` skill. See [source and adaptation boundaries](references/source.md). ECC's existing ADR workflow remains the sole decision-record owner.
