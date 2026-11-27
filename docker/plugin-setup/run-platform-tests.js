#!/usr/bin/env node

'use strict';

const path = require('path');
const { spawnSync } = require('child_process');

const repoRoot = path.resolve(__dirname, '..', '..');
const CHILD_PROCESS_TIMEOUT_MS = 5 * 60 * 1000;
const testFiles = [
  'tests/lib/install-manifests.test.js',
  'tests/lib/install-targets.test.js',
  'tests/lib/install-executor.test.js',
];
const excludedGitEnvKeys = new Set([
  'GIT_DIR',
  'GIT_WORK_TREE',
  'GIT_INDEX_FILE',
  'GIT_COMMON_DIR',
  'GIT_PREFIX',
]);
const childEnv = Object.fromEntries(
  Object.entries(process.env).filter(([key]) => !excludedGitEnvKeys.has(key))
);

console.log(`Running ECC install tests on ${process.platform}/${process.arch}`);

for (const testFile of testFiles) {
  const result = spawnSync(process.execPath, [path.join(repoRoot, testFile)], {
    cwd: repoRoot,
    env: childEnv,
    shell: false,
    stdio: 'inherit',
    timeout: CHILD_PROCESS_TIMEOUT_MS,
  });

  if (result.error) {
    console.error(`Unable to run ${testFile}: ${result.error.message}`);
    process.exit(1);
  }

  if (result.status !== 0) {
    console.error(`${testFile} exited with status ${result.status}`);
    process.exit(result.status ?? 1);
  }
}
