# Prepared Verifier and Effect State Playbook

Candidate id: `correct-read-preserve-effect`

This synthetic, read-only example records expected rubric decisions. It does not
execute commands, contact devices or reproduce the
[reported incidents](https://github.com/affaan-m/ECC/issues/3699).

## Worked State Comparison

| Operation | Effect state | Check state | Expected next action |
| --- | --- | --- | --- |
| OP_A | Accepted, receipt A, one apply | Verifier error: missing PID column | Correct only the read; retain accepted identity and receipt |
| OP_B | Unknown, no retained response | Outcome not established | Targeted reconciliation; no automatic resend |
| OP_C | Not dispatched | Syntax preflight failed | Fix and recheck the prepared command before dependent action |

The Docker-shaped fixture asks for `pid` and `comm` but prepares only `comm`.
Its corrected read requests both columns. Neither command runs here. A corrected
argv is not yet a successful verification result. Keep `effect=accepted` and
`verification=verifier_error` until actual readback evidence changes the latter.
Do not repeat load/recreate or initiate rollback merely to make a verifier green.

## Distinct Contract Controls

- The YAML example concerns a rollback condition parsed as a mapping instead of
  the required scalar. Catch it before dispatch; do not infer a remote effect.
- Zabbix examples concern method/version-specific writable fields and required
  update fields. Inspect the selected method's contract and inverse; do not copy
  a read response wholesale or silently strip fields to obtain acceptance.
  The reported timeout without a retained response remains unknown.
- RouterOS examples concern command boundaries and a separate textual comparison
  of hexadecimal identifier case. Follow the documented representation contract;
  do not normalize arbitrary opaque IDs or remove target/name/type/size and
  uniqueness checks. The later file-move refusal remains a separate unresolved
  symptom, not proof that a corrected comparison fixed the mutation.

These mechanisms have separate source accounts. The reporter did not replay
original commands or inspect original bytes, logs or current device state.
Corrections and progress remain source-reported. Exact ECC activation, version
and causal contribution are unknown; no common technical root cause is asserted.

## Repository Validation

Run `node tests/docs/evaluator-rag-prototype.test.js`, Markdown lint on touched
docs, and `git diff --check`. They check repository documentation and do not
establish live Docker, Zabbix or RouterOS behavior. This example adds no harness,
journal service or global approval ritual.
