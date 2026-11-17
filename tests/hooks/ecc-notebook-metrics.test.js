'use strict';

const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { run, hashToolCall, extractFilePaths } = require('../../scripts/hooks/ecc-metrics-bridge');
const { detectLoop } = require('../../scripts/hooks/ecc-context-monitor');

test('NotebookEdit fingerprints distinguish each native edit field', () => {
  const original = {
    notebook_path: '/repo/analysis.ipynb', cell_id: 'cell-1',
    new_source: 'print(1)', edit_mode: 'replace', cell_type: 'code'
  };
  const originalHash = hashToolCall('NotebookEdit', original);
  for (const change of [
    { notebook_path: '/repo/other.ipynb' }, { cell_id: 'cell-2' },
    { new_source: 'print(2)' }, { edit_mode: 'insert' }, { cell_type: 'markdown' }
  ]) {
    assert.notEqual(hashToolCall('NotebookEdit', { ...original, ...change }), originalHash,
      `NotebookEdit must distinguish ${Object.keys(change)[0]}`);
  }
  assert.equal(hashToolCall('NotebookEdit', { ...original }), originalHash);
});

test('file fingerprints retain existing tool and missing-input behavior', () => {
  assert.match(hashToolCall(null, null), /^[0-9a-f]{8}$/);
  assert.equal(hashToolCall('NotebookEdit'), hashToolCall('NotebookEdit', {}));
  assert.equal(hashToolCall('Bash'), hashToolCall('Bash', { command: '' }));
  assert.notEqual(hashToolCall('Read', { file_path: 'a.js' }), hashToolCall('Read', { file_path: 'b.js' }));
  assert.notEqual(
    hashToolCall('MultiEdit', { edits: [{ old_string: 'a', new_string: 'b' }] }),
    hashToolCall('MultiEdit', { edits: [{ old_string: 'a', new_string: 'c' }] })
  );
});

test('NotebookEdit extracts its notebook_path and ignores invalid paths', () => {
  assert.deepEqual(extractFilePaths('NotebookEdit', { notebook_path: '/repo/a.ipynb' }), ['/repo/a.ipynb']);
  assert.deepEqual(extractFilePaths('NotebookEdit', { notebook_path: 42 }), []);
});

test('NotebookEdit tracks notebook scope without false loop warnings', t => {
  const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'ecc-notebook-metrics-'));
  t.after(() => fs.rmSync(tmpHome, { recursive: true, force: true }));
  const temporaryDirectory = path.join(tmpHome, 'tmp');
  fs.mkdirSync(temporaryDirectory);
  const sessionId = `notebook-edits-${process.pid}`;
  const bridgeScript = path.resolve(__dirname, '../../scripts/hooks/ecc-metrics-bridge.js');
  const bridgePath = path.join(temporaryDirectory, `ecc-metrics-${sessionId}.json`);
  const readBridge = () => JSON.parse(fs.readFileSync(bridgePath, 'utf8'));
  const invoke = toolInput => {
    const input = JSON.stringify({ session_id: sessionId, tool_name: 'NotebookEdit', tool_input: toolInput });
    const result = spawnSync(process.execPath, [bridgeScript], {
      input, encoding: 'utf8', cwd: tmpHome, timeout: 5000,
      env: {
        ...process.env, HOME: tmpHome, USERPROFILE: tmpHome,
        ECC_AGENT_DATA_HOME: path.join(tmpHome, '.claude'),
        CLAUDE_CONFIG_DIR: path.join(tmpHome, '.claude'),
        TMPDIR: temporaryDirectory, TEMP: temporaryDirectory, TMP: temporaryDirectory
      }
    });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stdout, input);
  };
  const notebook = path.join(tmpHome, 'analysis.ipynb');
  for (let cell = 0; cell < 5; cell++) {
    invoke({ notebook_path: notebook, cell_id: `cell-${cell}`, new_source: 'print(1)' });
  }
  const distinct = readBridge();
  assert.equal(detectLoop(distinct.recent_tools).detected, false,
    'Editing different notebook cells must not be treated as a stuck loop');
  assert.deepEqual(distinct.files_modified, [notebook]);
  assert.equal(distinct.files_modified_count, 1);
  const repeated = { notebook_path: notebook, cell_id: 'same-cell', new_source: 'print(2)' };
  for (let repeat = 0; repeat < 5; repeat++) invoke(repeated);
  assert.equal(detectLoop(readBridge().recent_tools).detected, true,
    'Identical repeated notebook edits must still be detected');
});

test('malformed hook input remains unchanged', () => {
  assert.equal(run('{invalid'), '{invalid');
});
