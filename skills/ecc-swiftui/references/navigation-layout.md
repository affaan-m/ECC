# Navigation, presentation, and adaptive layout

Curated from ECC SwiftUI patterns and SwiftUI Pro navigation, API, design,
and resizability guidance. Apply platform/toolchain checks before modernization.

## Navigation and presentation

Use the navigation model the product requires: `NavigationStack` for stack
navigation and `NavigationSplitView` for adaptive multicolumn interfaces where
supported. For data-driven navigation, keep routes as stable values and register
destinations in the relevant stack, outside lazily instantiated rows. Avoid
competing destination registrations for the same type within one stack.

Independent windows/stacks can register the same route type independently.
A destination-based `NavigationLink` is not universally invalid; inspect its
interaction with path-based navigation before recommending a change.

When a sheet presents an optional identifiable item, `sheet(item:)` can express
the presentation/data relationship without a separate Boolean. Preserve the
item's identity and verify dismissal and edits. Alerts/confirmation dialogs
need state and attachment points that survive while presented; a control inside
a transient system menu may disappear before its dialog can be hosted.

Restore navigation/selection at the correct scene scope. Test stale routes,
deleted items, deep links, Back behavior, keyboard commands, and independent
windows when those paths are affected.

## Resize behavior

Design for the available container instead of a global screen width. This
matters for macOS windows, iPad multitasking, displays, and previews. Use
flexible frames, layout priorities, `ViewThatFits`, the `Layout` protocol, or
geometry APIs appropriate to the deployment target. A `GeometryReader` is
valid when actual measured geometry is required; it should not create a
state/layout feedback loop.

Check narrow and wide windows, sidebar collapse, large text, long translations,
safe areas, sheets/popovers, and toolbar overflow. Do not remove access to an
essential action merely to make a compact width fit. Prefer the system's
layout/adaptation before building a custom bar or manually measuring every child.

## API choices

Use modern styling, shapes, localization, navigation, and toolbar APIs where
the installed SDK and supported target allow them. Distinguish an actual
deprecation from a style preference. For example, a newer styling modifier is
not by itself evidence that working older code needs a feature-unrelated rewrite.

Check compiler-only facilities separately from runtime availability. A runtime
`#available` cannot make an older compiler recognize an unknown macro. Keep
app, extension, and package deployment requirements separate. If a specialized
API is unfamiliar, inspect its installed SDK declaration and official reference
instead of assuming a repository's newest version applies to every project.
