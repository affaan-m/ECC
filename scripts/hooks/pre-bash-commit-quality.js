#!/usr/bin/env node
/**
 * PreToolUse Hook: Pre-commit Quality Check
 *
 * Runs quality checks before git commit commands:
 * - Detects staged files
 * - Runs linter on staged files (if available)
 * - Checks for common issues (console.log, TODO, etc.)
 * - Validates commit message format (if provided)
 *
 * Cross-platform (Windows, macOS, Linux)
 *
 * Exit codes:
 *   0 - Success (allow commit)
 *   2 - Block commit (quality issues found)
 */

const { spawnSync } = require('child_process');
const path = require('path');
const fs = require('fs');

const MAX_STDIN = 1024 * 1024; // 1MB limit

/**
 * Detect staged files for commit
 * @returns {string[]} Array of staged file paths
 */
function getStagedFiles() {
  const result = spawnSync('git', ['diff', '--cached', '--name-only', '--diff-filter=ACMR'], {
    encoding: 'utf8',
    stdio: ['pipe', 'pipe', 'pipe']
  });
  if (result.status !== 0) {
    return [];
  }
  return result.stdout.trim().split('\n').filter(f => f.length > 0);
}

function getStagedFileContent(filePath) {
  const result = spawnSync('git', ['show', `:${filePath}`], {
    encoding: 'utf8',
    stdio: ['pipe', 'pipe', 'pipe']
  });
  if (result.status !== 0) {
    return null;
  }
  return result.stdout;
}

/**
 * Check if a file should be quality-checked
 * @param {string} filePath 
 * @returns {boolean}
 */
function shouldCheckFile(filePath) {
  const checkableExtensions = ['.js', '.jsx', '.ts', '.tsx', '.py', '.go', '.rs'];
  return checkableExtensions.some(ext => filePath.endsWith(ext));
}

/**
 * Decide whether a captured api-key value is an OBVIOUS non-secret placeholder so
 * the heuristic generic api-key rule does not emit a false positive. Deliberately
 * narrow: only suppresses whole-value env references / interpolations / angle-bracket
 * tokens and a short explicit whitelist of placeholder + env-var NAME tokens. It must
 * NOT suppress arbitrary high-entropy data (uppercase-hex, base32, digit-only, mixed
 * tokens), since the generic rule is the only net catching non-prefixed secrets and a
 * false-negative there is the safety-critical failure this hook exists to prevent.
 * @param {string} value
 * @returns {boolean}
 */
function isPlaceholderSecret(value) {
  const v = (value || '').trim();
  if (v.length === 0) return true;                                  // empty value
  if (/^process\.env\.[A-Za-z0-9_]+$/.test(v)) return true;          // entire value is a process.env.NAME reference
  if (/^\$\{[^}]*\}$/.test(v)) return true;                          // entire value is a ${...} interpolation
  if (/^<[^<>]*>$/.test(v)) return true;                             // entire value is a <PLACEHOLDER> token
  // Short explicit whitelist of placeholder + env-var NAME tokens (whole-value match only).
  // No general all-caps clause: real all-caps/hex/base32/digit secrets must still flag.
  if (/^(REPLACE_ME|CHANGE_?ME|YOUR[_-]?API[_-]?KEY|YOUR[_-]?KEY[_-]?HERE|API[_-]?KEY|SECRET|TOKEN|KEY|TODO|TBD|FIXME|XXX+)$/i.test(v)) return true;
  return false;
}

/**
 * Find issues in file content
 * @param {string} filePath
 * @returns {object[]} Array of issues found
 */
function findFileIssues(filePath) {
  const issues = [];
  
  try {
    const content = getStagedFileContent(filePath);
    if (content === null || content === undefined) {
      return issues;
    }
    const lines = content.split('\n');
    
    lines.forEach((line, index) => {
      const lineNum = index + 1;
      
      // Check for console.log
      if (line.includes('console.log') && !line.trim().startsWith('//') && !line.trim().startsWith('*')) {
        issues.push({
          type: 'console.log',
          message: `console.log found at line ${lineNum}`,
          line: lineNum,
          severity: 'warning'
        });
      }
      
      // Check for debugger statements
      if (/\bdebugger\b/.test(line) && !line.trim().startsWith('//')) {
        issues.push({
          type: 'debugger',
          message: `debugger statement at line ${lineNum}`,
          line: lineNum,
          severity: 'error'
        });
      }
      
      // Check for TODO/FIXME without issue reference
      const todoMatch = line.match(/\/\/\s*(TODO|FIXME):?\s*(.+)/);
      if (todoMatch && !todoMatch[2].match(/#\d+|issue/i)) {
        issues.push({
          type: 'todo',
          message: `TODO/FIXME without issue reference at line ${lineNum}: "${todoMatch[2].trim()}"`,
          line: lineNum,
          severity: 'info'
        });
      }
      
      // Check for hardcoded secrets (basic patterns)
      const secretPatterns = [
        { pattern: /sk-ant-[a-zA-Z0-9_-]{20,}/, name: 'Anthropic API key' },
        { pattern: /sk-[a-zA-Z0-9]{20,}/, name: 'OpenAI API key' },
        { pattern: /ghp_[a-zA-Z0-9]{36}/, name: 'GitHub PAT' },
        { pattern: /AKIA[A-Z0-9]{16}/, name: 'AWS Access Key' },
        // Capture the quoted value so obvious non-secret placeholders can be excluded
        { pattern: /api[_-]?key\s*[=:]\s*['"]([^'"]+)['"]/i, name: 'API key', valueGroup: 1 },
        // Unquoted form (API_KEY=..., api_key: ... without quotes). Scoped to a
        // single alnum/underscore/hyphen token of 12+ chars containing at least
        // one digit — real secrets are near-always alphanumeric, whereas bare
        // identifiers/expressions common in this hook's checkable languages
        // (config.apiKey, getApiKey(), process.env.API_KEY) are pure-alpha or
        // contain '.'/'(' that fall outside the character class, so they don't
        // match. Kept deliberately narrow to avoid flagging ordinary code.
        { pattern: /api[_-]?key\s*[=:]\s*(?!['"])((?=[A-Za-z0-9_-]*\d)[A-Za-z0-9_-]{12,})/i, name: 'API key', valueGroup: 1 }
      ];
      
      for (const { pattern, name, valueGroup } of secretPatterns) {
        const secretMatch = line.match(pattern);
        if (secretMatch && !(valueGroup && isPlaceholderSecret(secretMatch[valueGroup]))) {
          issues.push({
            type: 'secret',
            message: `Potential ${name} exposed at line ${lineNum}`,
            line: lineNum,
            severity: 'error'
          });
        }
      }
    });
  } catch {
    // File not readable, skip
  }
  
  return issues;
}

/**
 * Validate commit message format
 * @param {string} command 
 * @returns {object|null} Validation result or null if no message to validate
 */
function validateCommitMessage(command) {
  // Extract commit message from command (quote-aware: when quoted, capture to the
  // matching closing quote, consuming escaped chars (\") so an embedded escaped
  // quote does not truncate the subject, and allowing the OTHER quote char inside
  // the body; when unquoted, capture the full remaining tail, not just the first token)
  const messageMatch = command.match(/(?:-m|--message)[=\s]+(?:"((?:\\.|[^"\\])*)"|'((?:\\.|[^'\\])*)'|([^"']+?)\s*$)/);
  if (!messageMatch) return null;
  
  const message = messageMatch[1] ?? messageMatch[2] ?? messageMatch[3];
  const issues = [];
  
  // Check conventional commit format
  const conventionalCommit = /^(feat|fix|docs|style|refactor|test|chore|build|ci|perf|revert)(\(.+\))?:\s*.+/;
  if (!conventionalCommit.test(message)) {
    issues.push({
      type: 'format',
      message: 'Commit message does not follow conventional commit format',
      suggestion: 'Use format: type(scope): description (e.g., "feat(auth): add login flow")'
    });
  }
  
  // Check message length
  if (message.length > 72) {
    issues.push({
      type: 'length',
      message: `Commit message too long (${message.length} chars, max 72)`,
      suggestion: 'Keep the first line under 72 characters'
    });
  }
  
  // Check for lowercase first letter (conventional)
  if (conventionalCommit.test(message)) {
    const afterColon = message.split(':')[1];
    if (afterColon && /^[A-Z]/.test(afterColon.trim())) {
      issues.push({
        type: 'capitalization',
        message: 'Subject should start with lowercase after type',
        suggestion: 'Use lowercase for the first letter of the subject'
      });
    }
  }
  
  // Check for trailing period
  if (message.endsWith('.')) {
    issues.push({
      type: 'punctuation',
      message: 'Commit message should not end with a period',
      suggestion: 'Remove the trailing period'
    });
  }
  
  return { message, issues };
}

function getPathEnv() {
  const pathKey = Object.keys(process.env).find(key => key.toLowerCase() === 'path') || 'PATH';
  return process.env[pathKey] || '';
}

function isPathLike(command) {
  return command.includes(path.sep) || (process.platform === 'win32' && /[\\/]/.test(command));
}

function getExecutableCandidates(command) {
  if (process.platform !== 'win32' || path.extname(command)) {
    return [command];
  }

  const pathExt = process.env.PATHEXT || '.COM;.EXE;.BAT;.CMD';
  return [command, ...pathExt.split(';').filter(Boolean).map(ext => `${command}${ext.toLowerCase()}`)];
}

function resolveCommand(command) {
  if (isPathLike(command)) {
    return getExecutableCandidates(command).find(candidate => fs.existsSync(candidate)) || null;
  }

  for (const dir of getPathEnv().split(path.delimiter).filter(Boolean)) {
    for (const candidate of getExecutableCandidates(path.join(dir, command))) {
      if (fs.existsSync(candidate)) {
        return candidate;
      }
    }
  }

  return null;
}

const LINTER_TIMEOUT_MS = 30000;
const UNSAFE_CMD_TOKEN = /["\0\r\n]/;
const CMD_TOKEN_ENV_PREFIX = 'ECC_LINTER_TOKEN_';

function validateCmdToken(value) {
  const token = String(value);
  if (UNSAFE_CMD_TOKEN.test(token)) {
    throw new Error(`Unsafe character in Windows linter argument: ${JSON.stringify(token)}`);
  }
  return token;
}

function getLinterInvocation(command, args, platform = process.platform) {
  const useCmd = platform === 'win32' && /\.(?:cmd|bat)$/i.test(command);

  if (useCmd) {
    const environment = { ...process.env };
    for (const name of Object.keys(environment)) {
      if (name.toUpperCase().startsWith(CMD_TOKEN_ENV_PREFIX)) {
        delete environment[name];
      }
    }

    // Keep untrusted values out of cmd.exe source. Percent expansion is
    // non-recursive, so percent signs introduced by these environment values
    // stay literal. Disabling delayed expansion likewise preserves exclamation
    // marks. Quotes and line controls remain invalid because they could escape
    // the quoted token boundary or create another command line.
    const tokenReferences = [command, ...args].map((value, index) => {
      const name = `${CMD_TOKEN_ENV_PREFIX}${index}`;
      environment[name] = validateCmdToken(value);
      return `"%${name}%"`;
    });
    const commandLine = tokenReferences.join(' ');
    return {
      command: process.env.ComSpec || process.env.COMSPEC || 'cmd.exe',
      args: ['/d', '/v:off', '/s', '/c', `"${commandLine}"`],
      options: {
        encoding: 'utf8',
        stdio: ['pipe', 'pipe', 'pipe'],
        timeout: LINTER_TIMEOUT_MS,
        shell: false,
        windowsVerbatimArguments: true,
        env: environment
      }
    };
  }

  return {
    command,
    args,
    options: {
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe'],
      timeout: LINTER_TIMEOUT_MS,
      shell: false
    }
  };
}

function runLinterCommand(command, args) {
  try {
    const invocation = getLinterInvocation(command, args);
    return spawnSync(invocation.command, invocation.args, invocation.options);
  } catch (error) {
    return { status: null, stdout: '', stderr: '', error };
  }
}

function commandOutput(result) {
  return result.stdout || result.stderr || result.error?.message || '';
}

function golintSucceeded(result) {
  return result.status === 0 && !result.error && (!result.stdout || result.stdout.trim() === '');
}

/**
 * Run linter on staged files
 * @param {string[]} files 
 * @returns {object} Lint results
 */
function runLinter(files) {
  const jsFiles = files.filter(f => /\.(js|jsx|ts|tsx)$/.test(f));
  const pyFiles = files.filter(f => f.endsWith('.py'));
  const goFiles = files.filter(f => f.endsWith('.go'));
  
  const results = {
    eslint: null,
    pylint: null,
    golint: null
  };
  
  // Run ESLint if available
  if (jsFiles.length > 0) {
    const eslintBin = process.platform === 'win32' ? 'eslint.cmd' : 'eslint';
    const eslintPath = path.join(process.cwd(), 'node_modules', '.bin', eslintBin);
    if (fs.existsSync(eslintPath)) {
      const result = runLinterCommand(eslintPath, jsFiles);
      results.eslint = {
        success: result.status === 0,
        output: commandOutput(result)
      };
    }
  }
  
  // Run Pylint if available
  if (pyFiles.length > 0) {
    try {
      const pylintPath = resolveCommand('pylint');
      if (!pylintPath) {
        results.pylint = null;
      } else {
        const result = runLinterCommand(pylintPath, ['--output-format=text', ...pyFiles]);
        results.pylint = {
          success: result.status === 0,
          output: commandOutput(result)
        };
      }
    } catch {
      // Pylint not available
    }
  }
  
  // Run golint if available
  if (goFiles.length > 0) {
    try {
      const golintPath = resolveCommand('golint');
      if (!golintPath) {
        results.golint = null;
      } else {
        const result = runLinterCommand(golintPath, goFiles);
        results.golint = {
          success: golintSucceeded(result),
          output: commandOutput(result)
        };
      }
    } catch {
      // golint not available
    }
  }
  
  return results;
}

/**
 * Core logic — exported for direct invocation
 * @param {string} rawInput - Raw JSON string from stdin
 * @returns {{output:string, exitCode:number}} Pass-through output and exit code
 */
function evaluate(rawInput) {
  try {
    const input = JSON.parse(rawInput);
    const command = input.tool_input?.command || '';
    
    // Only run for git commit commands
    if (!command.includes('git commit')) {
      return { output: rawInput, exitCode: 0 };
    }
    
    // Check if this is an amend (skip checks for amends to avoid blocking)
    if (command.includes('--amend')) {
      return { output: rawInput, exitCode: 0 };
    }
    
    // Get staged files
    const stagedFiles = getStagedFiles();
    
    if (stagedFiles.length === 0) {
      console.error('[Hook] No staged files found. Use "git add" to stage files first.');
      return { output: rawInput, exitCode: 0 };
    }
    
    console.error(`[Hook] Checking ${stagedFiles.length} staged file(s)...`);
    
    // Check each staged file
    const filesToCheck = stagedFiles.filter(shouldCheckFile);
    let totalIssues = 0;
    let errorCount = 0;
    let warningCount = 0;
    let infoCount = 0;
    
    for (const file of filesToCheck) {
      const fileIssues = findFileIssues(file);
      if (fileIssues.length > 0) {
        console.error(`\n[FILE] ${file}`);
        for (const issue of fileIssues) {
          const label = issue.severity === 'error' ? 'ERROR' : issue.severity === 'warning' ? 'WARNING' : 'INFO';
          console.error(`  ${label} Line ${issue.line}: ${issue.message}`);
          totalIssues++;
          if (issue.severity === 'error') errorCount++;
          if (issue.severity === 'warning') warningCount++;
          if (issue.severity === 'info') infoCount++;
        }
      }
    }
    
    // Validate commit message if provided
    const messageValidation = validateCommitMessage(command);
    if (messageValidation && messageValidation.issues.length > 0) {
      console.error('\nCommit Message Issues:');
      for (const issue of messageValidation.issues) {
        console.error(`  WARNING ${issue.message}`);
        if (issue.suggestion) {
          console.error(`     TIP ${issue.suggestion}`);
        }
        totalIssues++;
        warningCount++;
      }
    }
    
    // Run linter
    const lintResults = runLinter(filesToCheck);
    
    if (lintResults.eslint && !lintResults.eslint.success) {
      console.error('\nESLint Issues:');
      console.error(lintResults.eslint.output);
      totalIssues++;
      errorCount++;
    }
    
    if (lintResults.pylint && !lintResults.pylint.success) {
      console.error('\nPylint Issues:');
      console.error(lintResults.pylint.output);
      totalIssues++;
      errorCount++;
    }
    
    if (lintResults.golint && !lintResults.golint.success) {
      console.error('\ngolint Issues:');
      console.error(lintResults.golint.output);
      totalIssues++;
      errorCount++;
    }
    
    // Summary
    if (totalIssues > 0) {
      console.error(`\nSummary: ${totalIssues} issue(s) found (${errorCount} error(s), ${warningCount} warning(s), ${infoCount} info)`);
      
      if (errorCount > 0) {
        console.error('\n[Hook] ERROR: Commit blocked due to critical issues. Fix them before committing.');
        return { output: rawInput, exitCode: 2 };
      } else {
        console.error('\n[Hook] WARNING: Warnings found. Consider fixing them, but commit is allowed.');
        console.error('[Hook] To bypass these checks, use: git commit --no-verify');
      }
    } else {
      console.error('\n[Hook] PASS: All checks passed!');
    }
    
  } catch (error) {
    console.error(`[Hook] Error: ${error.message}`);
    // Non-blocking on error
  }
  
  return { output: rawInput, exitCode: 0 };
}

function run(rawInput) {
  const result = evaluate(rawInput);
  return {
    stdout: result.output,
    exitCode: result.exitCode,
  };
}

// ── stdin entry point ────────────────────────────────────────────
if (require.main === module) {
  let data = '';
  process.stdin.setEncoding('utf8');
  
  process.stdin.on('data', chunk => {
    if (data.length < MAX_STDIN) {
      const remaining = MAX_STDIN - data.length;
      data += chunk.substring(0, remaining);
    }
  });
  
  process.stdin.on('end', () => {
    const result = evaluate(data);
    process.stdout.write(result.output);
    process.exit(result.exitCode);
  });
}

module.exports = {
  run,
  evaluate,
  validateCommitMessage,
  findFileIssues,
  isPlaceholderSecret,
  getLinterInvocation,
  golintSucceeded,
  runLinter
};
