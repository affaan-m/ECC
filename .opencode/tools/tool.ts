import type { tool as OpenCodeTool } from "@opencode-ai/plugin/tool"

export type { ToolDefinition } from "@opencode-ai/plugin/tool"

// The package is ESM, but OpenCode's V2 plugin loader does not resolve bare
// specifiers such as "zod" from the config directory. Keep real Zod whenever
// it can be imported (V1 surfaces, tests and packed installs) and fall back to
// an inert builder chain only when the import actually fails: V2 defines its
// JSON schemas inline and never consumes the V1 `args` builders.
const inertSchema: any = new Proxy(function () {}, {
  get: () => (..._args: any[]) => inertSchema,
  apply: () => inertSchema,
})

let zod: any
try {
  zod = (await import("zod")).z
} catch {
  zod = undefined
}

// OpenCode's tool helper returns the definition unchanged and exposes Zod as schema.
// Keep the runtime import local so packed installs use the audited Zod version.
export const tool = Object.assign(<T>(definition: T): T => definition, {
  schema: zod ?? inertSchema,
}) as typeof OpenCodeTool
