# State ownership and asynchronous lifecycle

Curated from ECC SwiftUI patterns and SwiftUI Pro. Observation support and
newer property-wrapper behavior depend on compiler/SDK/deployment settings.

## Choose the owner first

| Situation | Typical design where supported |
| --- | --- |
| View-owned value or observable reference | Private `@State` |
| Writable value owned by a parent | `@Binding` |
| Observable model passed by an owner, reads only | Stored reference |
| Bindings into a passed observable model | `@Bindable` |
| Shared dependency injected by an ancestor | The matching `@Environment` API |
| Existing Combine/older-OS design | Preserve `ObservableObject` and matching wrappers |

An owned model must survive updates for the view's identity. Reconstructing
an observable row model inside `body` or each `ForEach` evaluation defeats that
identity. Initial values used for state do not mean later initializer arguments
replace the state. Choose an explicit update/reset policy when inputs change.

For a small UI-owned model on supported systems:

```swift
import Observation
import SwiftUI

@MainActor
@Observable
final class CounterModel {
    var count = 0
}

@MainActor
struct CounterScreen: View {
    @State private var model = CounterModel()

    var body: some View {
        CounterControls(model: model)
    }
}

@MainActor
struct CounterControls: View {
    @Bindable var model: CounterModel

    var body: some View {
        Stepper(value: $model.count, in: 0...100) {
            Text("Count: \(model.count)")
        }
    }
}
```

UI models need correct isolation, whether explicit or inferred from module
settings. A non-UI observable model can legitimately have another isolation
contract; missing `@MainActor` alone is not proof of a defect.

Observation records accessed stored properties, including those used by computed
getters. A computed projection does not automatically narrow dependencies.
Reading one member of a stored value-type aggregate can still observe the
whole stored property. Change model structure only when behavior or measured
update cost warrants it.

## Scope, identity, and environment

Keep window-specific selection, navigation, and presentation state at the
scene/window owner. A singleton or `@AppStorage` can unintentionally couple
independent windows. Share actual application data deliberately.

Use stable element identity for editable/reordered collections. Array indices,
fresh UUIDs created during rendering, and IDs derived from editable captions
can reset focus, row state, selection, and animation. `id: \.self` is useful
only when the value really is a stable unique identity for that collection.

Environment defaults should not manufacture a new reference or unstable value
on every lookup. Match custom environment APIs to the installed SDK and
availability; preserve an existing injection design when it works.

## Loading and cancellation

Prefer `.task` or `.task(id:)` for async work tied to view lifetime. SwiftUI
requests cancellation when that lifetime ends or the ID changes; the operation
must cooperate. Avoid synchronous I/O in `body` or view initialization.

Represent loading, failure, empty, and loaded states deliberately. Do not turn
every error into an empty array with `try?`. Do not show cancellation as a user
failure. For repeated requests, cancel superseded work and prevent an older
result or `defer` cleanup from overwriting a newer request's state. A generation
token or an explicit request owner can establish this; cancellation alone is
not proof that an old operation stopped.
