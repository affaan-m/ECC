---
name: incident-response
description: Corporate incident response playbook. Covers alert ingestion, triage, diagnosis, mitigation, stakeholder communication, and postmortem generation. Works with Datadog, PagerDuty, CloudWatch, Prometheus, Grafana, Slack, and PagerTree.
metadata:
  origin: ECC
---

# Incident Response

Use this skill when a production alert fires, a system degrades, or a user reports an outage. The goal is fast, structured, blameless resolution.

## When to Use

- A Datadog, PagerDuty, CloudWatch, or Prometheus alert arrives
- Users report errors, slowness, or complete unavailability
- A deploy causes unexpected production behavior
- You need to generate a postmortem after resolution
- You want to set up automated alert-to-action pipelines

## Architecture Overview

```
Alert Source                  ECC Incident Pipeline               Output
─────────────                 ─────────────────────               ──────
Datadog / PagerDuty  ──┐
CloudWatch           ──┤──▶ /incident alert  ──▶ incident-responder  ──▶ Diagnosis
Prometheus           ──┤         agent                                   Fix PR
Grafana webhook      ──┤                                                 Slack update
Custom webhook       ──┘                                                 Postmortem
```

## How It Works

### 1. Alert Ingestion
Alerts arrive via webhook (Slack, PagerDuty, or direct). The `/incident alert` command parses the payload and routes to the `incident-responder` agent.

### 2. Triage
Agent classifies severity (SEV1–SEV4), identifies the affected service, and checks the blast radius within 2 minutes.

### 3. Root Cause Diagnosis
Agent checks:
- Recent git commits and deploys
- Logs and error patterns
- Infrastructure metrics (CPU, memory, connections)
- External dependency status

### 4. Mitigation
Agent proposes one of:
- Code rollback (git revert + PR)
- Config change
- Horizontal scale
- Circuit breaker enable
- Feature flag disable

### 5. Communication
Agent drafts:
- Internal Slack incident update
- Customer-facing status page message
- On-call escalation if SEV1

### 6. Postmortem
After resolution, `/incident postmortem` generates a blameless report with timeline, root cause, and action items.

## Integration Setup

### PagerDuty Webhook
Configure PagerDuty to POST to your MCP endpoint or Claude Code hook:
```json
{
  "source": "pagerduty",
  "alert_key": "svc-payments-p1",
  "severity": "critical",
  "service": "payments-api",
  "summary": "Error rate >5% on /api/checkout",
  "timestamp": "2026-06-24T10:00:00Z"
}
```

### Datadog Monitor Webhook
```json
{
  "source": "datadog",
  "alert_title": "High error rate on payments-api",
  "alert_type": "error",
  "alert_metric": "trace.web.request.errors",
  "alert_threshold": "5%",
  "tags": ["service:payments-api", "env:production"]
}
```

### Slack Incoming Webhook (for notifications out)
Set `SLACK_WEBHOOK_URL` in your environment. The agent will POST incident updates automatically.

### GitHub Integration
Set `GITHUB_TOKEN` to allow the agent to:
- Read recent commits and PRs
- Create rollback PRs automatically
- Tag incident-related issues

## Runbooks Built-in

The agent has embedded runbooks for:

| Scenario | Runbook |
|----------|---------|
| High error rate | Check recent deploy → rollback if correlated |
| Memory spike | Identify leak → restart pods → profile |
| DB slow queries | Kill long queries → add index → scale read replicas |
| Auth failures | Check token expiry → rotate secrets → verify JWKS |
| Latency spike | Trace hot path → check downstream → enable cache |
| Disk full | Identify large files → rotate logs → expand volume |
| SSL cert expiry | Renew cert → deploy → verify |
| Rate limited by upstream | Enable circuit breaker → notify upstream |

## Escalation Matrix

```
SEV1 → Page on-call lead + VP Engineering (immediate)
SEV2 → Page on-call engineer (15 min SLA)
SEV3 → Slack #incidents channel (1 hour SLA)
SEV4 → Create ticket, next business day
```

## Environment Variables

| Variable | Purpose |
|----------|---------|
| `SLACK_WEBHOOK_URL` | Post incident updates to Slack |
| `PAGERDUTY_API_KEY` | Acknowledge/resolve PD alerts |
| `DATADOG_API_KEY` | Query metrics and logs |
| `GITHUB_TOKEN` | Read commits, create rollback PRs |
| `ONCALL_EMAIL` | Escalation email for SEV1 |
| `STATUS_PAGE_API_KEY` | Update public status page |

## Examples

### Trigger an incident response
```
/incident alert source=datadog service=payments-api severity=critical "Error rate 8% on /checkout"
```

### Generate postmortem
```
/incident postmortem "Payments API outage" duration="45 minutes" sev=2
```

### Run a fire drill
```
/incident drill scenario=db-failover
```

## Corporate Compliance Notes

- All incident actions are logged with timestamps for audit trails
- No credentials or PII are included in Slack notifications
- Postmortems are blameless — no individual names in root cause
- All auto-generated PRs require human approval before merge
- SEV1 incidents always require human commander alongside agent
