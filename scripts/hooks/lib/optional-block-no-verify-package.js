'use strict';

/**
 * Optional second opinion from the project's own `block-no-verify` npm package.
 *
 * ECC keeps hook runtime dependency-free, so the package is never a dependency
 * of ECC. It is used only when the user's project has it installed
 * (devDependency, >= 1.4.1). It is resolved from the project directory, never
 * from ECC, a global install, or the network. Any failure means "no opinion".
 */

const Module = require('module');
const path = require('path');

const DISABLE_VALUES = new Set(['0', 'false', 'off', 'disabled', 'disable']);

function isDisabled() {
  return DISABLE_VALUES.has(String(process.env.ECC_BLOCK_NO_VERIFY_PACKAGE || '').trim().toLowerCase());
}

function resolveProjectDir(rawInput) {
  if (process.env.CLAUDE_PROJECT_DIR) return process.env.CLAUDE_PROJECT_DIR;
  try {
    const parsed = JSON.parse(String(rawInput || '').trim());
    if (parsed && typeof parsed.cwd === 'string' && parsed.cwd) return parsed.cwd;
  } catch {
    // plain-text input carries no cwd
  }
  return process.cwd();
}

/**
 * @param {string} command Shell command already allowed by ECC's own scanner.
 * @param {string} rawInput Raw hook payload (used only to find the project cwd).
 * @returns {{blocked: true, reason: string}|{blocked: false}}
 */
function checkWithProjectPackage(command, rawInput) {
  try {
    if (isDisabled()) return { blocked: false };
    const projectRequire = Module.createRequire(path.join(resolveProjectDir(rawInput), 'package.json'));
    const pkg = projectRequire('block-no-verify');
    if (!pkg || typeof pkg.checkCommand !== 'function') return { blocked: false };
    const result = pkg.checkCommand(command);
    if (result && result.blocked === true) {
      const detail = typeof result.reason === 'string' && result.reason ? result.reason : 'hook bypass detected';
      return { blocked: true, reason: `BLOCKED: block-no-verify package (project dependency): ${detail}` };
    }
  } catch {
    // absent, unloadable, or throwing package: ECC's own verdict stands
  }
  return { blocked: false };
}

module.exports = { checkWithProjectPackage };
