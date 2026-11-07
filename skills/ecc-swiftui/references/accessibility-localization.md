# Accessible and localized interfaces

Curated from SwiftUI Pro accessibility/localization guidance and ECC SwiftUI
patterns. Preserve existing localization and design workflows.

Use native `Button`, `Toggle`, `Picker`, and related controls for their actual
roles. A tap gesture plus a button trait alone may still lack the keyboard,
focus, activation, or disabled semantics of a real control. Retain gestures
when location/count/interaction behavior genuinely requires them and supply
the appropriate accessible actions as well.

Give actions meaningful accessible names. An image's default symbol name may
describe its shape rather than the action. A visually icon-only control can
retain its text through a labeled button and `.labelStyle(.iconOnly)` where
appropriate. Hide decorative images without hiding meaningful information.

Check:

- Dynamic Type/large-text layouts and multiline/localized labels.
- VoiceOver labels, values, grouping, reading order, and custom actions.
- Keyboard navigation, focus visibility/restoration, and platform commands.
- Reduce Motion, increased contrast, and differentiation beyond color.
- Voice Control input labels for controls with complex or changing titles.

Use semantic fonts where possible; scale required custom measurements with an
API supported by the target. Do not reduce text accessibility to fixed point
sizes. Respect safe areas and available space instead of assuming one display
or one window size.

Keep text in the project's current resources: String Catalogs, `.strings`,
or `.stringsdict`. Moving resources or adding translations in unrelated
languages is a separate task. Interpolate localizable values so translators
can reorder them; concatenating text fragments can destroy grammatical context.

Use localized string types where the receiving API supports them. A runtime
`String` is not automatically a new extractable localization key. Preserve
translator comments for ambiguous actions/nouns and interpolated values.

Select the bundle that owns a package/framework resource. `Bundle.module`
exists for appropriately configured Swift packages; frameworks and app targets
need their corresponding resource-bundle mechanism. Newer compiler bundle
macros require that compiler, even if the runtime deployment target is older.

Format dates/numbers using the appropriate locale/calendar/time zone. SwiftUI
environment values allow per-view/preview overrides that global `.current`
does not reflect. Verify a long-text language and a right-to-left layout when
the changed component is expected to support them. Automated checks and
previews supplement actual keyboard/assistive-technology verification.
