'use strict';
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { spawnSync } = require('child_process');
const observer = require('../../scripts/lib/copilot-observer');
const { configRoot, projectDirectory } = require('../../scripts/lib/copilot-sessions');
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ecc-observer-crash-'));
const hash = value => crypto.createHash('sha256').update(value).digest('hex');
let passed = 0;
try {
  for (const position of ['before', 'after']) {
    const workspace = path.join(root, position); fs.mkdirSync(workspace);
    const env = { ...process.env, COPILOT_HOME: path.join(workspace, 'private') };
    const projectId = hash(fs.realpathSync(workspace));
    const directory = projectDirectory(workspace, env, true);
    const mappingRoot = path.join(configRoot(env), 'ecc/learning-mappings'); fs.mkdirSync(mappingRoot);
    fs.writeFileSync(path.join(mappingRoot, `${projectId}.json`), JSON.stringify({ schema: 'ecc.copilot.learning-mapping.v1',
      observationProjectId: projectId, learningProjectId: '0123456789ab', identitySource: 'canonical-detect-project' }));
    const rows = ['one', 'two', 'three'].flatMap((session, i) => ['Read', 'Edit'].map((tool, j) => ({
      schema: 'ecc.copilot.observation.v1', timestamp: new Date(1000 + i * 2000 + j).toISOString(),
      event: 'tool_complete', tool, session: hash(session), project_id: projectId,
      tool_use_id: hash(`${session}-${tool}`), outcome: 'succeeded',
    })));
    const observationFile = path.join(directory, 'observations.jsonl');
    const seed = records => fs.writeFileSync(observationFile, records.map(row => JSON.stringify(row)).join('\n') + '\n');
    seed(rows.slice(0, 4)); observer.runOnce(workspace, { backend: 'metadata-sequences' }, env);
    const file = observer.stateFile(workspace, env); const previous = fs.readFileSync(file, 'utf8');
    seed(rows); const observations = fs.readFileSync(observationFile, 'utf8');
    // Real process exit at the replacement boundary: finally blocks do not run.
    // Exit-after-rename models a committed write whose caller never saw success.
    const code = `const fs=require('fs');const rename=fs.renameSync;fs.renameSync=function(a,b){if(b===${JSON.stringify(file)}){if(${JSON.stringify(position)}==='before')process.exit(73);rename(a,b);process.exit(73);}return rename(a,b);};require(${JSON.stringify(require.resolve('../../scripts/lib/copilot-observer'))}).runOnce(process.cwd(),{backend:'metadata-sequences'});`;
    const crashed = spawnSync(process.execPath, ['-e', code], { cwd: workspace, env, encoding: 'utf8', timeout: 10000 });
    assert.ifError(crashed.error); assert.equal(crashed.status, 73, crashed.stderr);
    const recovered = observer.readState(workspace, env);
    assert.equal(recovered.cursor.records, position === 'before' ? 4 : 6);
    assert.equal(recovered.candidates.length, position === 'before' ? 0 : 1);
    if (position === 'before') assert.equal(fs.readFileSync(file, 'utf8'), previous);
    assert.equal(fs.readFileSync(observationFile, 'utf8'), observations);
    assert.throws(() => observer.runOnce(workspace, { backend: 'metadata-sequences' }, env), /EEXIST/,
      'a crash lock must not be stolen from a potentially live writer');
    // The fixture acts as an operator after verifying that its own child exited.
    fs.rmdirSync(`${file}.lock`);
    const replay = observer.runOnce(workspace, { backend: 'metadata-sequences' }, env);
    assert.equal(replay.status, position === 'before' ? 'analyzed' : 'unchanged');
    assert.equal(observer.readState(workspace, env).candidates.length, 1);
    const committed = fs.readFileSync(file, 'utf8');
    assert.equal(observer.runOnce(workspace, { backend: 'metadata-sequences' }, env).status, 'unchanged');
    assert.equal(fs.readFileSync(file, 'utf8'), committed);
    seed(rows.slice(0, 2));
    assert.equal(observer.runOnce(workspace, { backend: 'metadata-sequences' }, env).rotationDetected, true);
    const rotated = observer.readState(workspace, env);
    assert.equal(rotated.cursor.records, 2); assert.equal(rotated.candidates.length, 0,
      'expired support must not survive as an active or accumulating candidate');
    passed++; console.log(`PASS actual process crash ${position} candidate replacement preserves a coherent snapshot and replay`);
  }
  console.log(`Passed: ${passed}, Failed: 0`);
} finally { fs.rmSync(root, { recursive: true, force: true }); }
