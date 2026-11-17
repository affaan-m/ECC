---
name: agentic-engineering
description: Operate as an agentic engineer using eval-first execution, decomposition, and cost-aware model routing. Use when planning or executing engineering work that agents will carry out end to end.
metadata:
  origin: ECC
---

# Agentic Engineering

Use this skill for engineering workflows where AI agents perform most implementation work and humans enforce quality and risk controls.

## Operating Principles

1. Define completion criteria before execution.
2. Decompose work into agent-sized units.
3. Route model tiers by task complexity.
4. Measure with evals and regression checks.

## Eval-First Loop

1. Define capability eval and regression eval.
2. Run baseline and capture failure signatures.
3. Execute implementation.
4. Re-run evals and compare deltas.

## Task Decomposition

Apply the 15-minute unit rule:
- each unit should be independently verifiable
- each unit should have a single dominant risk
- each unit should expose a clear done condition

## Model Routing

- Haiku: classification, boilerplate transforms, narrow edits
- Sonnet: implementation and refactors
- Opus: architecture, root-cause analysis, multi-file invariants

## Session Strategy

- Continue session for closely-coupled units.
- Start fresh session after major phase transitions.
- Compact after milestone completion, not during active debugging.

## Review Focus for AI-Generated Code

Prioritize:
- invariants and edge cases
- error boundaries
- security and auth assumptions
- hidden coupling and rollout risk

Do not waste review cycles on style-only disagreements when automated format/lint already enforce style.

## Interpret Tool Results Before Comparing Data

For document reads and processing loops, check three boundaries in order:

1. Check the tool/transport envelope for an error or an indeterminate outcome.
2. Decode the response and check operation status using that tool's documented
   contract. An outer success flag or a present payload does not establish that
   the requested operation succeeded. Status may live in structured content,
   decoded text, or another documented field; `result.ok` is not a universal MCP
   field. Missing or unrecognized status stays unknown.
3. Only after confirmed operation success, validate the document shape and compare
   its fields. An operation failure is not a document identity mismatch.

Keep the operation name, request/correlation ID when available, relevant status
and error details, and the original response needed for diagnosis. Redact secrets
and private document data before logging or sharing. Do not reconstruct missing
responses from a later response's shape.

### Portable Classification Example

The adapter below uses an **illustrative read-tool contract**, not an MCP schema:
`isError` is a required boolean; when false, `result.ok` is a required operation
status. A successful read returns `result.document` with a string `id`; a failed
read may carry `result.error`. Replace this adapter with the actual tool's
contract, including its documented decoding and document validation rules.

```javascript
function decodeRead(response) {
  if (!response || typeof response.isError !== 'boolean') {
    return { kind: 'unknown_response' };
  }
  if (response.isError) return { kind: 'tool_error' };

  const result = response.result;
  if (result?.ok === false) {
    return { kind: 'operation_error', error: result.error };
  }
  if (result?.ok !== true) return { kind: 'unknown_response' };

  const document = result.document;
  if (!document || typeof document.id !== 'string') {
    return { kind: 'invalid_document' };
  }
  return { kind: 'document', document };
}

function inspectRead(response, expectedId, decode = decodeRead) {
  const outcome = decode(response);
  if (outcome.kind !== 'document') return outcome;

  return outcome.document.id === expectedId
    ? { kind: 'match', document: outcome.document }
    : { kind: 'field_mismatch', actualId: outcome.document.id, expectedId };
}
```

Synthetic evaluation cases (not a reproduction of any historical incident):

| Input under this illustrative contract | Expected classification |
| --- | --- |
| `isError: true` | `tool_error`; no field comparison |
| `isError: false`, `result.ok: false`, maintenance error, no document | `operation_error`; preserve maintenance details, no mismatch |
| `isError: false`, missing operation status | `unknown_response`; no field comparison |
| Confirmed success, missing document or non-string ID | `invalid_document`; no field comparison |
| Confirmed success, valid document with expected ID | `match` |
| Confirmed success, valid document with a different ID | `field_mismatch` |

Classification does not authorize a write or retry. Temporary maintenance remains
an operation failure with its own evidence; follow the tool's documented recovery
policy. A documented service-wide maintenance failure should stop a batch rather
than trigger the same request for every row; a lone authorization error does not
establish service-wide maintenance. If a write times out or its outcome is unknown,
preserve that uncertainty
and reconcile using a documented status/read-back mechanism before considering a
retry. Never infer that a write failed, repeat it, or overwrite a document solely
because a read failed or a returned field differs.

## Cost Discipline

Track per task:
- model
- token estimate
- retries
- wall-clock time
- success/failure

Escalate model tier only when lower tier fails with a clear reasoning gap.
