'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const test = require('node:test');
const { loadContextRegistry } = require('../../scripts/lib/context-pack-registry');

const root = path.resolve(__dirname, '../..');
const corpus = JSON.parse(fs.readFileSync(path.join(root, 'docker/context-profiles/ai-corpus.json'), 'utf8'));
const references = JSON.parse(fs.readFileSync(path.join(__dirname, '../fixtures/context-eval-references.json'), 'utf8'));
const ID = /^[a-z][a-z0-9-]{0,63}$/;
const BLOCKS = ['excluded', 'native-authority', 'manual-only', 'opt-out-conflict', 'unknown-id'];
const bytes = text => Buffer.byteLength(text, 'utf8');

function assertSafePath(file) {
  assert.equal(typeof file, 'string');
  assert.ok(file.length > 0 && !path.isAbsolute(file) && !path.win32.isAbsolute(file), `absolute path: ${file}`);
  assert.ok(!file.includes('\\') && !file.includes('\0'), `unsafe path: ${file}`);
  for (const part of file.split('/')) {
    assert.ok(part && part !== '.' && part !== '..' && !part.startsWith('.'), `unsafe path segment: ${file}`);
  }
}

function writeTree(dir, files) {
  for (const [file, content] of Object.entries(files)) {
    const target = path.join(dir, file);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, content);
  }
}

function runCheck(task, overlay) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `ecc-eval-${task.id}-`));
  try {
    writeTree(dir, task.files);
    if (overlay) writeTree(dir, overlay);
    fs.writeFileSync(path.join(dir, '.ecc-eval-check.cjs'), task.check);
    return spawnSync(process.execPath, ['.ecc-eval-check.cjs'], { cwd: dir, timeout: 10000, encoding: 'utf8' });
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

test('corpus v2 header, ids and probe shapes are valid', () => {
  assert.equal(corpus.schemaVersion, 'ecc.context-eval-corpus.v2');
  assert.equal(corpus.id, 'coding-tasks@1');
  assert.equal(typeof corpus.sampling, 'string');
  assert.ok(corpus.sampling.length > 0);
  assert.equal(corpus.minimumDistinctTasks, 30);
  assert.equal(corpus.nonInferiorityMargin, 0.05);
  assert.equal(corpus.tasks.length, 30);
  assert.ok(corpus.selection.length >= 30);
  for (const cases of [corpus.selection, corpus.tasks]) {
    assert.equal(new Set(cases.map(c => c.id)).size, cases.length, 'duplicate id');
    for (const item of cases) assert.match(item.id, ID);
  }
  const categories = new Set(corpus.selection.map(p => p.category));
  for (const category of ['exact', 'paraphrase', 'no-workflow', 'policy']) assert.ok(categories.has(category), category);
  for (const probe of corpus.selection) {
    assert.equal(typeof probe.query, 'string');
    assert.ok(bytes(probe.query) > 0 && bytes(probe.query) <= 8192);
    if (probe.expectedBlock !== undefined) {
      assert.ok(BLOCKS.includes(probe.expectedBlock), probe.id);
    } else {
      assert.ok(Array.isArray(probe.expectedIds) && probe.expectedIds.length <= 1, probe.id);
    }
    if (probe.noWorkflow !== undefined) assert.equal(typeof probe.noWorkflow, 'boolean');
  }
});

test('every referenced skill ID exists in the registry', () => {
  const known = new Set(loadContextRegistry({ repoRoot: root }).entries.map(e => e.id));
  const ids = new Set();
  for (const probe of corpus.selection) {
    for (const key of ['expectedIds', 'exclude']) (probe[key] || []).forEach(id => ids.add(id));
    if (probe.expectedBlock !== 'unknown-id') (probe.explicitIds || []).forEach(id => ids.add(id));
  }
  corpus.tasks.forEach(task => task.manualIds.forEach(id => ids.add(id)));
  for (const id of ids) assert.ok(known.has(id), `unknown registry ID: ${id}`);
  for (const probe of corpus.selection.filter(p => p.expectedBlock === 'unknown-id')) {
    assert.ok(probe.explicitIds.some(id => !known.has(id)), probe.id);
  }
});

test('tasks respect shape, size and path-safety limits', () => {
  const skills = new Set();
  let noWorkflow = 0;
  for (const task of corpus.tasks) {
    assert.equal(typeof task.category, 'string');
    assert.ok(Array.isArray(task.manualIds) && task.manualIds.length <= 1, task.id);
    task.manualIds.forEach(id => skills.add(id));
    if (task.category === 'no-workflow') {
      noWorkflow++;
      assert.deepEqual(task.manualIds, [], task.id);
    }
    if (task.noWorkflow !== undefined) assert.equal(task.noWorkflow, true, task.id);
    assert.ok(bytes(task.query) > 0 && bytes(task.query) <= 1500, `${task.id} query is ${bytes(task.query)} bytes`);
    assert.ok(/dependenc/i.test(task.query), `${task.id} query must forbid new dependencies`);
    assert.ok(!/ecc-eval-check|hidden check/i.test(task.query), task.id);
    const files = Object.entries(task.files);
    assert.ok(files.length >= 1 && files.length <= 4, `${task.id} has ${files.length} files`);
    let total = 0;
    for (const [file, content] of files) {
      assertSafePath(file);
      assert.equal(typeof content, 'string');
      assert.ok(bytes(content) <= 4096, `${task.id}/${file} exceeds 4 KB`);
      total += bytes(content);
    }
    assert.ok(total <= 12288, `${task.id} files exceed 12 KB`);
    assert.equal(typeof task.check, 'string');
    assert.doesNotMatch(task.check, /child_process|worker_threads|node:net|node:http|writeFile|appendFile|mkdirSync|rmSync|unlinkSync|fetch\(/,
      `${task.id} check uses a forbidden API`);
    const overlay = references[task.id];
    assert.ok(overlay && Object.keys(overlay).length >= 1, `${task.id} has no reference`);
    for (const [file, content] of Object.entries(overlay)) {
      assertSafePath(file);
      assert.equal(typeof content, 'string');
    }
  }
  assert.ok(noWorkflow >= 6 && noWorkflow <= 10, `no-workflow tasks: ${noWorkflow}`);
  assert.ok(skills.size >= 10, `distinct skills: ${skills.size}`);
  assert.deepEqual(Object.keys(references).sort(), corpus.tasks.map(t => t.id).sort());
});

for (const task of corpus.tasks) {
  test(`hidden check fails on starter files and passes on the reference: ${task.id}`, () => {
    const before = runCheck(task, null);
    assert.notEqual(before.status, 0, `${task.id} check passed on the starter files`);
    assert.equal(before.error, undefined);
    const after = runCheck(task, references[task.id]);
    assert.equal(after.status, 0, `${task.id} reference failed:\n${after.stderr}${after.stdout}`);
  });
}
