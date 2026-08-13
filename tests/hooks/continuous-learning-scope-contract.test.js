/**
 * Cross-platform source contract for continuous-learning-v2 scope routing (#2746).
 */

'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const repoRoot = path.resolve(__dirname, '..', '..');
const observePath = path.join(repoRoot, 'skills', 'continuous-learning-v2', 'hooks', 'observe.sh');
const startObserverPath = path.join(repoRoot, 'skills', 'continuous-learning-v2', 'agents', 'start-observer.sh');
const observe = fs.readFileSync(observePath, 'utf8');
const startObserver = fs.readFileSync(startObserverPath, 'utf8');

console.log('\ncontinuous-learning-v2 scope contract (#2746):');

assert.match(
  observe,
  /elif \[ -n "\$\{CLAUDE_PROJECT_DIR:-\}" \] && \[ -d "\$CLAUDE_PROJECT_DIR" \]; then[\s\S]*?else[\s\S]*?export CLV2_NO_PROJECT=1/,
  'missing payload cwd must use only a valid explicit project directory or global scope'
);
assert.ok(
  !observe.includes('${CONFIG_DIR}/.observer.pid'),
  'project observations must not inspect or signal an unrelated global observer PID'
);
assert.ok(
  observe.includes('observation["cwd"] = scrub(parsed.get("cwd", ""))'),
  'every stored observation must retain a scrubbed cwd diagnostic'
);
assert.ok(
  startObserver.includes('PID_FILE="${PROJECT_DIR}/.observer.pid"') &&
    startObserver.includes('OBSERVATIONS_FILE="${PROJECT_DIR}/observations.jsonl"'),
  'observer processes must remain keyed to their project storage directory'
);

console.log('  PASS deterministic detection, project PID isolation, and cwd diagnostics are enforced');
