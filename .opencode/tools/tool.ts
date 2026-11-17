import { z } from "zod"
import type { tool as OpenCodeTool } from "@opencode-ai/plugin/tool"

export type { ToolDefinition } from "@opencode-ai/plugin/tool"

// OpenCode's tool helper returns the definition unchanged and exposes Zod as schema.
// Keep the runtime import local so packed installs use the audited Zod version.
export const tool = Object.assign(<T>(definition: T): T => definition, {
  schema: z,
}) as typeof OpenCodeTool
