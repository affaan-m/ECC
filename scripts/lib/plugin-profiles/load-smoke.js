/**
 * The staged-tree load smoke test.
 *
 * Static verification proves every literal relative require in the staged
 * tree resolves inside the tree. It cannot say anything about a dynamic
 * `require(expr)`, whose target is only known while the code runs. This
 * module runs the containing file from inside the staged tree, so a dynamic
 * require either loads there or refuses the carrier.
 *
 * Executing shipped code is a real action, so what runs is bounded:
 *
 * - A file that advertises `--help` is run as `node <file> --help`. That
 *   loads the whole module graph, top-level dynamic requires included, and
 *   exits without doing work. This is the preferred shape.
 * - A file with no shebang is a library module and is loaded with
 *   `require()`.
 * - A shebang file with no `--help` is run with no arguments, stdin closed.
 *   This shape is used ONLY for a file that contains a dynamic require,
 *   because there is no other way to clear one, and the carrier is about to
 *   ship and run that file anyway. It is never used to opportunistically
 *   smoke an entrypoint.
 *
 * Every child gets `cwd` and `CLAUDE_PLUGIN_ROOT` set to the staged root, no
 * stdin, and a 10s timeout.
 *
 * A missing *bare* specifier (an npm package) is reported separately from a
 * failure. Carriers have never shipped `node_modules`, and the dependency
 * closure has always been defined over repo-relative requires only. Such a
 * load is recorded as an external dependency so the receipt names it, rather
 * than silently passing or refusing every carrier that ships the script.
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const SMOKE_TIMEOUT_MS = 10000;
const HELP_FLAG_PATTERN = /--help/;
const SHEBANG_PATTERN = /^#!/;
const MISSING_MODULE_PATTERN = /Cannot find module '([^']+)'/;

/**
 * Decide how a staged file may be exercised.
 *
 * @param {string} source File contents.
 * @param {boolean} mustRun Whether the file has to run to clear a dynamic
 *   require, which is the only case that justifies the bare shape.
 * @returns {'help'|'require'|'bare'|'skip'} The applicable smoke shape.
 */
function classifySmokeShape(source, mustRun = false) {
  if (HELP_FLAG_PATTERN.test(source)) {
    return 'help';
  }
  if (!SHEBANG_PATTERN.test(source)) {
    return 'require';
  }
  return mustRun ? 'bare' : 'skip';
}

/**
 * Read a child's failure into a structured outcome, separating a missing npm
 * package from a real load failure.
 *
 * @param {object} result spawnSync result.
 * @returns {{ok: boolean, external: string|null, message: string}} Outcome.
 */
function readChildOutcome(result) {
  if (result.error) {
    return { ok: false, external: null, message: result.error.message };
  }
  if (result.status === 0) {
    return { ok: true, external: null, message: '' };
  }

  const output = `${result.stderr || ''}\n${result.stdout || ''}`;
  const missing = MISSING_MODULE_PATTERN.exec(output);
  if (missing && !missing[1].startsWith('.') && !path.isAbsolute(missing[1])) {
    return { ok: false, external: missing[1], message: `missing npm dependency "${missing[1]}"` };
  }
  const detail = missing
    ? `cannot find module '${missing[1]}'`
    : String(result.stderr || result.stdout || '').trim().split('\n').filter(Boolean).pop();
  return { ok: false, external: null, message: detail || `exit ${result.status}` };
}

/**
 * Run one child process under the staged-tree environment.
 *
 * @param {Array<string>} args Node arguments.
 * @param {string} stagingRoot Staged plugin root.
 * @param {object} [extraEnv] Additional environment variables.
 * @returns {{ok: boolean, external: string|null, message: string}} Outcome.
 */
function runChild(args, stagingRoot, extraEnv = {}) {
  return readChildOutcome(spawnSync(process.execPath, args, {
    cwd: stagingRoot,
    encoding: 'utf8',
    timeout: SMOKE_TIMEOUT_MS,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, ...extraEnv, CLAUDE_PLUGIN_ROOT: stagingRoot },
  }));
}

/**
 * Smoke-test one staged file.
 *
 * @param {string} stagingRoot Staged plugin root.
 * @param {string} relPath POSIX path relative to the staged root.
 * @param {boolean} mustRun Whether a dynamic require depends on this result.
 * @returns {{file: string, shape: string, smokeTested: boolean, external: string|null, error: string|null}}
 */
function smokeTestFile(stagingRoot, relPath, mustRun = false) {
  const absPath = path.join(stagingRoot, ...relPath.split('/'));
  const shape = classifySmokeShape(fs.readFileSync(absPath, 'utf8'), mustRun);

  if (shape === 'skip') {
    return { file: relPath, shape, smokeTested: false, external: null, error: null };
  }

  let outcome;
  if (shape === 'help') {
    outcome = runChild([absPath, '--help'], stagingRoot);
  } else if (shape === 'bare') {
    outcome = runChild([absPath], stagingRoot);
  } else {
    outcome = runChild(['-e', 'require(process.env.ECC_LOAD_SMOKE_TARGET);'], stagingRoot,
      { ECC_LOAD_SMOKE_TARGET: absPath });
  }

  return {
    file: relPath,
    shape,
    smokeTested: outcome.ok,
    external: outcome.external,
    error: outcome.ok ? null : outcome.message,
  };
}

/**
 * Run the load smoke over a set of staged files.
 *
 * @param {string} stagingRoot Staged plugin root.
 * @param {Array<string>} relPaths Staged, POSIX-relative file paths.
 * @param {Set<string>} [mustRun] Paths whose result clears a dynamic require.
 * @returns {Array<object>} One result per existing file, sorted by path.
 */
function runLoadSmoke(stagingRoot, relPaths, mustRun = new Set()) {
  const results = [];
  for (const relPath of [...new Set(relPaths)].sort()) {
    if (!fs.existsSync(path.join(stagingRoot, ...relPath.split('/')))) {
      continue;
    }
    results.push(smokeTestFile(stagingRoot, relPath, mustRun.has(relPath)));
  }
  return results;
}

module.exports = {
  SMOKE_TIMEOUT_MS,
  classifySmokeShape,
  readChildOutcome,
  smokeTestFile,
  runLoadSmoke,
};
