'use strict';

// Run potentially blocking FIFO races in a disposable process. The parent owns
// the timeout, so a missing nonblocking flag fails instead of hanging the suite.
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { createStateStore } = require('../../../scripts/lib/state-store');
const { claimWorkItem } = require('../../../scripts/lib/control-pane/work-item-mutations');
const { MATRIX_BLOCK_START, MATRIX_BLOCK_END, renderMarkdownTable } = require('../../../scripts/lib/harness-adapter-compliance');

async function run() {
  const [, , requestedRoot, scenario] = process.argv;
  assert.ok(['fifo', 'replace'].includes(scenario));
  fs.mkdirSync(requestedRoot, { recursive: true });
  const root = fs.realpathSync(requestedRoot);
  const artifact = path.join(root, 'matrix.md');
  const store = await createStateStore({ dbPath: path.join(root, 'state.db') });
  const lstat = fs.lstatSync;
  let replaced = false;
  const makeFifo = () => {
    const result = spawnSync('mkfifo', [artifact], { encoding: 'utf8' });
    assert.strictEqual(result.status, 0, result.stderr);
  };
  try {
    store.upsertSession({ id: 'fifo-session', adapterId: 'test', harness: 'test', state: 'active', snapshot: {} });
    store.upsertWorkItem({
      id: 'fifo-task', source: 'manual', title: 'Verify FIFO boundary', status: 'open', repoRoot: root,
      metadata: { verification: { contract: { verifier: 'harness-adapter-documentation/v1', artifact: 'matrix.md' } } },
    });
    claimWorkItem(store, { id: 'fifo-task', owner: 'agent', assigneeKind: 'agent', sessionId: 'fifo-session' });
    if (scenario === 'fifo') {
      makeFifo();
    } else {
      fs.writeFileSync(artifact, `${MATRIX_BLOCK_START}\n${renderMarkdownTable()}\n${MATRIX_BLOCK_END}\n`);
      fs.lstatSync = function (filename, ...args) {
        const stat = lstat.call(fs, filename, ...args);
        if (!replaced && filename === artifact && stat.isFile()) {
          fs.unlinkSync(artifact);
          makeFifo();
          replaced = true;
        }
        return stat;
      };
    }
    const result = store.verifyWorkItem('fifo-task');
    assert.strictEqual(result.attempt.outcome, 'unknown');
    if (scenario === 'replace') assert.strictEqual(replaced, true, 'the artifact race must actually run');
    process.stdout.write(JSON.stringify({ outcome: result.attempt.outcome, replaced }));
  } finally {
    fs.lstatSync = lstat;
    store.close();
  }
}

run().catch(error => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
