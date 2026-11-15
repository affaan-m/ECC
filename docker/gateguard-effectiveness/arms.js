'use strict';

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

// see docs/gateguard/question-effectiveness.md#arms
const ARMS = Object.freeze({
  off: Object.freeze({ gate: false }),
  gate: Object.freeze({ gate: true, tree: 'candidate' }),
  'minus-target': Object.freeze({ gate: true, tree: 'candidate', dropTarget: true }),
  placebo: Object.freeze({ gate: true, tree: 'candidate', placebo: true }),
  main: Object.freeze({ gate: true, tree: 'main' })
});

const DEFAULT_ARMS = Object.freeze(['off', 'gate', 'minus-target', 'placebo']);
const TRIAL_FILE = 'hook-run.json';
const ARM_HOOK = 'scripts/hooks/gateguard-arm.js';
const WRAPPER = `'use strict';
const fs = require('fs');
const path = require('path');

function trialConfig(rawInput) {
  const data = typeof rawInput === 'string' ? JSON.parse(rawInput) : rawInput;
  for (const start of [process.env.CLAUDE_PROJECT_DIR, data && data.cwd]) {
    let dir = typeof start === 'string' && start ? path.resolve(start) : null;
    for (let depth = 0; dir && depth < 8; depth++) {
      const file = path.join(dir, '${TRIAL_FILE}');
      if (fs.existsSync(file)) return JSON.parse(fs.readFileSync(file, 'utf8'));
      const parent = path.dirname(dir);
      dir = parent === dir ? null : parent;
    }
  }
  throw new Error('${TRIAL_FILE} not found');
}

function run(rawInput) {
  const config = trialConfig(rawInput);
  process.env.GATEGUARD_STATE_DIR = config.stateDir;
  process.env.GATEGUARD_METRICS = '1';
  if (config.patch) require('../../arm-patch').applyArm(config.patch, require('../lib/gateguard-target-class'));
  return require('./gateguard-fact-force').run(rawInput);
}

module.exports = { run };
`;

function git(repoRoot, args, spawn = spawnSync) {
  const result = spawn('git', ['-C', repoRoot, ...args], { encoding: 'utf8', shell: false, timeout: 60000 });
  if (result.status !== 0 || result.error) throw new Error(`git ${args[0]} failed: ${String(result.stderr || result.error).trim()}`);
  return result.stdout;
}

/** Resolves a ref to a full commit sha. */
function resolveRef(repoRoot, ref) {
  return git(repoRoot, ['rev-parse', '--verify', `${ref}^{commit}`]).trim();
}

/** Extracts scripts/ at a commit into dest and adds the arm wrapper; returns dest. */
function materializeTree(repoRoot, sha, dest, spawn = spawnSync) {
  fs.mkdirSync(dest, { recursive: true });
  const tarName = 'scripts.tar';
  git(repoRoot, ['archive', '--format=tar', '-o', path.join(dest, tarName), sha, 'scripts'], spawn);
  // Name the archive relatively and run tar with dest as cwd, so no argument carries a
  // "C:\..." drive letter. GNU tar (Git Bash / MSYS on Windows) reads an archive argument
  // containing a colon as a "host:path" remote spec and dies with "Cannot connect to C:
  // resolve failed"; bsdtar (C:\Windows\system32\tar.exe) does not, which is why the
  // absolute path only broke under GNU tar. A relative -f plus cwd extracts identically
  // under both and makes -C unnecessary.
  const extract = spawn('tar', ['-xf', tarName], { cwd: dest, encoding: 'utf8', shell: false, timeout: 60000 });
  fs.rmSync(path.join(dest, tarName), { force: true });
  if (extract.status !== 0 || extract.error) throw new Error(`tar failed: ${String(extract.stderr || extract.error).trim()}`);
  fs.copyFileSync(path.join(__dirname, 'arm-patch.js'), path.join(dest, 'arm-patch.js'));
  fs.writeFileSync(path.join(dest, ...ARM_HOOK.split('/')), WRAPPER);
  return dest;
}

const forwardSlashes = file => file.split(path.sep).join('/');

/** Claude Code settings registering a tree's gate on the same tools as hooks/hooks.json. */
function armSettings(root) {
  if (!root) return { hooks: {} };
  const runner = forwardSlashes(path.join(root, 'scripts', 'hooks', 'run-with-flags.js'));
  const command = id => `node "${runner}" ${id} ${ARM_HOOK} standard,strict`;
  return {
    hooks: {
      PreToolUse: [
        { matcher: 'Edit|Write|MultiEdit|NotebookEdit', hooks: [{ type: 'command', command: command('pre:edit-write:gateguard-fact-force') }] },
        { matcher: 'Bash|PowerShell', hooks: [{ type: 'command', command: command('pre:bash:gateguard-fact-force') }] }
      ]
    }
  };
}

/** Question-table patch for one arm and scenario, or null when the gate runs unmodified. */
function trialPatch(armName, scenario) {
  const arm = ARMS[armName];
  if (!arm) throw new Error(`unknown arm: ${armName}`);
  if (arm.placebo) return { placebo: true };
  if (arm.dropTarget) return { drop: scenario.targetQuestions.slice() };
  return null;
}

module.exports = { ARMS, DEFAULT_ARMS, TRIAL_FILE, ARM_HOOK, resolveRef, materializeTree, armSettings, trialPatch };
