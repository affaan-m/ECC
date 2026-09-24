/**
 * ECC custom tools for OpenCode V2.
 *
 * OpenCode V2 registers tools through `ctx.tool.transform(...)` and removed the
 * V1 `tool()` helper from the plugin runtime. To keep behavior identical across
 * both harness versions, each V2 tool delegates execution to the existing V1
 * tool definition in `.opencode/tools/` and only re-declares its JSON Schema
 * input shape.
 *
 * The V1 tool modules are imported lazily so that OpenCode 1 never evaluates
 * this file (it is only reached from the V2 `setup` path).
 */

import type { Plugin } from "@opencode/plugin"

type Context = Plugin.Context

export interface V1ToolDefinition {
  description: string
  execute: (args: Record<string, unknown>, context: Record<string, unknown>) => Promise<unknown>
}

interface V2ToolSpec {
  name: string
  description: string
  /** JSON Schema for the tool input, mirroring the V1 argument object. */
  input: Record<string, unknown>
  load: () => Promise<V1ToolDefinition>
}

const object = (properties: Record<string, unknown>): Record<string, unknown> => ({
  type: "object",
  properties,
  additionalProperties: false,
})

const toolSpecs: V2ToolSpec[] = [
  {
    name: "run-tests",
    description:
      "Run the test suite with optional coverage, watch mode, or specific test patterns. Automatically detects package manager (npm, pnpm, yarn, bun) and test framework.",
    input: object({
      pattern: { type: "string", description: "Test file pattern or specific test name to run" },
      coverage: { type: "boolean", description: "Run with coverage reporting (default: false)" },
      watch: { type: "boolean", description: "Run in watch mode for continuous testing (default: false)" },
      updateSnapshots: { type: "boolean", description: "Update Jest/Vitest snapshots (default: false)" },
    }),
    load: async () => (await import("../../tools/run-tests.ts")).default as unknown as V1ToolDefinition,
  },
  {
    name: "check-coverage",
    description:
      "Check test coverage against a threshold and identify files with low coverage. Reads coverage reports from common locations.",
    input: object({
      threshold: { type: "number", description: "Minimum coverage percentage required (default: 80)" },
      showUncovered: { type: "boolean", description: "Show list of uncovered files (default: true)" },
      format: {
        type: "string",
        enum: ["summary", "detailed", "json"],
        description: "Output format (default: summary)",
      },
    }),
    load: async () => (await import("../../tools/check-coverage.ts")).default as unknown as V1ToolDefinition,
  },
  {
    name: "security-audit",
    description:
      "Run a comprehensive security audit including dependency vulnerabilities, secret scanning, and common security issues.",
    input: object({
      type: {
        type: "string",
        enum: ["all", "dependencies", "secrets", "code"],
        description: "Type of audit to run (default: all)",
      },
      fix: { type: "boolean", description: "Attempt to auto-fix dependency vulnerabilities (default: false)" },
      severity: {
        type: "string",
        enum: ["low", "moderate", "high", "critical"],
        description: "Minimum severity level to report (default: moderate)",
      },
    }),
    load: async () => (await import("../../tools/security-audit.ts")).default as unknown as V1ToolDefinition,
  },
  {
    name: "format-code",
    description:
      "Detect formatter for a file and return the exact command to run (Biome, Prettier, Black, gofmt, rustfmt, swift-format). Supports cross-platform command generation.",
    input: object({
      filePath: { type: "string", description: "Path to the file to format" },
      formatter: {
        type: "string",
        enum: ["biome", "prettier", "black", "gofmt", "rustfmt", "swift-format"],
        description: "Optional formatter override",
      },
    }),
    load: async () => (await import("../../tools/format-code.ts")).default as unknown as V1ToolDefinition,
  },
  {
    name: "lint-check",
    description:
      "Detect linter for a target path and return command for check/fix runs. Supports cross-platform command generation.",
    input: object({
      target: { type: "string", description: "File or directory to lint (default: current directory)" },
      fix: { type: "boolean", description: "Enable auto-fix mode" },
      linter: {
        type: "string",
        enum: ["biome", "eslint", "ruff", "pylint", "golangci-lint"],
        description: "Optional linter override",
      },
    }),
    load: async () => (await import("../../tools/lint-check.ts")).default as unknown as V1ToolDefinition,
  },
  {
    name: "git-summary",
    description: "Generate git summary with branch, status, recent commits, and optional diff stats.",
    input: object({
      depth: { type: "number", description: "Number of recent commits to include (default: 5)" },
      includeDiff: { type: "boolean", description: "Include diff stats against base branch (default: true)" },
      baseBranch: { type: "string", description: "Base branch for diff comparison (default: main)" },
    }),
    load: async () => (await import("../../tools/git-summary.ts")).default as unknown as V1ToolDefinition,
  },
  {
    name: "changed-files",
    description:
      "List files changed by agents in this session as a navigable tree. Shows added (+), modified (~), and deleted (-) indicators. Use filter to show only specific change types. Returns paths for git diff.",
    input: object({
      filter: { type: "string", enum: ["all", "added", "modified", "deleted"], description: "Filter by change type (default: all)" },
      format: {
        type: "string",
        enum: ["tree", "json"],
        description: "Output format: tree for terminal display, json for structured data (default: tree)",
      },
    }),
    load: async () => (await import("../../tools/changed-files.ts")).default as unknown as V1ToolDefinition,
  },
  {
    name: "dependency-analyzer",
    description:
      "Analyze project dependencies for outdated packages, security vulnerabilities, and unused dependencies. Supports npm, pnpm, yarn, and bun.",
    input: object({
      type: {
        type: "string",
        enum: ["all", "outdated", "security", "unused"],
        description: "Type of analysis to run (default: all)",
      },
      fix: { type: "boolean", description: "Attempt to fix issues automatically (default: false)" },
      depth: { type: "number", description: "Depth of dependency analysis (default: 1)" },
    }),
    load: async () => (await import("../../tools/dependency-analyzer.ts")).default as unknown as V1ToolDefinition,
  },
]

/**
 * Register every ECC custom tool on the V2 tool registry.
 *
 * V1 tool `execute` callbacks only read `context.worktree || context.directory`,
 * so the V2 location directory is a faithful substitute.
 */
export async function registerV2Tools(ctx: Context, worktree: string): Promise<string[]> {
  const loaded = await Promise.all(toolSpecs.map((spec) => spec.load()))
  const available: Array<{ spec: V2ToolSpec; definition: V1ToolDefinition }> = []

  toolSpecs.forEach((spec, index) => {
    const definition = loaded[index]
    if (definition) available.push({ spec, definition })
  })

  await ctx.tool.transform((editor) => {
    for (const { spec, definition } of available) {
      editor.add({
        name: spec.name,
        description: spec.description,
        input: spec.input,
        async execute(input: unknown) {
          const output = await definition.execute(
            (input ?? {}) as Record<string, unknown>,
            { worktree, directory: worktree }
          )
          return { content: typeof output === "string" ? output : JSON.stringify(output) }
        },
      } as never)
    }
  })

  // Read the registry back so the reported names reflect what OpenCode actually
  // accepted, rather than assuming the transform callback already replayed.
  let effective = new Set<string>()
  try {
    const registered = await ctx.tool.list()
    effective = new Set(registered.map((tool) => tool.id))
  } catch {
    return available.map((entry) => entry.spec.name)
  }

  return available
    .map((entry) => entry.spec.name)
    .filter((name) => effective.has(name) || [...effective].some((id) => id.endsWith(`.${name}`) || id.endsWith(`_${name}`)))
}
