/**
 * ECC Plugin Hooks for OpenCode
 *
 * This plugin translates Claude Code hooks to OpenCode's plugin system.
 * OpenCode's plugin system is MORE sophisticated than Claude Code with 20+ events
 * compared to Claude Code's 3 phases (PreToolUse, PostToolUse, Stop).
 *
 * Hook Event Mapping:
 * - PreToolUse → tool.execute.before
 * - PostToolUse → tool.execute.after
 * - Stop → session.idle / session.status
 * - SessionStart → session.created
 * - SessionEnd → session.deleted
 */
import type { PluginInput } from "@opencode-ai/plugin";
type ECCHooksPluginFn = (input: PluginInput) => Promise<Record<string, unknown>>;
export declare const ECCHooksPlugin: ECCHooksPluginFn;
export default ECCHooksPlugin;
//# sourceMappingURL=ecc-hooks.d.ts.map