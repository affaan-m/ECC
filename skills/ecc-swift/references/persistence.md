# Actor-backed file persistence

Adapted from ECC `swift-actor-persistence`, with error and commit semantics
made explicit. Actor isolation protects in-process state; it does not provide
cross-process locking, database transactions, or a power-loss durability proof.

For small snapshots, write a candidate value first and commit the in-memory
cache only after that write succeeds. Otherwise a thrown save can leave the
cache reporting data that was never persisted.

This complete example stores binary values under stable string keys:

```swift
import Foundation

actor SnapshotStore {
    private let fileURL: URL
    private var values: [String: Data]

    init(fileURL: URL) throws {
        self.fileURL = fileURL
        do {
            let data = try Data(contentsOf: fileURL)
            self.values = try JSONDecoder().decode([String: Data].self, from: data)
        } catch let error as CocoaError where error.code == .fileReadNoSuchFile {
            self.values = [:]
        }
    }

    func value(for key: String) -> Data? {
        values[key]
    }

    func set(_ value: Data, for key: String) throws {
        var candidate = values
        candidate[key] = value
        try commit(candidate)
    }

    func remove(_ key: String) throws {
        var candidate = values
        candidate.removeValue(forKey: key)
        try commit(candidate)
    }

    private func commit(_ candidate: [String: Data]) throws {
        let data = try JSONEncoder().encode(candidate)
        try data.write(to: fileURL, options: .atomic)
        values = candidate
    }
}
```

The caller supplies an authorized file location and creates its containing
directory as appropriate. Missing files start empty; decoding, permission,
and other I/O errors propagate rather than silently destroying existing data.
`Data` values are sendable snapshots. Generic models crossing actors need an
equivalent safe-transfer contract, and their `Codable` conformances must be
usable from the chosen isolation domain.

This implementation deliberately has no suspension between candidate creation,
write, and cache commit. Its synchronous initialization blocks its caller, and
its file I/O blocks the executing thread. Keep it for bounded small snapshots;
for larger storage, choose suitable asynchronous/dedicated I/O or a database.
If the write becomes async, reentrancy requires a write-order/version protocol:
simply inserting `await` can let an older write overwrite a newer snapshot.

`.atomic` avoids exposing a partially replaced file through the normal write
path; it does not establish complete crash durability or coordinate multiple
writers. For sandbox bookmarks, balance access to security-scoped resources
for the full operation lifetime. For collections decoded from external input,
define duplicate-ID handling rather than letting
`Dictionary(uniqueKeysWithValues:)` trap.

Verify successful reload, missing/corrupt input, save/delete failures preserving
the prior cache, and concurrent callers. Use a temporary directory per test.
