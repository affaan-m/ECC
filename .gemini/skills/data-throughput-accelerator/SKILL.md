---
name: data-throughput-accelerator
description: Use when large data ingestion, backfill, export, ETL, warehouse loading, manifest catch-up, or table synchronization needs to become much faster while preserving data correctness.
origin: ECC
tools: Read, Write, Edit, Bash, Grep, Glob
---

# Data Throughput Accelerator

Use this skill when the bottleneck is moving, transforming, or saving lots of
data. The goal is not just speed. The goal is faster correct data landing in the
right place with proof.

## First Distinction

Separate these before optimizing:

- source extraction speed;
- network transfer speed;
- warehouse/load speed;
- transform speed;
- serving-table freshness;
- live tail growth while the job runs.

A pipeline can be "fast" and still appear behind if new data arrives faster
than the final catch-up window.

## Fast Path Heuristics

- Move compute to where the data already is.
- Prefer warehouse-native scans, joins, and appends for large landed files.
- Use manifests or checkpoints so completed files/partitions are skipped.
- Use partitioning and clustering that match the read and append pattern.
- Batch small files, requests, and writes.
- Make writes idempotent through unique keys, manifests, or replaceable staging.
- Keep raw, derived, and serving tables separately accountable.

## Workflow

1. Read the current source, target, and manifest contracts.
2. Measure backlog: external files, manifest rows, raw rows, derived rows,
   min/max timestamps, and unprocessed counts.
3. Run a safe catch-up or sample benchmark.
4. Compare variants: batch size, worker count, warehouse SQL, file grouping,
   staging shape, and manifest update method.
5. Promote only the fastest path that keeps counts and timestamps coherent.
6. Codify the path as a CLI, scheduled job, workflow, or runbook.
7. Rerun final accounting after the codified path executes.

## Accounting Output

Use a hard accounting block:

```text
Data throughput result:
- Source files discovered: 294
- Files processed this run: 294
- Raw rows added: 9,683,598
- Derived rows added: 8,917,585
- Remaining tail: 24 files at readback time
- Runtime: 38.7s
- Correctness gate: manifest counts and table max timestamps match
```

## Guardrails

- Do not delete raw data to make a metric look better.
- Do not skip failed files silently.
- Do not mix historical backfill status with live-tail freshness.
- Do not call a pipeline complete until the target tables and manifest agree.
- For finance, healthcare, regulated, or customer-impacting data, preserve
  replay evidence and approval gates.
