# CONTEXT.md — Domain Language

> Create only after the first term is resolved, no equivalent glossary exists, and the user has explicitly approved creating this new artifact within the authorized documentation scope. General documentation-update permission alone is not creation approval. Reuse an existing glossary and its format instead of creating a duplicate; authorized edits to that existing glossary do not need a new-artifact approval. Omit sections without content. Do not include implementation, status, scheduling, or decision rationale.

{One or two sentences identifying the business context this vocabulary describes.}

## Core Terms

| Term | Precise definition | Avoid in this context | Evidence/source |
|---|---|---|---|
| `{canonical term}` | `{one or two sentences defining the concept and distinguishing adjacent concepts}` | `{confirmed synonyms to avoid; not names for distinct concepts}` | `{confirmed business source, contract, or code location}` |

## Concept Relationships

- `{Concept A}` and `{Concept B}`: `{one-to-many / state transition / containment / constraint}`.

## Resolved Ambiguities

- `{old expression}` now consistently means `{adopted interpretation}`; stop using `{deprecated expression}`.

## Needs Confirmation

- `{term or relationship}`: awaiting confirmation from `{owner/domain role}`; do not change the implementation based on it until confirmed.
