'use strict';
// Development tool: assembles a complex corpus JSON from a reviewed fixture
// tree. Usage: node build-corpus.js [casesDir=cases] [outFile=complex-corpus.json] [corpusId=complex-tasks@1]
// Run after editing any fixture, query, or grader; commit the tree and the
// regenerated corpus together.
const fs = require('node:fs');
const path = require('node:path');

const root = __dirname;
const casesDir = path.join(root, process.argv[2] || 'cases');
const OUT = path.join(root, '..', process.argv[3] || 'complex-corpus.json');
const corpusId = process.argv[4] || 'complex-tasks@1';

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
for (const id of fs.readdirSync(casesDir).sort()) {
  const directory = path.join(casesDir, id);
  const meta = JSON.parse(fs.readFileSync(path.join(directory, 'meta.json'), 'utf8'));
  if (meta.id !== id || !/^[a-z][a-z0-9-]{0,63}$/.test(id)) throw new Error(`Invalid task metadata in ${id}`);
  const files = collect(path.join(directory, 'files'));
  const stepsDir = path.join(directory, 'steps');
  let task;
  if (fs.existsSync(stepsDir)) {
    const steps = fs.readdirSync(stepsDir).sort().map((name, index) => ({
      query: fs.readFileSync(path.join(stepsDir, name, 'query.md'), 'utf8').trim(),
      check: fs.readFileSync(path.join(stepsDir, name, 'check.cjs'), 'utf8'),
      ...(meta.steps?.[index]?.manualIds ? { manualIds: meta.steps[index].manualIds } : {}),
      ...((meta.steps?.[index]?.checkTimeoutMs || meta.checkTimeoutMs)
        ? { checkTimeoutMs: meta.steps?.[index]?.checkTimeoutMs || meta.checkTimeoutMs } : {}),
    }));
    task = { id, category: meta.category, manualIds: meta.manualIds || [], files, steps };
  } else {
    const query = fs.readFileSync(path.join(directory, 'query.md'), 'utf8').trim();
    task = { id, category: meta.category, manualIds: meta.manualIds,
      ...(meta.checkTimeoutMs ? { checkTimeoutMs: meta.checkTimeoutMs } : {}),
      query, files, check: fs.readFileSync(path.join(directory, 'check.cjs'), 'utf8') };
  }
  tasks.push(task);
  selection.push({ id: meta.selection.id, category: meta.selection.category,
    query: meta.selection.query || task.query || task.steps.map(step => step.query).join(' '),
    expectedIds: meta.selection.expectedIds });
}

const corpus = {
  schemaVersion: 'ecc.context-eval-complex-corpus.v1',
  id: corpusId,
  sampling: 'Realistic multi-file engineering tasks, fixed before any provider call, with deterministic '
    + 'hidden graders scoring partial credit (ECC_EVAL_SCORE). Descriptive pilot: no '
    + 'population-representativeness claim. See complex-eval/DESIGN.md for the preregistered methodology.',
  minimumDistinctTasks: tasks.length,
  nonInferiorityMargin: 0.05,
  selection,
  tasks,
};
fs.writeFileSync(OUT, `${JSON.stringify(corpus, null, 1)}\n`);
console.log(`wrote ${path.basename(OUT)} (${corpusId}): ${tasks.length} tasks, ${selection.length} selection probes, `
  + `${tasks.reduce((sum, task) => sum + Object.keys(task.files).length, 0)} fixture files`);
