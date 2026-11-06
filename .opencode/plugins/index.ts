/**
 * ECC OpenCode plugin barrel.
 *
 * Intentionally inert. ECC keeps this barrel out of the load path so hooks are
 * not initialized twice (see .opencode/README.md).
 *
 * The v1 plugin API accepted a bare `async () => ({})` default export. The v2
 * API requires a definition object instead:
 *   - { id, setup(ctx) }  <- user-facing contract, used here
 *   - { id, effect(ctx) } <- internal Effect-TS path; a plain async function
 *     there never settles and wedges location activation
 */
export default {
  id: "ecc-barrel",
  setup: async () => undefined,
}
