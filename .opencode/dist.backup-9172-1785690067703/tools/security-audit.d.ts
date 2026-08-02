/**
 * Security Audit Tool
 *
 * Custom OpenCode tool to run security audits on dependencies and code.
 * Combines npm audit, secret scanning, and OWASP checks.
 *
 * NOTE: This tool SCANS for security anti-patterns - it does not introduce them.
 * The regex patterns below are used to DETECT potential issues in user code.
 */
import { type ToolDefinition } from "@opencode-ai/plugin/tool";
declare const securityAuditTool: ToolDefinition;
export default securityAuditTool;
//# sourceMappingURL=security-audit.d.ts.map