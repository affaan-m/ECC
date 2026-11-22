import type { tool as OpenCodeTool } from "@opencode-ai/plugin/tool"

export type { ToolDefinition } from "@opencode-ai/plugin/tool"

// OpenCode's V2 plugin loader does not resolve bare specifiers such as "zod"
// from the config directory, and an import failure takes the whole tool module
// down. Keep real Zod when it is resolvable (V1 surfaces and tests), and fall
// back to an inert builder chain otherwise: V2 defines its JSON schemas inline
// and never consumes the V1 `args` builders.
const inertSchema: any = new Proxy(function () {}, {
  get: () => (..._args: any[]) => inertSchema,
  apply: () => inertSchema,
})

function loadZod(): any {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    return typeof require === "function" ? require("zod").z : undefined
  } catch {
    return undefined
  }
}

// OpenCode's tool helper returns the definition unchanged and exposes Zod as schema.
// Keep the runtime import local so packed installs use the audited Zod version.
export const tool = Object.assign(<T>(definition: T): T => definition, {
  schema: loadZod() ?? inertSchema,
}) as typeof OpenCodeTool
