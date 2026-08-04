#!/usr/bin/env node
/**
 * Reject unsafe GitHub Actions patterns that execute or checkout untrusted PR code
 * from privileged events such as workflow_run or pull_request_target.
 */

const fs = require('fs');
const path = require('path');

const DEFAULT_WORKFLOWS_DIR = path.join(__dirname, '../../.github/workflows');

const RULES = [
  {
    event: 'workflow_run',
    eventPattern: /\bworkflow_run\s*:/m,
    description: 'workflow_run must not checkout an untrusted workflow_run head ref/repository',
    expressionPattern: /\$\{\{\s*github\.event\.workflow_run\.(?:head_branch|head_sha|head_repository(?:\.[A-Za-z0-9_.]+)?)\s*\}\}|\$\{\{\s*github\.event\.workflow_run\.pull_requests\[\d+\]\.head\.(?:ref|sha|repo\.full_name)\s*\}\}/g,
  },
  {
    event: 'pull_request_target',
    eventPattern: /\bpull_request_target\s*:/m,
    description: 'pull_request_target must not checkout an untrusted pull_request head ref/repository',
    expressionPattern: /\$\{\{\s*github\.event\.pull_request\.head\.(?:ref|sha|repo\.full_name)\s*\}\}/g,
    // Even without the standard `github.event.pull_request.head.*` expression,
    // a checkout under `pull_request_target` that fetches a `refs/pull/<N>/{head,merge}`
    // ref pulls attacker-controlled code into a workflow with write-scoped
    // tokens. GitHub's security guidance treats both forms equivalently;
    // we match the ref value directly so any interpolation that resolves
    // to such a ref (`refs/pull/${{ github.event.pull_request.number }}/merge`,
    // a hardcoded `refs/pull/123/head`, a `${{ env.X }}` that the maintainer
    // assumes is safe, etc.) trips the same rule.
    refPattern: /^\s*ref:\s*['"]?[^'"\n]*refs\/(?:remotes\/)?pull\/[^'"\n\s]+/m,
  },
];

const WRITE_PERMISSION_PATTERN = /^\s*(?:contents|issues|pull-requests|actions|checks|deployments|discussions|id-token|packages|pages|repository-projects|security-events|statuses):\s*write\b/m;
// `permissions: write-all` is GitHub Actions' shorthand for granting every
// scope write access. The named-scope pattern above misses it because there
// is no scope name on the left of the colon — just the literal `write-all`
// value at the permissions key. Treat both as equivalent for the purposes
// of the persist-credentials gate below. The optional single/double quotes
// match valid YAML `permissions: "write-all"` / `'write-all'` forms.
const WRITE_ALL_PATTERN = /^\s*permissions:\s*["']?write-all["']?\s*$/m;
const NPM_AUDIT_PATTERN = /\bnpm\s+audit\b(?!\s+signatures\b)/;
const NPM_AUDIT_SIGNATURES_PATTERN = /\bnpm\s+audit\s+signatures\b/;
const ACTIONS_CACHE_PATTERN = /uses:\s*['"]?actions\/cache@/m;
const ID_TOKEN_WRITE_PATTERN = /^\s*id-token:\s*write\b/m;
const TOP_LEVEL_JOBS_PATTERN = /^jobs:\s*$/m;
const UNSAFE_INSTALL_PATTERNS = [
  {
    pattern: /\bnpm\s+ci\b(?![^\n]*--ignore-scripts)/g,
    description: 'npm ci must include --ignore-scripts',
  },
  {
    pattern: /\bpnpm\s+install\b(?![^\n]*--ignore-scripts)/g,
    description: 'pnpm install must include --ignore-scripts',
  },
  {
    pattern: /\byarn\s+install\b(?![^\n]*--mode=skip-build)/g,
    description: 'yarn install must use --mode=skip-build',
  },
  {
    pattern: /\bbun\s+install\b(?![^\n]*--ignore-scripts)/g,
    description: 'bun install must include --ignore-scripts',
  },
];

function getWorkflowFiles(workflowsDir) {
  if (!fs.existsSync(workflowsDir)) {
    return [];
  }

  return fs.readdirSync(workflowsDir)
    .filter(file => /\.(?:yml|yaml)$/i.test(file))
    .map(file => path.join(workflowsDir, file))
    .sort();
}

function getLineNumber(source, index) {
  return source.slice(0, index).split(/\r?\n/).length;
}

function extractCheckoutSteps(source) {
  const blocks = [];
  const lines = source.split(/\r?\n/);
  let current = null;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const stepStart = line.match(/^(\s*)-\s+/);

    if (stepStart) {
      if (current) {
        blocks.push(current);
      }

      current = {
        indent: stepStart[1].length,
        startLine: i + 1,
        lines: [line],
      };
      continue;
    }

    if (current) {
      current.lines.push(line);
    }
  }

  if (current) {
    blocks.push(current);
  }

  return blocks
    .map(block => ({
      startLine: block.startLine,
      text: block.lines.join('\n'),
    }))
    .filter(block => /uses:\s*['"]?actions\/checkout@/m.test(block.text));
}

function findViolations(filePath, source) {
  const violations = [];
  const checkoutSteps = extractCheckoutSteps(source);
  const jobsIndex = source.search(TOP_LEVEL_JOBS_PATTERN);
  const workflowHeader = jobsIndex >= 0 ? source.slice(0, jobsIndex) : source;

  for (const rule of RULES) {
    if (!rule.eventPattern.test(source)) {
      continue;
    }

    for (const step of checkoutSteps) {
      // Track whether the expression-based rule already produced a
      // violation for this step. If it did, skip the refPattern fallback
      // — a `refs/pull/${{ github.event.pull_request.head.sha }}/merge`
      // value matches both patterns under the same rule, and the second
      // push would print a duplicate ERROR line that says exactly the
      // same thing with a different `expression:` echo.
      let stepFlagged = false;
      for (const match of step.text.matchAll(rule.expressionPattern)) {
        violations.push({
          filePath,
          event: rule.event,
          description: rule.description,
          expression: match[0],
          line: step.startLine + getLineNumber(step.text, match.index) - 1,
        });
        stepFlagged = true;
      }
      if (rule.refPattern && !stepFlagged) {
        const refMatch = step.text.match(rule.refPattern);
        if (refMatch) {
          violations.push({
            filePath,
            event: rule.event,
            description: rule.description,
            expression: refMatch[0].trim(),
            line: step.startLine + getLineNumber(step.text, refMatch.index) - 1,
          });
        }
      }
    }
  }

  if (WRITE_PERMISSION_PATTERN.test(source) || WRITE_ALL_PATTERN.test(source)) {
    for (const step of checkoutSteps) {
      if (!/persist-credentials:\s*['"]?false['"]?\b/m.test(step.text)) {
        violations.push({
          filePath,
          event: 'write-permission checkout',
          description: 'workflows with write permissions must disable checkout credential persistence',
          expression: 'actions/checkout without persist-credentials: false',
          line: step.startLine,
        });
      }
    }

  }

  if (ID_TOKEN_WRITE_PATTERN.test(workflowHeader)) {
    violations.push({
      filePath,
      event: 'workflow-scoped id-token',
      description: 'id-token: write must be scoped to a publish-only job, not the entire workflow',
      expression: 'top-level id-token: write',
      line: getLineNumber(source, source.search(ID_TOKEN_WRITE_PATTERN)),
    });
  }

  for (const installRule of UNSAFE_INSTALL_PATTERNS) {
    for (const match of source.matchAll(installRule.pattern)) {
      violations.push({
        filePath,
        event: 'dependency install scripts',
        description: `workflow dependency installs must not run lifecycle scripts: ${installRule.description}`,
        expression: match[0],
        line: getLineNumber(source, match.index),
      });
    }
  }

  if (ID_TOKEN_WRITE_PATTERN.test(source) && ACTIONS_CACHE_PATTERN.test(source)) {
    violations.push({
      filePath,
      event: 'id-token cache',
      description: 'workflows with id-token: write must not restore or save shared dependency caches',
      expression: 'id-token: write + actions/cache',
      line: getLineNumber(source, source.search(ID_TOKEN_WRITE_PATTERN)),
    });
  }

  if (ACTIONS_CACHE_PATTERN.test(source)) {
    violations.push({
      filePath,
      event: 'dependency cache',
      description: 'GitHub Actions dependency caches are disabled during active supply-chain hardening',
      expression: 'actions/cache',
      line: getLineNumber(source, source.search(ACTIONS_CACHE_PATTERN)),
    });
  }

  if (/\bpull_request_target\s*:/m.test(source) && ACTIONS_CACHE_PATTERN.test(source)) {
    violations.push({
      filePath,
      event: 'pull_request_target cache',
      description: 'pull_request_target workflows must not restore or save shared dependency caches',
      expression: 'pull_request_target + actions/cache',
      line: getLineNumber(source, source.search(/\bpull_request_target\s*:/m)),
    });
  }

  if (NPM_AUDIT_PATTERN.test(source) && !NPM_AUDIT_SIGNATURES_PATTERN.test(source)) {
    violations.push({
      filePath,
      event: 'npm audit signatures',
      description: 'workflows that run npm audit must also verify registry signatures',
      expression: 'npm audit without npm audit signatures',
      line: getLineNumber(source, source.search(NPM_AUDIT_PATTERN)),
    });
  }

  return violations;
}

function validateWorkflowSecurity(workflowsDir = DEFAULT_WORKFLOWS_DIR) {
  const files = getWorkflowFiles(workflowsDir);
  const violations = [];

  for (const filePath of files) {
    const source = fs.readFileSync(filePath, 'utf8');
    violations.push(...findViolations(filePath, source));
  }

  if (violations.length > 0) {
    for (const violation of violations) {
      console.error(
        `ERROR: ${path.basename(violation.filePath)}:${violation.line} - ${violation.description}`,
      );
      console.error(`  Unsafe expression: ${violation.expression}`);
    }
    return 1;
  }

  console.log(`Validated workflow security for ${files.length} workflow files`);
  return 0;
}

if (require.main === module) {
  process.exit(validateWorkflowSecurity(process.env.ECC_WORKFLOWS_DIR || DEFAULT_WORKFLOWS_DIR));
}

module.exports = {
  DEFAULT_WORKFLOWS_DIR,
  extractCheckoutSteps,
  findViolations,
  validateWorkflowSecurity,
};
