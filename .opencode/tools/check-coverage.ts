/**
 * Check Coverage Tool
 *
 * Custom OpenCode tool to analyze test coverage and report on gaps.
 * Supports common coverage report formats.
 */

import { tool, type ToolDefinition } from "@opencode-ai/plugin/tool"
import * as path from "path"
import * as fs from "fs"

const checkCoverageTool: ToolDefinition = tool({
  description:
    "Check test coverage against a threshold and identify files with low coverage. Reads coverage reports from common locations.",
  args: {
    threshold: tool.schema
      .number()
      .optional()
      .describe("Minimum coverage percentage required (default: 80)"),
    showUncovered: tool.schema
      .boolean()
      .optional()
      .describe("Show list of uncovered files (default: true)"),
    format: tool.schema
      .enum(["summary", "detailed", "json"])
      .optional()
      .describe("Output format (default: summary)"),
  },
  async execute(args, context) {
    const threshold = args.threshold ?? 80
    const showUncovered = args.showUncovered ?? true
    const format = args.format ?? "summary"
    const cwd = context.worktree || context.directory

    // Look for coverage reports
    const coveragePaths = [
      "coverage/coverage-summary.json",
      "coverage/lcov-report/index.html",
      "coverage/coverage-final.json",
      ".nyc_output/coverage.json",
    ]

    let coverageData: CoverageSummary | null = null
    let coverageFile: string | null = null

    for (const coveragePath of coveragePaths) {
      const fullPath = path.join(cwd, coveragePath)
      if (fs.existsSync(fullPath) && coveragePath.endsWith(".json")) {
        try {
          const content = JSON.parse(fs.readFileSync(fullPath, "utf-8"))
          coverageData = parseCoverageData(content)
          coverageFile = coveragePath
          break
        } catch {
          // Continue to next file
        }
      }
    }

    if (!coverageData) {
      return JSON.stringify({
        success: false,
        error: "No coverage report found",
        suggestion:
          "Run tests with coverage first: npm test -- --coverage",
        searchedPaths: coveragePaths,
      })
    }

    const passed = coverageData.total.percentage >= threshold
    const uncoveredFiles = coverageData.files.filter(
      (f) => f.percentage < threshold
    )

    const result: CoverageResult = {
      success: passed,
      threshold,
      coverageFile,
      total: coverageData.total,
      passed,
    }

    if (format === "detailed" || (showUncovered && uncoveredFiles.length > 0)) {
      result.uncoveredFiles = uncoveredFiles.slice(0, 20) // Limit to 20 files
      result.uncoveredCount = uncoveredFiles.length
    }

    if (format === "json") {
      result.rawData = coverageData
    }

    if (!passed) {
      result.suggestion = `Coverage is ${coverageData.total.percentage.toFixed(1)}% which is below the ${threshold}% threshold. Focus on these files:\n${uncoveredFiles
        .slice(0, 5)
        .map((f) => `- ${f.file}: ${f.percentage.toFixed(1)}%`)
        .join("\n")}`
    }

    return JSON.stringify(result)
  },
})

export default checkCoverageTool

interface CoverageSummary {
  total: {
    lines: number
    covered: number
    percentage: number
  }
  files: Array<{
    file: string
    lines: number
    covered: number
    percentage: number
  }>
}

interface CoverageResult {
  success: boolean
  threshold: number
  coverageFile: string | null
  total: CoverageSummary["total"]
  passed: boolean
  uncoveredFiles?: CoverageSummary["files"]
  uncoveredCount?: number
  rawData?: CoverageSummary
  suggestion?: string
}

const lineSummarySchema = tool.schema.object({
  total: tool.schema.number().int().nonnegative(),
  covered: tool.schema.number().int().nonnegative(),
}).refine(value => value.covered <= value.total, "Covered lines exceed total lines")

const summarySchema = tool.schema.object({ lines: lineSummarySchema })
const locationSchema = tool.schema.object({
  start: tool.schema.object({ line: tool.schema.number().int().positive() }),
})
const rawSchema = tool.schema.object({
  statementMap: tool.schema.record(tool.schema.string(), locationSchema),
  s: tool.schema.record(tool.schema.string(), tool.schema.number().int().nonnegative()),
}).refine(value => {
  const statementIds = Object.keys(value.statementMap)
  return statementIds.length === Object.keys(value.s).length
    && statementIds.every(id => Object.hasOwn(value.s, id))
}, "Coverage statement maps and hit records must contain the same IDs")
const reportSchema = tool.schema.record(tool.schema.string(), tool.schema.unknown())

function lineMetrics(lines: number, covered: number): CoverageSummary["total"] {
  if (!Number.isInteger(lines) || !Number.isInteger(covered) || lines < 0 || covered < 0 || covered > lines) {
    throw new Error("Invalid coverage line metrics")
  }
  return { lines, covered, percentage: lines > 0 ? (covered / lines) * 100 : 100 }
}

function summaryMetrics(value: unknown): CoverageSummary["total"] {
  const { lines } = summarySchema.parse(value)
  return lineMetrics(lines.total, lines.covered)
}

function rawMetrics(value: unknown): CoverageSummary["total"] {
  const { statementMap, s } = rawSchema.parse(value)
  const statements = Object.entries(s).map(([id, hits]) => ({ line: statementMap[id].start.line, hits }))
  // Istanbul groups statements by start line and uses the maximum hit count.
  // A line is covered if any statement on it has hits, regardless of end ranges.
  const lines = new Set(statements.map(statement => statement.line))
  const covered = new Set(statements.filter(statement => statement.hits > 0).map(statement => statement.line))
  return lineMetrics(lines.size, covered.size)
}

function parseCoverageData(value: unknown): CoverageSummary {
  const data = reportSchema.parse(value)
  if ("total" in data) {
    const files = Object.entries(data).filter(([file]) => file !== "total")
      .map(([file, summary]) => ({ file, ...summaryMetrics(summary) }))
    return { total: summaryMetrics(data.total), files }
  }
  if (Object.keys(data).length === 0) throw new Error("Empty coverage report")
  const files = Object.entries(data).map(([file, raw]) => ({ file, ...rawMetrics(raw) }))
  return {
    total: lineMetrics(
      files.reduce((sum, file) => sum + file.lines, 0),
      files.reduce((sum, file) => sum + file.covered, 0)
    ),
    files,
  }
}
