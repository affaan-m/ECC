#!/usr/bin/env node
/**
 * PostToolUse Hook: Warn about console.log statements after edits
 *
 * Cross-platform (Windows, macOS, Linux)
 *
 * Runs after Edit tool use. If the edited JS/TS file contains console.log
 * statements, warns with line numbers to help remove debug statements
 * before committing.
 */

const { readFile } = require('../lib/utils');

const MAX_DIRECT_STDIN_BYTES = 16 * 1024 * 1024;
function run(data) {
  const warnings = [];
  try {
    const input = JSON.parse(data);
    const filePath = input.tool_input?.file_path;

    if (filePath && /\.(ts|tsx|js|jsx)$/.test(filePath)) {
      const content = readFile(filePath);
      if (content) {
        const matches = content
          .split('\n')
          .map((line, index) => ({ line, index }))
          .filter(item => /console\.log/.test(item.line))
          .map(item => `${item.index + 1}: ${item.line.trim()}`);

        if (matches.length > 0) {
          warnings.push(`[Hook] WARNING: console.log found in ${filePath}`);
          warnings.push(...matches.slice(0, 5));
          warnings.push('[Hook] Remove console.log before committing');
        }
      }
    }
  } catch {
    // Invalid input — pass through
  }

  return {
    stdout: data,
    stderr: warnings.join('\n'),
    exitCode: 0,
  };
}

if (require.main === module) {
  let data = '';
  let stdinBytes = 0;
  let oversized = false;
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', chunk => {
    if (oversized) return;
    stdinBytes += Buffer.byteLength(chunk, 'utf8');
    if (stdinBytes > MAX_DIRECT_STDIN_BYTES) {
      data = '';
      oversized = true;
      return;
    }
    data += chunk;
  });
  process.stdin.on('end', () => {
    if (oversized) {
      process.exitCode = 0;
      return;
    }
    const result = run(data);
    if (result.stderr) process.stderr.write(`${result.stderr}\n`);
    process.stdout.write(result.stdout);
    process.exitCode = result.exitCode;
  });
}

module.exports = { run };
