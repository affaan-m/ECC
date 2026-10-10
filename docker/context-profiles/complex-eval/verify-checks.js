'use strict';
// Development tool: validates the hidden graders end to end. For every task the
// reference solution (referenceDir/<task> overlaid on the fixture) must score
// 1.0; the as-shipped fixture and the optional naive control (naiveDir/<task>)
// must score strictly below 1.0. Uses the evaluator's own sandboxed grader
// runner, so this exercises the real grading path.
// Usage: node verify-checks.js [casesDir=cases] [referenceDir=reference] [naiveDir=naive]
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { runScoredCheck } = require('../ai-eval-lib');

const root = __dirname;
const casesDir = path.join(root, process.argv[2] || 'cases');
const referenceDir = path.join(root, process.argv[3] || 'reference');
const naiveDir = path.join(root, process.argv[4] || 'naive');

function stage(task, overlayDir) {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), `ecc-complex-${task}-`));
  const copy = (from, to) => {
    for (const entry of fs.readdirSync(from, { withFileTypes: true })) {
      const target = path.join(to, entry.name);
      if (entry.isDirectory()) { fs.mkdirSync(target, { recursive: true }); copy(path.join(from, entry.name), target); }
      else fs.copyFileSync(path.join(from, entry.name), target);
    }
  };
  copy(path.join(casesDir, task, 'files'), cwd);
  if (overlayDir && fs.existsSync(path.join(overlayDir, task))) copy(path.join(overlayDir, task), cwd);
  return cwd;
}

let failed = false;
for (const task of fs.readdirSync(casesDir).sort()) {
  const meta = JSON.parse(fs.readFileSync(path.join(casesDir, task, 'meta.json'), 'utf8'));
  const stepsDir = path.join(casesDir, task, 'steps');
  if (fs.existsSync(stepsDir)) {
    // Stepped task: graders run in order against one accumulating workspace.
    const steps = fs.readdirSync(stepsDir).sort().map((name, index) => ({
      check: fs.readFileSync(path.join(stepsDir, name, 'check.cjs'), 'utf8'),
      timeoutMs: meta.steps?.[index]?.checkTimeoutMs || meta.checkTimeoutMs || 30000,
    }));
    const runChain = overlayDir => {
      const cwd = stage(task, overlayDir);
      return steps.map((step, index) => runScoredCheck(cwd, step.check, step.timeoutMs, index + 1).score);
    };
    const bare = runChain(null);
    const solved = runChain(referenceDir);
    const ok = solved.every(score => score === 1) && bare.some(score => score < 1);
    if (!ok) failed = true;
    console.log(`${ok ? 'ok' : 'FAIL'} - ${task}: fixture=[${bare.map(s => s.toFixed(2))}] reference=[${solved.map(s => s.toFixed(2))}]`);
    continue;
  }
  const check = fs.readFileSync(path.join(casesDir, task, 'check.cjs'), 'utf8');
  const timeoutMs = meta.checkTimeoutMs || 30000;
  const bare = runScoredCheck(stage(task, null), check, timeoutMs);
  const naive = fs.existsSync(path.join(naiveDir, task))
    ? runScoredCheck(stage(task, naiveDir), check, timeoutMs) : null;
  const solved = runScoredCheck(stage(task, referenceDir), check, timeoutMs);
  const ok = solved.passed && solved.score === 1 && bare.score < 1 && (!naive || naive.score < 1);
  if (!ok) failed = true;
  console.log(`${ok ? 'ok' : 'FAIL'} - ${task}: fixture=${bare.score.toFixed(3)}`
    + `${naive ? ` naive=${naive.score.toFixed(3)}` : ''} reference=${solved.score.toFixed(3)}`);
}
process.exit(failed ? 1 : 0);
