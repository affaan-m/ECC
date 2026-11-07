# SwiftUI performance investigation

Curated from SwiftUI Pro performance/performance-plus and ECC SwiftUI patterns.
Treat structural changes as hypotheses and measure the affected interaction.

Keep view initialization and `body` inexpensive. Repeated sorting, filtering,
decoding, file I/O, and model construction can dominate an update. Moving work
to `.task` does not automatically move synchronous work off the main actor.
Cache derived data only with an explicit invalidation policy; a fast stale list
is not a valid optimization.

Preserve identity across state changes. Conditional modifier values can avoid
replacing an entire view branch when only styling changes. Conditional content
is still appropriate for genuinely different content. Type erasure is a tool
with tradeoffs, not an unconditional defect; remove it only where it obscures
identity or evidence identifies a meaningful cost.

For large collections, inspect stable IDs, repeated per-row searches, row
structure, and the amount of eagerly created content. Lazy containers can
reduce initial work, but use the component that fits selection, scrolling,
accessibility, and platform behavior. Feed rows the narrow inputs they need.
Retain observable row models instead of rebuilding them on every update.

Reduce dependencies of rapidly updated views. Scrolling coordinates, geometry,
drag positions, and timers can propagate frequent invalidations through broad
state/environment storage. A computed Boolean in `body` still depends on the
raw property it reads. Consider stored semantic state or supported visual
effect/scroll APIs when the UI contract allows it.

Extracting a subview does not by itself prove fewer updates. Equatable views
or explicit `.equatable()` require equality that includes every input affecting
rendering/behavior; omitting a callback or mutable reference can leave stale UI.
Do not add a comparator merely to satisfy a pattern.

Profile a reproducible release-build interaction using available Instruments
and app diagnostics. Distinguish body evaluations, layout, CPU/GPU time,
application cadence, and physical display frames. Validate resizing, scrolling,
and state correctness after an optimization. Keep deep model restructuring
outside unrelated feature work unless it is needed for the requested behavior.
