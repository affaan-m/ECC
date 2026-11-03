# Embedded Rust constraints

Adapted from `bol/domain-embedded`.

Inspect the target, linker script, memory map, panic strategy, HAL/PAC versions, and execution model before using host-oriented examples. `no_std` does not inherently forbid allocation, but an allocator is not available unless the application supplies one and budgets for it.

Use ownership to ensure exclusive peripheral access, following the selected HAL's API. Interrupt-shared data needs the target's actual synchronization/critical-section mechanism. Atomics are not uniformly available on every MCU, and disabling interrupts on one core does not synchronize multiple cores.

Volatile accesses express device access semantics but do not by themselves establish atomicity, thread synchronization, cache coherence, or DMA ownership. DMA buffers need a stable address, correct alignment, lifetime, and an explicit handoff protocol.

Keep stack use, static buffers, allocation, interrupt latency, and worst-case execution time visible. Host unit tests can verify pure logic but cannot validate peripheral timing, linker placement, or hardware behavior; use the existing target/hardware checks for those claims.
