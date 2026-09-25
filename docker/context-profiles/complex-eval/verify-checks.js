'use strict';
// Development tool: validates the hidden graders end to end. For every task the
// reference solution (reference/<task>/ overlaid on the fixture) must score 1.0,
// and the as-shipped fixture must score strictly below 1.0. Uses the evaluator's
// own sandboxed grader runner, so this exercises the real grading path.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { runScoredCheck } = require('../ai-eval-lib');

const root = __dirname;
const tasksDir = path.join(root, 'cases');

function stage(task, overlay) {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), `ecc-complex-${task}-`));
  const copy = (from, to) => {
    for (const entry of fs.readdirSync(from, { withFileTypes: true })) {
      const target = path.join(to, entry.name);
      if (entry.isDirectory()) { fs.mkdirSync(target, { recursive: true }); copy(path.join(from, entry.name), target); }
      else fs.copyFileSync(path.join(from, entry.name), target);
    }
  };
  copy(path.join(tasksDir, task, 'files'), cwd);
  const reference = path.join(root, 'reference', task);
  if (overlay && fs.existsSync(reference)) copy(reference, cwd);
  return cwd;
}

let failed = false;
for (const task of fs.readdirSync(tasksDir).sort()) {
  const check = fs.readFileSync(path.join(tasksDir, task, 'check.cjs'), 'utf8');
  const timeoutMs = JSON.parse(fs.readFileSync(path.join(tasksDir, task, 'meta.json'), 'utf8')).checkTimeoutMs || 30000;
  const bare = runScoredCheck(stage(task, false), check, timeoutMs);
  const solved = runScoredCheck(stage(task, true), check, timeoutMs);
  const ok = solved.passed && solved.score === 1 && bare.score < 1;
  if (!ok) failed = true;
  console.log(`${ok ? 'ok' : 'FAIL'} - ${task}: fixture=${bare.score.toFixed(3)} reference=${solved.score.toFixed(3)}`);
}
process.exit(failed ? 1 : 0);
