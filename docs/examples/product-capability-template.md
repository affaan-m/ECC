# Product Capability Template

Use this when product intent exists but the implementation constraints are still implicit.

The purpose is to create a durable capability contract, not another vague planning doc.

## Capability

- **Capability name:**
- **Source:** PRD / issue / discussion / roadmap / founder note
- **Primary actor:**
- **Outcome after ship:**
- **Success signal:**

## Product Intent

Describe the user-visible promise in one short paragraph.

## Constraints

List the rules that must be true before implementation starts:

- business rules
- scope boundaries
- invariants
- rollout constraints
- migration constraints
- backwards compatibility constraints
- billing / auth / compliance constraints

## Actors and Surfaces

- actor(s)
- UI surfaces
- API surfaces
- automation / operator surfaces
- reporting / dashboard surfaces

## States and Transitions

Describe the lifecycle in terms of explicit states and allowed transitions.

Example:

- `draft -> active -> paused -> completed`
- `pending -> approved -> provisioned -> revoked`

## Interface Contract

- inputs
- outputs
- required side effects
- failure states
- retries / recovery
- idempotency expectations

## Data Implications

- source of truth
- new entities or fields
- ownership boundaries
- retention / deletion expectations

## Security and Policy

- trust boundaries
- permission requirements
- abuse paths
- policy / governance requirements

## Non-Goals

List what this capability explicitly does not own.

## Open Questions

Capture the unresolved decisions blocking implementation.

## Handoff

- **Ready for implementation?**
- **Needs architecture review?**
- **Needs product clarification?**
- **Next ECC lane:** `project-flow-ops` / `tdd-workflow` / `verification-loop` / other
