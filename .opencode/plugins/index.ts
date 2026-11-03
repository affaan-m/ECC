/**
 * ECC plugins directory entry for OpenCode 2.x.
 *
 * This file is intentionally inert in normal installs. OpenCode 2.x loads
 * every root-level `.ts` file in a plugins directory AND the directory
 * itself through this entry point, so re-exporting the real plugin from
 * here would register the id `ecc-hooks` twice and OpenCode would mark the
 * extra entries `failed: Duplicate plugin ID` (shown in red in the TUI
 * plugins panel).
 *
 * The configuration in `.opencode/opencode.json` therefore points directly
 * at `./plugins/ecc-hooks.ts`. This stub keeps:
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
