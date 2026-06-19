/**
 * Everything Claude Code (ECC) Plugin for OpenCode
 *
 * This package provides a complete OpenCode plugin with:
 * - 13 specialized agents (planner, architect, code-reviewer, etc.)
 * - 31 commands (/plan, /tdd, /code-review, etc.)
 * - Plugin hooks (auto-format, TypeScript check, console.log warning, env injection, etc.)
 * - Custom tools (run-tests, check-coverage, security-audit, format-code, lint-check, git-summary)
 * - 37 skills (coding-standards, security-review, tdd-workflow, etc.)
 *
 * Usage:
 *
 * Option 1: Install via npm
 * ```bash
 * npm install ecc-universal
 * ```
 *
 * Then add to your opencode.json:
 * ```json
 * {
 *   "plugin": ["ecc-universal"]
 * }
 * ```
 *
 * Option 2: Clone and use directly
 * ```bash
 * git clone https://github.com/affaan-m/everything-claude-code
 * cd everything-claude-code
 * opencode
 * ```
 *
 * @packageDocumentation
 */

// Export the main plugin
export { ECCHooksPlugin, default } from "./plugins/index.js"

// Export individual components for selective use
export * from "./plugins/index.js"

// Version export
export const VERSION = "1.6.0"

// Plugin metadata
export const metadata = {
  name: "ecc-universal",
  version: VERSION,
  description: "Everything Claude Code plugin for OpenCode",
  author: "affaan-m",
  features: {
    agents: 65,
    commands: 85,
    skills: 262,
    hookEvents: [
      "file.edited",
      "tool.execute.before",
      "tool.execute.after",
      "session.created",
      "session.idle",
      "session.deleted",
      "file.watcher.updated",
      "permission.ask",
      "todo.updated",
      "shell.env",
      "experimental.session.compacting",
    ],
    customTools: [
      "run-tests",
      "check-coverage",
      "security-audit",
      "format-code",
      "lint-check",
      "git-summary",
    ],
  },
}
