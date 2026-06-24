---
description: Corporate incident response command. Triage alerts, diagnose root cause, propose fixes, draft comms, and generate postmortems. Usage: /incident <subcommand> [options]
---

# /incident

Corporate incident response pipeline powered by the `incident-responder` agent.

## Subcommands

### `/incident alert`
Triage an incoming alert and begin root cause diagnosis.

```
/incident alert [source=<datadog|pagerduty|cloudwatch|prometheus|manual>] [service=<name>] [severity=<critical|warning|info>] "<alert description>"
```

**Examples:**
```
/incident alert source=datadog service=payments-api severity=critical "Error rate 8% on POST /checkout"
/incident alert source=pagerduty "Database connection pool exhausted on prod-db-01"
/incident alert source=manual service=auth-service "Users unable to log in since 14:30 UTC"
```

**What it does:**
1. Classifies severity (SEV1–SEV4)
2. Identifies affected services and blast radius
3. Checks recent deploys and config changes
4. Proposes immediate mitigation steps
5. Drafts a Slack incident update

---

### `/incident diagnose`
Deep-dive diagnosis on an already-triaged incident.

```
/incident diagnose <service> [--logs] [--metrics] [--traces] [--deploys]
```

**Examples:**
```
/incident diagnose payments-api --logs --deploys
/incident diagnose auth-service --metrics --traces
```

---

### `/incident mitigate`
Apply or propose a specific mitigation action.

```
/incident mitigate <action> [service=<name>]
```

**Actions:**
- `rollback` — Revert to previous deploy
- `restart` — Restart service pods/instances
- `scale` — Horizontal scale up
- `circuit-breaker` — Enable circuit breaker for a dependency
- `feature-flag` — Disable a specific feature flag
- `kill-query` — Kill long-running database queries

**Examples:**
```
/incident mitigate rollback service=payments-api
/incident mitigate circuit-breaker service=inventory-api
```

---

### `/incident update`
Draft a stakeholder communication update.

```
/incident update [--slack] [--email] [--status-page] "<current status>"
```

**Examples:**
```
/incident update --slack "Root cause identified: bad deploy at 14:15. Rollback in progress."
/incident update --status-page "We are aware of issues affecting checkout. ETA: 20 minutes."
```

---

### `/incident resolve`
Mark incident as resolved and begin postmortem collection.

```
/incident resolve [--sev=<1-4>] [--duration=<minutes>]
```

---

### `/incident postmortem`
Generate a blameless postmortem report.

```
/incident postmortem "<incident title>" [--sev=<1-4>] [--duration=<Xm|Xh>] [--output=<md|html>]
```

**Examples:**
```
/incident postmortem "Payments API outage" --sev=2 --duration=45m
/incident postmortem "Auth service degradation" --sev=3 --duration=2h --output=md
```

---

### `/incident drill`
Run a simulated incident fire drill for team training.

```
/incident drill [scenario=<name>]
```

**Available scenarios:**
- `db-failover` — Primary database fails, replica promotion required
- `memory-leak` — Service memory climbs until OOM
- `bad-deploy` — New version introduces 5xx errors
- `cert-expiry` — TLS certificate expires
- `upstream-outage` — Critical third-party API goes down
- `ddos` — Unusual traffic spike overwhelms the system

---

### `/incident runbook`
Look up or generate a runbook for a specific failure scenario.

```
/incident runbook <scenario>
```

**Examples:**
```
/incident runbook high-error-rate
/incident runbook db-connection-exhaustion
/incident runbook ssl-cert-expired
```

---

## Workflow

```
Alert fires
    │
    ▼
/incident alert ──▶ SEV classified ──▶ Blast radius assessed
    │
    ▼
/incident diagnose ──▶ Root cause identified
    │
    ▼
/incident mitigate ──▶ Fix applied or PR opened
    │
    ▼
/incident update ──▶ Slack + status page updated
    │
    ▼
/incident resolve ──▶ Incident closed
    │
    ▼
/incident postmortem ──▶ Blameless report generated
```

## Integration with MCP

When MCP tools are connected, `/incident alert` can:
- Automatically query Datadog logs for the affected service
- Fetch PagerDuty incident details
- Read recent GitHub commits to identify the bad deploy
- Post the incident update to Slack automatically

Set environment variables (see `incident-response` skill) to enable these integrations.
