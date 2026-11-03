---
name: ecc-performance
description: Profile and optimize measured CPU, memory, latency, throughput, allocation, and rendering bottlenecks.
---

# Performance engineering

Define the operation, representative input, correctness gate, and metric before
changing the implementation. Capture a reproducible baseline, then vary one
hypothesis at a time. Compare repeated runs with the same build, hardware, and
workload, and include memory/error-rate tradeoffs.

Distinguish app cadence, physical display FPS, CPU time, GPU time, end-to-end
latency, throughput, and queue delay. Keep aborted, occluded, invalid, or
non-monotonic measurements out of accepted results and explain their exclusion.
Treat proposed indexes, caches, batching, and concurrency as hypotheses.

For an iterative A/B optimization task, read [optimization loop](references/optimization.md).
For tail latency, queues, freshness, or streaming paths, read [latency](references/latency.md).
Choose checks that fit the task; keep remote mutations within existing authorization.
