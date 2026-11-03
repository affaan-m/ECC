# Performance

Adapted from `bol/m10-performance` and its optimization guide.

Record workload, build profile, features, target, hardware, warm-up, and the metric before changing code. Compare release-like builds; preserve a correctness gate and change one bottleneck hypothesis at a time.

Track allocations and peak memory alongside time when changing collection shape or caching. A cache can improve one latency measurement while increasing memory, startup time, or stale-data risk. Separate scheduling delay, service time, throughput, and end-to-end latency.

Common candidates after measurement:

- Borrow inputs when ownership is unnecessary; use `Cow` only when both borrowed and owned results are genuinely useful.
- Reuse a buffer whose lifetime permits reuse; clear logical contents and ensure old secrets are not retained where that matters.
- Reserve capacity from a credible bound; untrusted counts must not force uncontrolled allocations.
- Prefer contiguous collections for sequential access; benchmark a small linear collection before adding a tree or hash table.
- Batch calls and bound concurrency when synchronization or system-call overhead dominates.

Use the repository's benchmarks and existing profilers first. Criterion, `std::hint::black_box`, platform Instruments/perf, and allocation profilers answer different questions. Do not install a new tool or change compiler flags merely because a reference lists it.

Report measured distributions and uncertainty; preserve failed, occluded, or incomplete runs as invalid. Application cadence is not automatically display FPS or input-to-display latency.
