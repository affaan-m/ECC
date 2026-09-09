// ECC-owned Lume 0.5.1 clone compatibility helper. Never boots a guest.
// Pinned upstream: trycua/cua@7e13c6437acb1e2193548d36f520b3519ceee05c
// Per-file clonefile is mandatory. There is deliberately no copy fallback.
import Foundation
import Darwin
import Virtualization

struct CloneFailure: Error { let message: String }
var ownedDestination = false
var cleanupPass: Bool? = true
func require(_ condition: Bool, _ message: String) throws {
    if !condition { throw CloneFailure(message: message) }
}
func info(_ descriptor: Int32) throws -> stat {
    var value = stat()
    try require(fstat(descriptor, &value) == 0, "Cannot inspect opened file")
    return value
}
func openDirectory(_ path: String) throws -> Int32 {
    guard let canonical = realpath(path, nil) else { throw CloneFailure(message: "Cannot resolve directory") }
    defer { free(canonical) }
    try require(String(cString: canonical) == path, "Symlinked directory refused")
    let fd = open(path, O_RDONLY | O_DIRECTORY | O_NOFOLLOW | O_CLOEXEC)
    try require(fd >= 0, "Cannot open directory")
    return fd
}
func regular(_ value: stat) -> Bool { (value.st_mode & S_IFMT) == S_IFREG }
func acquireGuard(_ parent: Int32, _ name: String) throws -> Int32 {
    let fd = openat(parent, ".\(name).resize.guard", O_RDWR | O_CREAT | O_NOFOLLOW | O_CLOEXEC, 0o600)
    try require(fd >= 0, "Cannot open VM lifecycle guard")
    do {
        let value = try info(fd)
        try require(regular(value) && value.st_uid == getuid() && value.st_nlink == 1, "Unsafe VM lifecycle guard")
        try require(flock(fd, LOCK_EX | LOCK_NB) == 0, "VM lifecycle guard is busy")
        return fd
    } catch { close(fd); throw error }
}
func releaseGuard(_ fd: Int32) { _ = flock(fd, LOCK_UN); close(fd) }
func entryNames(_ path: String) throws -> [String] {
    let names = try FileManager.default.contentsOfDirectory(atPath: path).sorted()
    try require(names.count <= 64, "Too many seed entries")
    try require(["disk.img", "nvram.bin", "config.json"].allSatisfy { names.contains($0) }, "Seed files missing")
    let blocked: Set<String> = ["sessions.json", ".provisioning", "resize.lock.json"]
    try require(names.allSatisfy { !blocked.contains($0) && !$0.contains("/") }, "Seed session, provisioning, or resize state present")
    return names
}
func openedFiles(_ directory: Int32, _ names: [String]) throws -> [(String, Int32)] {
    var opened: [(String, Int32)] = []
    do {
        var auxiliary: Int64 = 0
        for name in names {
            let fd = openat(directory, name, O_RDONLY | O_NOFOLLOW | O_NONBLOCK | O_CLOEXEC)
            try require(fd >= 0, "Cannot open seed entry")
            opened.append((name, fd))
            let value = try info(fd)
            let limit: Int64 = name == "disk.img" ? 8 * 1024 * 1024 * 1024 * 1024 : (name == "nvram.bin" ? 64 * 1024 * 1024 : 16 * 1024 * 1024)
            try require(regular(value) && value.st_size >= 0 && value.st_size <= limit, "Seed entry is special or oversized")
            if name != "disk.img" { auxiliary += value.st_size }
        }
        try require(auxiliary <= 80 * 1024 * 1024, "Seed metadata too large")
        return opened
    } catch { for (_, fd) in opened { close(fd) }; throw error }
}
func writeAll(_ fd: Int32, _ bytes: Data) throws {
    try bytes.withUnsafeBytes { raw in
        var count = 0
        while count < bytes.count {
            let result = write(fd, raw.baseAddress!.advanced(by: count), bytes.count - count)
            if result < 0 && errno == EINTR { continue }
            try require(result > 0, "Cannot write identity metadata")
            count += result
        }
    }
}
func freshConfig(_ directory: Int32) throws {
    let fd = openat(directory, "config.json", O_RDONLY | O_NOFOLLOW | O_CLOEXEC)
    try require(fd >= 0, "Missing cloned configuration")
    defer { close(fd) }
    let value = try info(fd)
    try require(value.st_size > 0 && value.st_size <= 1024 * 1024, "Invalid configuration size")
    var data = Data(count: Int(value.st_size))
    let count = data.withUnsafeMutableBytes { read(fd, $0.baseAddress, $0.count) }
    try require(count == data.count, "Cannot read complete configuration")
    guard var config = try JSONSerialization.jsonObject(with: data) as? [String: Any],
          let os = config["os"] as? String, os.lowercased() == "macos",
          let hardware = config["hardwareModel"] as? String, Data(base64Encoded: hardware)?.isEmpty == false,
          let machine = config["machineIdentifier"] as? String, Data(base64Encoded: machine)?.isEmpty == false,
          config["macAddress"] is String else {
        throw CloneFailure(message: "Unsupported seed configuration")
    }
    // Match LumeController.clone: retain hardware model and disk/NVRAM pairing.
    config["macAddress"] = VZMACAddress.randomLocallyAdministered().string
    config["machineIdentifier"] = VZMacMachineIdentifier().dataRepresentation.base64EncodedString()
    let bytes = try JSONSerialization.data(withJSONObject: config, options: [.sortedKeys])
    let temporary = ".ecc-config-new"
    let output = openat(directory, temporary, O_WRONLY | O_CREAT | O_EXCL | O_NOFOLLOW | O_CLOEXEC, 0o600)
    try require(output >= 0, "Cannot create fresh configuration")
    defer { close(output); _ = unlinkat(directory, temporary, 0) }
    try writeAll(output, bytes)
    try require(fsync(output) == 0, "Cannot sync fresh configuration")
    try require(renameat(directory, temporary, directory, "config.json") == 0, "Cannot publish fresh configuration")
}
func cleanupOwned(_ parent: Int32, _ name: String, _ directory: Int32, _ identity: stat, _ entries: [String]) -> Bool {
    var current = stat()
    guard fstatat(parent, name, &current, AT_SYMLINK_NOFOLLOW) == 0,
          current.st_ino == identity.st_ino, current.st_dev == identity.st_dev else { return false }
    for entry in entries { _ = unlinkat(directory, entry, 0) }
    _ = unlinkat(directory, ".ecc-config-new", 0)
    return unlinkat(parent, name, AT_REMOVEDIR) == 0
}
func cloneVM(_ source: String, _ destination: String, _ expected: [String]) throws {
    let sourceURL = URL(fileURLWithPath: source)
    let destURL = URL(fileURLWithPath: destination)
    let destName = destURL.lastPathComponent
    try require(destName.range(of: "^ecc-(sandbox|explore|fabric)-lume-[a-zA-Z0-9-]+$", options: .regularExpression) != nil, "Destination is outside ECC namespace")
    let sourceParent = try openDirectory(sourceURL.deletingLastPathComponent().path)
    defer { close(sourceParent) }
    let destParent = try openDirectory(destURL.deletingLastPathComponent().path)
    defer { close(destParent) }
    let sourceGuard = try acquireGuard(sourceParent, sourceURL.lastPathComponent)
    defer { releaseGuard(sourceGuard) }
    let destGuard = try acquireGuard(destParent, destName)
    defer { releaseGuard(destGuard) }
    let sourceDir = try openDirectory(source)
    defer { close(sourceDir) }
    let sourceIdentity = try info(sourceDir)
    let parentIdentity = try info(destParent)
    try require([String(sourceIdentity.st_dev), String(sourceIdentity.st_ino), String(parentIdentity.st_dev), String(parentIdentity.st_ino)] == expected, "Prepared directory identities changed")
    try require(sourceIdentity.st_dev == parentIdentity.st_dev, "Cross-volume clone refused")
    let names = try entryNames(source)
    let files = try openedFiles(sourceDir, names)
    defer { for (_, fd) in files { close(fd) } }
    // Publish no destination until all file types, sizes, and lifecycle state pass.
    try require(mkdirat(destParent, destName, 0o700) == 0, "Destination already exists or cannot be created")
    ownedDestination = true
    cleanupPass = false
    let destinationDir = openat(destParent, destName, O_RDONLY | O_DIRECTORY | O_NOFOLLOW | O_CLOEXEC)
    if destinationDir < 0 { cleanupPass = unlinkat(destParent, destName, AT_REMOVEDIR) == 0; throw CloneFailure(message: "Cannot open owned destination") }
    defer { close(destinationDir) }
    let identity = try info(destinationDir)
    var created: [String] = []
    var success = false
    defer { if !success { cleanupPass = cleanupOwned(destParent, destName, destinationDir, identity, created) } }
    for (name, sourceFile) in files {
        try require(fclonefileat(sourceFile, destinationDir, name, UInt32(CLONE_NOFOLLOW_ANY)) == 0, "Required copy-on-write clone failed")
        created.append(name)
    }
    try freshConfig(destinationDir)
    try require(fsync(destinationDir) == 0, "Cannot sync cloned directory")
    success = true
    cleanupPass = nil
}
func probe(_ parentPath: String) throws {
    let parent = try openDirectory(parentPath)
    defer { close(parent) }
    let name = ".ecc-clone-probe-\(UUID().uuidString)"
    try require(mkdirat(parent, name, 0o700) == 0, "Cannot create clone probe")
    let directory = openat(parent, name, O_RDONLY | O_DIRECTORY | O_NOFOLLOW | O_CLOEXEC)
    if directory < 0 { _ = unlinkat(parent, name, AT_REMOVEDIR); throw CloneFailure(message: "Cannot open probe") }
    defer { close(directory); _ = unlinkat(parent, name, AT_REMOVEDIR) }
    defer { _ = unlinkat(directory, "original", 0); _ = unlinkat(directory, "cloned", 0) }
    let original = openat(directory, "original", O_RDWR | O_CREAT | O_EXCL | O_NOFOLLOW | O_CLOEXEC, 0o600)
    try require(original >= 0, "Cannot create original probe file")
    defer { close(original) }
    try writeAll(original, Data([65]))
    try require(fclonefileat(original, directory, "cloned", UInt32(CLONE_NOFOLLOW_ANY)) == 0, "Filesystem cannot guarantee copy-on-write")
    let cloned = openat(directory, "cloned", O_WRONLY | O_NOFOLLOW | O_CLOEXEC)
    try require(cloned >= 0, "Cannot open clone probe")
    defer { close(cloned) }
    try writeAll(cloned, Data([66]))
    var byte: UInt8 = 0
    try require(pread(original, &byte, 1, 0) == 1 && byte == 65, "Clone writes are not isolated")
}
do {
    let args = CommandLine.arguments
    if args.count == 3 && args[1] == "probe" { try probe(args[2]) }
    else if args.count == 8 && args[1] == "clone" { try cloneVM(args[2], args[3], Array(args[4...7])) }
    else { throw CloneFailure(message: "Invalid helper invocation") }
    let output = try JSONSerialization.data(withJSONObject: ["ok": true, "copy_method": "clonefile-required", "owned_destination": ownedDestination, "cleanup_pass": cleanupPass as Any? ?? NSNull()])
    print(String(data: output, encoding: .utf8)!)
} catch {
    // No paths, configuration values, or credentials in output.
    let reason = (error as? CloneFailure)?.message ?? "Invalid clone metadata"
    let output = try! JSONSerialization.data(withJSONObject: ["ok": false, "copy_method": "clonefile-required", "message": reason, "owned_destination": ownedDestination, "cleanup_pass": cleanupPass as Any? ?? NSNull()])
    print(String(data: output, encoding: .utf8)!)
    exit(1)
}
