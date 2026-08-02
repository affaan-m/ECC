/**
 * Check Coverage Tool
 *
 * Custom OpenCode tool to analyze test coverage and report on gaps.
 * Supports common coverage report formats.
 */
import { tool } from "@opencode-ai/plugin/tool";
import * as path from "path";
import * as fs from "fs";
const checkCoverageTool = tool({
    description: "Check test coverage against a threshold and identify files with low coverage. Reads coverage reports from common locations.",
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
        const threshold = args.threshold ?? 80;
        const showUncovered = args.showUncovered ?? true;
        const format = args.format ?? "summary";
        const cwd = context.worktree || context.directory;
        // Look for coverage reports
        const coveragePaths = [
            "coverage/coverage-summary.json",
            "coverage/lcov-report/index.html",
            "coverage/coverage-final.json",
            ".nyc_output/coverage.json",
        ];
        let coverageData = null;
        let coverageFile = null;
        for (const coveragePath of coveragePaths) {
            const fullPath = path.join(cwd, coveragePath);
            if (fs.existsSync(fullPath) && coveragePath.endsWith(".json")) {
                try {
                    const content = JSON.parse(fs.readFileSync(fullPath, "utf-8"));
                    coverageData = parseCoverageData(content);
                    coverageFile = coveragePath;
                    break;
                }
                catch {
                    // Continue to next file
                }
            }
        }
        if (!coverageData) {
            return JSON.stringify({
                success: false,
                error: "No coverage report found",
                suggestion: "Run tests with coverage first: npm test -- --coverage",
                searchedPaths: coveragePaths,
            });
        }
        const passed = coverageData.total.percentage >= threshold;
        const uncoveredFiles = coverageData.files.filter((f) => f.percentage < threshold);
        const result = {
            success: passed,
            threshold,
            coverageFile,
            total: coverageData.total,
            passed,
        };
        if (format === "detailed" || (showUncovered && uncoveredFiles.length > 0)) {
            result.uncoveredFiles = uncoveredFiles.slice(0, 20); // Limit to 20 files
            result.uncoveredCount = uncoveredFiles.length;
        }
        if (format === "json") {
            result.rawData = coverageData;
        }
        if (!passed) {
            result.suggestion = `Coverage is ${coverageData.total.percentage.toFixed(1)}% which is below the ${threshold}% threshold. Focus on these files:\n${uncoveredFiles
                .slice(0, 5)
                .map((f) => `- ${f.file}: ${f.percentage.toFixed(1)}%`)
                .join("\n")}`;
        }
        return JSON.stringify(result);
    },
});
export default checkCoverageTool;
function parseCoverageData(data) {
    // Handle istanbul/nyc format
    if (typeof data === "object" && data !== null && "total" in data) {
        const istanbulData = data;
        const total = istanbulData.total;
        const files = [];
        for (const [key, value] of Object.entries(istanbulData)) {
            if (key !== "total" && typeof value === "object" && value !== null) {
                const fileData = value;
                if (fileData.lines) {
                    files.push({
                        file: key,
                        lines: fileData.lines.total,
                        covered: fileData.lines.covered,
                        percentage: fileData.lines.total > 0
                            ? (fileData.lines.covered / fileData.lines.total) * 100
                            : 100,
                    });
                }
            }
        }
        return {
            total: {
                lines: total.lines?.total || 0,
                covered: total.lines?.covered || 0,
                percentage: total.lines?.total
                    ? (total.lines.covered / total.lines.total) * 100
                    : 0,
            },
            files,
        };
    }
    // Default empty result
    return {
        total: { lines: 0, covered: 0, percentage: 0 },
        files: [],
    };
}
//# sourceMappingURL=check-coverage.js.map