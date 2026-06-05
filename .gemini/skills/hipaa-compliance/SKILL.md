---
name: hipaa-compliance
description: HIPAA-specific entrypoint for healthcare privacy and security work. Use when a task is explicitly framed around HIPAA, PHI handling, covered entities, BAAs, breach posture, or US healthcare compliance requirements.
origin: ECC direct-port adaptation
version: "1.0.0"
---

# HIPAA Compliance

Use this as the HIPAA-specific entrypoint when a task is clearly about US healthcare compliance. This skill intentionally stays thin and canonical:

- `healthcare-phi-compliance` remains the primary implementation skill for PHI/PII handling, data classification, audit logging, encryption, and leak prevention.
- `healthcare-reviewer` remains the specialized reviewer when code, architecture, or product behavior needs a healthcare-aware second pass.
- `security-review` still applies for general auth, input-handling, secrets, API, and deployment hardening.

## When to Use

- The request explicitly mentions HIPAA, PHI, covered entities, business associates, or BAAs
- Building or reviewing US healthcare software that stores, processes, exports, or transmits PHI
- Assessing whether logging, analytics, LLM prompts, storage, or support workflows create HIPAA exposure
- Designing patient-facing or clinician-facing systems where minimum necessary access and auditability matter

## How It Works

Treat HIPAA as an overlay on top of the broader healthcare privacy skill:

1. Start with `healthcare-phi-compliance` for the concrete implementation rules.
2. Apply HIPAA-specific decision gates:
   - Is this data PHI?
   - Is this actor a covered entity or business associate?
   - Does a vendor or model provider require a BAA before touching the data?
   - Is access limited to the minimum necessary scope?
   - Are read/write/export events auditable?
3. Escalate to `healthcare-reviewer` if the task affects patient safety, clinical workflows, or regulated production architecture.

## HIPAA-Specific Guardrails

- Never place PHI in logs, analytics events, crash reports, prompts, or client-visible error strings.
- Never expose PHI in URLs, browser storage, screenshots, or copied example payloads.
- Require authenticated access, scoped authorization, and audit trails for PHI reads and writes.
- Treat third-party SaaS, observability, support tooling, and LLM providers as blocked-by-default until BAA status and data boundaries are clear.
- Follow minimum necessary access: the right user should only see the smallest PHI slice needed for the task.
- Prefer opaque internal IDs over names, MRNs, phone numbers, addresses, or other identifiers.

## Examples

### Example 1: Product request framed as HIPAA

User request:

> Add AI-generated visit summaries to our clinician dashboard. We serve US clinics and need to stay HIPAA compliant.

Response pattern:

- Activate `hipaa-compliance`
- Use `healthcare-phi-compliance` to review PHI movement, logging, storage, and prompt boundaries
- Verify whether the summarization provider is covered by a BAA before any PHI is sent
- Escalate to `healthcare-reviewer` if the summaries influence clinical decisions

### Example 2: Vendor/tooling decision

User request:

> Can we send support transcripts and patient messages into our analytics stack?

Response pattern:

- Assume those messages may contain PHI
- Block the design unless the analytics vendor is approved for HIPAA-bound workloads and the data path is minimized
- Require redaction or a non-PHI event model when possible

## Related Skills

- `healthcare-phi-compliance`
- `healthcare-reviewer`
- `healthcare-emr-patterns`
- `healthcare-eval-harness`
- `security-review`
