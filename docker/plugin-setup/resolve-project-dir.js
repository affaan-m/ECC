#!/usr/bin/env node

'use strict';

const path = require('path');

const WORKSPACE_ROOT = '/workspace';

function resolveProjectDir(candidate) {
  if (
    typeof candidate !== 'string'
    || !path.posix.isAbsolute(candidate)
    || /[\0\r\n]/.test(candidate)
  ) {
    throw new Error('ECC_PROJECT_DIR must be an absolute path within /workspace.');
  }

  const resolved = path.posix.resolve(candidate);
  if (resolved === WORKSPACE_ROOT || !resolved.startsWith(`${WORKSPACE_ROOT}/`)) {
    throw new Error('ECC_PROJECT_DIR must be a child path within /workspace.');
  }
  return resolved;
}

function main() {
  try {
    process.stdout.write(`${resolveProjectDir(process.argv[2])}\n`);
  } catch (error) {
    process.stderr.write(`Error: ${error.message}\n`);
    process.exitCode = 2;
  }
}

if (require.main === module) main();

module.exports = { resolveProjectDir };
