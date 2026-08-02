/**
 * Run Tests Tool
 *
 * Custom OpenCode tool to run test suites with various options.
 * Automatically detects the package manager and test framework.
 */
import { tool } from "@opencode-ai/plugin/tool";
import * as path from "path";
import * as fs from "fs";
const runTestsTool = tool({
    description: "Run the test suite with optional coverage, watch mode, or specific test patterns. Automatically detects package manager (npm, pnpm, yarn, bun) and test framework.",
    args: {
        pattern: tool.schema
            .string()
            .optional()
            .describe("Test file pattern or specific test name to run"),
        coverage: tool.schema
            .boolean()
            .optional()
            .describe("Run with coverage reporting (default: false)"),
        watch: tool.schema
            .boolean()
            .optional()
            .describe("Run in watch mode for continuous testing (default: false)"),
        updateSnapshots: tool.schema
            .boolean()
            .optional()
            .describe("Update Jest/Vitest snapshots (default: false)"),
    },
    async execute(args, context) {
        const { pattern, coverage, watch, updateSnapshots } = args;
        const cwd = context.worktree || context.directory;
        // Detect package manager
        const packageManager = await detectPackageManager(cwd);
        // Detect test framework
        const testFramework = await detectTestFramework(cwd);
        // Build command
        let cmd = [packageManager];
        if (packageManager === "npm") {
            cmd.push("run", "test");
        }
        else {
            cmd.push("test");
        }
        // Add options based on framework
        const testArgs = [];
        if (coverage) {
            testArgs.push("--coverage");
        }
        if (watch) {
            testArgs.push("--watch");
        }
        if (updateSnapshots) {
            testArgs.push("-u");
        }
        if (pattern) {
            if (testFramework === "jest" || testFramework === "vitest") {
                testArgs.push("--testPathPattern", pattern);
            }
            else {
                testArgs.push(pattern);
            }
        }
        // Add -- separator for npm
        if (testArgs.length > 0) {
            if (packageManager === "npm") {
                cmd.push("--");
            }
            cmd.push(...testArgs);
        }
        const command = cmd.join(" ");
        return JSON.stringify({
            command,
            packageManager,
            testFramework,
            options: {
                pattern: pattern || "all tests",
                coverage: coverage || false,
                watch: watch || false,
                updateSnapshots: updateSnapshots || false,
            },
            instructions: `Run this command to execute tests:\n\n${command}`,
        });
    },
});
export default runTestsTool;
async function detectPackageManager(cwd) {
    const lockFiles = {
        "bun.lockb": "bun",
        "pnpm-lock.yaml": "pnpm",
        "yarn.lock": "yarn",
        "package-lock.json": "npm",
    };
    for (const [lockFile, pm] of Object.entries(lockFiles)) {
        if (fs.existsSync(path.join(cwd, lockFile))) {
            return pm;
        }
    }
    return "npm";
}
async function detectTestFramework(cwd) {
    const packageJsonPath = path.join(cwd, "package.json");
    if (fs.existsSync(packageJsonPath)) {
        try {
            const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, "utf-8"));
            const deps = {
                ...packageJson.dependencies,
                ...packageJson.devDependencies,
            };
            if (deps.vitest)
                return "vitest";
            if (deps.jest)
                return "jest";
            if (deps.mocha)
                return "mocha";
            if (deps.ava)
                return "ava";
            if (deps.tap)
                return "tap";
        }
        catch {
            // Ignore parse errors
        }
    }
    return "unknown";
}
//# sourceMappingURL=run-tests.js.map