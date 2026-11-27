# AgentShield Policy Exception Playbook

Candidate id: `sarif-backed-timeboxed-exception-review`

Use this playbook when AgentShield organization-policy output produces a
finding that may need remediation, a time-boxed exception, or explicit
enforcement.

## Accepted Path

1. Identify the AgentShield finding id, category, severity, affected file or
   MCP/hook surface, and policy pack or organization baseline.
2. Retrieve scanner evidence before judgment:
   - SARIF/code-scanning result, especially `agentshield-policy/*`
   - JSON/HTML report evidence
   - terminal or GitHub Action job-summary counts
3. Record lifecycle fields for any exception request: owner, ticket, scope,
   expiry, rationale, and whether it is active, expiring soon, or expired.
4. Keep expired exceptions rejected or enforced until new evidence exists.
5. Decide whether immediate remediation is possible. If not, only promote a
   narrow time-boxed exception tied to the named owner, ticket, scope, and
   expiry.
6. Keep AgentShield code, policy packs, enforcement settings, release state,
   and live security posture out of the read-only evaluator run.

## Rejected Path

Do not blanket suppress a policy category, policy pack, or organization gate
because a finding is inconvenient.

Do not downgrade critical/high findings without SARIF or report evidence and a
current owner, ticket, scope, and expiry.

Do not treat expired exceptions as active. Expired means the policy gate should
remain enforced until a maintainer creates a fresh, bounded exception or fixes
the underlying issue.

## Minimum Validation

- `npx ecc-agentshield scan --format json`
- AgentShield SARIF/code-scanning artifact or report evidence
- `npx ecc-agentshield scan --format html` when executive review evidence is
  needed
- Current exception lifecycle fields: owner, ticket, scope, expiry, status
- `node tests/docs/evaluator-rag-prototype.test.js`
- `git diff --check`

Record the scanner evidence, lifecycle state, policy-pack source, and
remediation-versus-exception decision in the maintainer PR body or handoff.
