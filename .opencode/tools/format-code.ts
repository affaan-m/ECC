/**
 * ECC Custom Tool: Format Code
 *
 * Returns the formatter command that should be run for a given file.
 * This avoids shell execution assumptions while still giving precise guidance.
 * Supports cross-platform command generation.
 */

import { tool, type ToolDefinition } from "@opencode-ai/plugin/tool"
import * as path from "path"
import * as fs from "fs"

type Formatter = "biome" | "prettier" | "black" | "gofmt" | "rustfmt" | "swift-format"

interface FormatResult {
  success: boolean
  formatter?: Formatter
  command?: string
  instructions?: string
  message?: string
  error?: string
}

const formatCodeTool: ToolDefinition = tool({
  description:
    "Detect formatter for a file and return the exact command to run (Biome, Prettier, Black, gofmt, rustfmt, swift-format). Supports cross-platform command generation.",
  args: {
    filePath: tool.schema.string().describe("Path to the file to format"),
    formatter: tool.schema
      .enum(["biome", "prettier", "black", "gofmt", "rustfmt", "swift-format"])
      .optional()
      .describe("Optional formatter override"),
  },
  async execute(args, context): Promise<string> {
    try {
      const cwd = context.worktree || context.directory
      const ext = args.filePath.split(".").pop()?.toLowerCase() || ""
      const detected = args.formatter || detectFormatter(cwd, ext)

      if (!detected) {
        return JSON.stringify({
          success: false,
          message: `No formatter detected for .${ext} files`,
          supportedFormatters: ["biome", "prettier", "black", "gofmt", "rustfmt", "swift-format"],
        })
      }

      const command = buildFormatterCommand(detected, args.filePath, cwd)
      return JSON.stringify({
        success: true,
        formatter: detected,
        command,
        instructions: `Run this command:\n\n${command}`,
        platform: process.platform,
      })
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : String(error)
      return JSON.stringify({
        success: false,
        error: `Failed to detect formatter: ${errorMessage}`,
        filePath: args.filePath,
      })
    }
  },
})

export default formatCodeTool

function detectFormatter(cwd: string, ext: string): Formatter | null {
  // Check for formatter config files
  const hasConfig = (configFiles: string[]): boolean => {
    return configFiles.some(configFile => fs.existsSync(path.join(cwd, configFile)))
  }

  // JavaScript/TypeScript files
  if (["ts", "tsx", "js", "jsx", "json", "css", "scss", "md", "yaml", "yml"].includes(ext)) {
    if (hasConfig(["biome.json", "biome.jsonc"])) {
      return "biome"
    }
    return "prettier"
  }

  // Python files
  if (["py", "pyi"].includes(ext)) {
    return "black"
  }

  // Go files
  if (ext === "go") {
    return "gofmt"
  }

  // Rust files
  if (ext === "rs") {
    return "rustfmt"
  }

  // Swift files
  if (ext === "swift") {
    return "swift-format"
  }

  return null
}

function buildFormatterCommand(formatter: Formatter, filePath: string, cwd?: string): string {
  // Normalize path for cross-platform compatibility
  const normalizedPath = path.normalize(filePath)
  
  // Build command based on formatter and platform
  const commands: Record<Formatter, string> = {
    biome: `npx @biomejs/biome format --write ${normalizedPath}`,
    prettier: `npx prettier --write ${normalizedPath}`,
    black: `black ${normalizedPath}`,
    gofmt: `gofmt -w ${normalizedPath}`,
    rustfmt: `rustfmt ${normalizedPath}`,
    "swift-format": `swift-format format --in-place ${normalizedPath}`,
  }

  return commands[formatter]
}
