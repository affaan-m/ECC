/**
 * ECC Custom Tools for OpenCode
 *
 * These tools extend OpenCode with additional capabilities.
 */

// OpenCode loads these sources in place; tsc rewrites .ts imports for dist.
export { default as runTests } from "./run-tests.ts"
export { default as checkCoverage } from "./check-coverage.ts"
export { default as securityAudit } from "./security-audit.ts"
export { default as formatCode } from "./format-code.ts"
export { default as lintCheck } from "./lint-check.ts"
export { default as gitSummary } from "./git-summary.ts"
export { default as changedFiles } from "./changed-files.ts"
export { default as dependencyAnalyzer } from "./dependency-analyzer.ts"
