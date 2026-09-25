'use strict';
// Development tool: assembles ../complex-corpus.json from the reviewed fixture
// tree under tasks/. Run this after editing any fixture, query, or grader, and
// commit both the tree and the regenerated corpus together.
const fs = require('node:fs');
const path = require('node:path');

const root = __dirname;
const tasksDir = path.join(root, 'cases');
const OUT = path.join(root, '..', 'complex-corpus.json');

function collect(directory, prefix = '') {
  const files = {};
  for (const entry of fs.readdirSync(directory, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) Object.assign(files, collect(path.join(directory, entry.name), relative));
    else if (entry.isFile()) files[relative] = fs.readFileSync(path.join(directory, entry.name), 'utf8');
  }
  return files;
}

const tasks = [];
const selection = [];
for (const id of fs.readdirSync(tasksDir).sort()) {
  const directory = path.join(tasksDir, id);
  const meta = JSON.parse(fs.readFileSync(path.join(directory, 'meta.json'), 'utf8'));
  if (meta.id !== id || !/^[a-z][a-z0-9-]{0,63}$/.test(id)) throw new Error(`Invalid task metadata in ${id}`);
  const query = fs.readFileSync(path.join(directory, 'query.md'), 'utf8').trim();
  tasks.push({ id, category: meta.category, manualIds: meta.manualIds,
    ...(meta.checkTimeoutMs ? { checkTimeoutMs: meta.checkTimeoutMs } : {}),
    query, files: collect(path.join(directory, 'files')), check: fs.readFileSync(path.join(directory, 'check.cjs'), 'utf8') });
  selection.push({ id: meta.selection.id, category: meta.selection.category, query, expectedIds: meta.selection.expectedIds });
}

const corpus = {
  schemaVersion: 'ecc.context-eval-complex-corpus.v1',
  id: 'complex-tasks@1',
  sampling: 'Three realistic multi-file engineering tasks (feature build with retries, incident root-cause '
    + 'with red herrings, security hardening against a documented contract), fixed before any provider call. '
    + 'Descriptive pilot: no population-representativeness claim; hidden graders score partial credit.',
  minimumDistinctTasks: tasks.length,
  nonInferiorityMargin: 0.05,
  selection,
  tasks,
};
fs.writeFileSync(OUT, `${JSON.stringify(corpus, null, 1)}\n`);
console.log(`wrote ${path.basename(OUT)}: ${tasks.length} tasks, ${selection.length} selection probes, `
  + `${tasks.reduce((sum, task) => sum + Object.keys(task.files).length, 0)} fixture files`);
