/**
 * ECC plugins directory entry for OpenCode 2.x.
 *
 * This file is intentionally inert in normal installs. OpenCode 2.x loads
 * plugins by scanning every root-level file in a plugins directory, so
 * re-exporting the real plugin from here would register the id `ecc-hooks`
 * twice — once per discovered entry — and OpenCode would mark the extra
 * entries `failed: Duplicate plugin ID` (shown in red in the TUI plugins
 * panel).
 *
 * `.opencode/opencode.json` carries no `plugin` entry at all: OpenCode 2.x
 * ignores configured file paths ("configured plugin path must be a
 * directory"), so `./plugins/ecc-hooks.ts` is discovered from the directory.
 * This stub keeps:
 *   - the file present for the installer/uninstall plan (`ecc repair`), and
 *   - a distinct id so a stray directory load can never collide with or
 *     shadow the real hooks plugin, and never throws the V2 schema error
 *     ("Plugin must export a default definition with an id and an effect or
 *     setup function") that a plain non-plugin module would cause.
 *
 * Do not add hook logic here; it belongs in `ecc-hooks.ts` only.
 */

export default {
  id: "ecc-hooks-entry",
  setup() {
    return () => {}
  },
}
