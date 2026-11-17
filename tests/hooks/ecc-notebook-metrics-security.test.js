'use strict';

/**
 * Security evidence for NotebookEdit metrics.
 *
 * Run the real hook with isolated data/config/temp directories. Notebook source
 * remains opaque input: metrics persist only a fingerprint and file metadata.
 */
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const bridgeScript = path.resolve(__dirname, '../../scripts/hooks/ecc-metrics-bridge.js');

/** Create a private hook workspace without inheriting the caller's session. */
function createFixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ecc-notebook-security-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const temporaryDirectory = path.join(root, 'tmp');
  const workspace = path.join(root, 'workspace');
  fs.mkdirSync(temporaryDirectory);
  fs.mkdirSync(workspace);
  const configDirectory = path.join(root, '.claude');

  /** Invoke the production entrypoint and preserve its pass-through contract. */
  function invoke(toolInput, sessionId = 'notebook-security') {
    const input = JSON.stringify({
      session_id: sessionId, tool_name: 'NotebookEdit', tool_input: toolInput
    });
    const result = spawnSync(process.execPath, [bridgeScript], {
      input, encoding: 'utf8', cwd: workspace, timeout: 5000,
      env: {
        ...process.env, HOME: root, USERPROFILE: root,
        ECC_AGENT_DATA_HOME: configDirectory, CLAUDE_CONFIG_DIR: configDirectory,
        ECC_SESSION_ID: '', CLAUDE_SESSION_ID: '',
        TMPDIR: temporaryDirectory, TEMP: temporaryDirectory, TMP: temporaryDirectory
      }
    });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stdout, input);
    assert.equal(result.stderr, '');
  }

  return {
    root, workspace, temporaryDirectory, invoke,
    bridgePath: path.join(temporaryDirectory, 'ecc-metrics-notebook-security.json')
  };
}

test('NotebookEdit metrics never execute or persist raw cell contents', t => {
  const fixture = createFixture(t);
  const notebook = path.join(fixture.workspace, 'analysis.ipynb');
  const marker = path.join(fixture.root, 'executed-source');
  const originalNotebook = '{"cells":[]}\n';
  fs.writeFileSync(notebook, originalNotebook);
  const source = '/* synthetic-private-cell-source */\n' +
    `require('node:fs').writeFileSync(${JSON.stringify(marker)}, 'executed')`;
  fixture.invoke({
    notebook_path: notebook, cell_id: 'synthetic-private-cell-id',
    new_source: source, edit_mode: 'replace', cell_type: 'code'
  });

  const stored = fs.readFileSync(fixture.bridgePath, 'utf8');
  const bridge = JSON.parse(stored);
  assert.equal(bridge.tool_count, 1);
  assert.deepEqual(bridge.files_modified, [notebook]);
  assert.deepEqual(Object.keys(bridge.recent_tools[0]).sort(), ['hash', 'tool']);
  assert.equal(bridge.recent_tools[0].tool, 'NotebookEdit');
  assert.match(bridge.recent_tools[0].hash, /^[0-9a-f]{8}$/);
  assert.ok(!stored.includes('synthetic-private-cell-source'));
  assert.ok(!stored.includes('synthetic-private-cell-id'));
  assert.ok(!stored.includes('writeFileSync'));
  assert.equal(fs.existsSync(marker), false);
  assert.equal(fs.readFileSync(notebook, 'utf8'), originalNotebook);
});

test('NotebookEdit paths are metadata, not filesystem write targets or commands', t => {
  const fixture = createFixture(t);
  const outsideNotebook = path.join(fixture.root, 'outside.ipynb');
  fs.writeFileSync(outsideNotebook, 'preserve this notebook');
  const paths = ['../outside.ipynb', '../outside.ipynb; echo injected', '$(echo injected).ipynb'];
  for (const notebookPath of paths) {
    fixture.invoke({ notebook_path: notebookPath, new_source: 'replacement cell' });
  }
  fixture.invoke({ notebook_path: { file_path: '../outside.ipynb' }, new_source: 'ignored path' });

  const bridge = JSON.parse(fs.readFileSync(fixture.bridgePath, 'utf8'));
  assert.equal(bridge.tool_count, 4);
  assert.deepEqual(bridge.files_modified, paths);
  assert.equal(bridge.files_modified_count, paths.length);
  assert.equal(fs.readFileSync(outsideNotebook, 'utf8'), 'preserve this notebook');
  assert.deepEqual(fs.readdirSync(fixture.workspace), []);
});

test('NotebookEdit cannot use a traversal session ID to choose a bridge file', t => {
  const fixture = createFixture(t);
  for (const sessionId of ['../outside', '..\\outside', 'normal/../../outside']) {
    fixture.invoke({ notebook_path: '../outside.ipynb', new_source: 'private source' }, sessionId);
  }
  assert.deepEqual(fs.readdirSync(fixture.temporaryDirectory), []);
  assert.deepEqual(fs.readdirSync(fixture.root).sort(), ['tmp', 'workspace']);
});
