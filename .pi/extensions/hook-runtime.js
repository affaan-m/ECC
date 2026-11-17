const path = require("node:path")

/**
 * Select a real Node executable for hook scripts.
 *
 * Compiled OMP may report `process.release.name` as `node` even though its
 * `process.execPath` points to the OMP launcher. Bun is detected separately via
 * `process.versions.bun`; both fall back to `node` unless `ECC_HOOK_NODE`
 * supplies an explicit absolute path.
 *
 * @param options - Runtime metadata and an optional absolute Node override.
 * @returns The executable path to use for hook scripts.
 * @throws {Error} If the hook runtime override is non-empty and relative.
 */
function resolveHookRuntime({
  execPath = process.execPath,
  releaseName = process.release?.name,
  bunVersion = process.versions?.bun,
  override = process.env.ECC_HOOK_NODE,
} = {}) {
  const isNodeRuntime =
    releaseName === "node" &&
    !bunVersion &&
    /^(?:node|nodejs)(?:\.exe)?$/i.test(path.basename(execPath))
  const overridePath = override?.trim()
  if (overridePath) {
    if (!path.isAbsolute(overridePath)) {
      throw new Error("ECC_HOOK_NODE must be an absolute path: " + overridePath)
    }
    return overridePath
  }
  return isNodeRuntime ? execPath : "node"
}

module.exports = { resolveHookRuntime }
