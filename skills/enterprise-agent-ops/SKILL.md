---
name: enterprise-agent-ops
description: Operational controls for long-lived or cloud-hosted agent systems — runtime lifecycle (start, pause, stop, restart), observability (logs, metrics, traces), least-privilege safety scopes and kill switches, and rollout/rollback change management with audit logs and success/cost metrics. Use when running production agent fleets on PM2, systemd, or containers that need monitoring, incident response, or deployment gates.
metadata:
  origin: ECC
---

# Enterprise Agent Ops

Use this skill for cloud-hosted or continuously running agent systems that need operational controls beyond single CLI sessions.

## Operational Domains

1. runtime lifecycle (start, pause, stop, restart)
2. observability (logs, metrics, traces)
3. safety controls (scopes, permissions, kill switches)
4. change management (rollout, rollback, audit)

## Baseline Controls

- immutable deployment artifacts
- least-privilege credentials
- environment-level secret injection
- hard timeout and retry budgets
- audit log for high-risk actions

## Metrics to Track

- success rate
- mean retries per task
- time to recovery
- cost per successful task
- failure class distribution

## Incident Pattern

When failure spikes:
1. freeze new rollout
2. capture representative traces
3. isolate failing route
4. patch with smallest safe change
5. run regression + security checks
6. resume gradually

## Deployment Integrations

This skill pairs with:
- PM2 workflows
- systemd services
- container orchestrators
- CI/CD gates
