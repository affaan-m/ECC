/**
 * ECC Plugin for OpenCode
 *
 * This package provides the published ECC OpenCode plugin module:
 * - Plugin hooks (auto-format, TypeScript check, console.log warning, env injection, etc.)
 * - Custom tools (run-tests, check-coverage, security-audit, format-code, lint-check, git-summary)
 * - Bundled reference config/assets for the wider ECC OpenCode setup
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
 * That enables the published plugin module only. For ECC commands, agents,
 * prompts, and instructions, use this repository's `.opencode/opencode.json`
 * as a base or copy the bundled `.opencode/` assets into your project.
 *
 * Option 2: Clone and use directly
 * ```bash
 * git clone https://github.com/affaan-m/ECC
 * cd ECC
 * opencode
 * ```
 *
 * @packageDocumentation
 */
export { ECCHooksPlugin, default } from "./plugins/index.js";
export * from "./plugins/index.js";
export declare const VERSION = "1.6.0";
export declare const metadata: {
    name: string;
    version: string;
    description: string;
    author: string;
    features: {
        agents: number;
        commands: number;
        skills: number;
        configAssets: boolean;
        hookEvents: string[];
        customTools: string[];
    };
};
//# sourceMappingURL=index.d.ts.map