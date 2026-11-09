'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const runnerPath = path.resolve(__dirname, '../../scripts/copilot-orchestrate.js');
let passed = 0;
let failed = 0;

async function test(name, action) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ecc-orchestration-'));
  const cwd = path.join(root, 'project');
  const home = path.join(root, 'private');
  fs.mkdirSync(cwd); fs.mkdirSync(home, { mode: 0o700 }); fs.mkdirSync(path.join(home, 'ecc'), { mode: 0o700 });
  const wrapper = path.join(home, 'backend.cjs');
  fs.writeFileSync(wrapper, `const fs=require('fs');let raw='';process.stdin.on('data',c=>raw+=c);process.stdin.on('end',()=>{const r=JSON.parse(raw);fs.appendFileSync(process.env.FIXTURE_LOG,JSON.stringify(r)+'\\n');if(r.task.includes('HANG'))return setTimeout(()=>{},3000);if(r.task.includes('FAIL'))return process.exit(2);let o={summary:r.role+' complete'};if(r.kind==='plan')o={spec:'Implement the requested feature.',rubric:['Tests pass']};if(r.kind==='evaluate')o={score:r.task.includes('PLATEAU')?3:8,evidence:[],findings:[]};if(r.kind==='review')o={verdict:r.task.includes('BLOCK')?'CHANGES_REQUESTED':'APPROVE',findings:r.task.includes('BLOCK')?[{title:'Unsafe query',severity:'HIGH',file:'src/app.js',evidence:'query(input)',proof:'Untrusted input reaches SQL'}]:[]};if(r.kind==='verify')o={isReal:!r.task.includes('REFUTE'),confidence:r.task.includes('UNCERTAIN')?0.2:0.95,reasoning:'Checked against supplied diff.'};if(r.task.includes('BAD_JSON'))process.stdout.write('not json');else process.stdout.write(JSON.stringify(o));});`);
  const roles = Object.fromEntries(['planner', 'generator', 'evaluator', 'reviewerA', 'reviewerB', 'verifier', 'backend', 'frontend'].map(role => [role, { backend: ['evaluator', 'reviewerB', 'verifier', 'frontend'].includes(role) ? 'second' : 'first', allowTools: [] }]));
  const config = { version: 1, limits: { timeoutMs: 1500, budgetMs: 20000, maxIterations: 3 }, backends: {
    first: { type: 'json-stdio', executable: process.execPath, args: [wrapper], identity: 'provider/model-a' },
    second: { type: 'json-stdio', executable: process.execPath, args: [wrapper], identity: 'provider/model-b' },
  }, roles };
  const configFile = path.join(home, 'ecc/orchestration.json');
  const writeConfig = value => fs.writeFileSync(configFile, JSON.stringify(value), { mode: 0o600 });
  writeConfig(config);
  const env = { ...process.env, COPILOT_HOME: home, FIXTURE_LOG: path.join(home, 'calls.jsonl') };
  const invoke = request => {
    const result = spawnSync(process.execPath, [runnerPath], { cwd, env, input: JSON.stringify(request), encoding: 'utf8', timeout: 25000, maxBuffer: 2 * 1024 * 1024 });
    assert.ifError(result.error);
    return { ...result, output: result.stdout.trim() ? JSON.parse(result.stdout) : null };
  };
  const calls = () => fs.existsSync(env.FIXTURE_LOG) ? fs.readFileSync(env.FIXTURE_LOG, 'utf8').trim().split('\n').map(JSON.parse) : [];
  try { await action({ root, cwd, home, env, config, configFile, writeConfig, invoke, calls }); passed++; console.log(`  PASS ${name}`); }
  catch (error) { failed++; console.error(`  FAIL ${name}: ${error.stack}`); }
  finally { fs.rmSync(root, { recursive: true, force: true }); }
}

(async () => {
  await test('all eleven commands expose executable managed workflows', () => {
    const helper = require('../../scripts/lib/install/copilot-orchestration');
    const names = ['gan-build','gan-design','loop-start','loop-status','multi-backend','multi-execute','multi-frontend','multi-plan','multi-workflow','orch-review','santa-loop'];
    for (const name of names) assert.match(helper.getNativeBody(name), /copilot-orchestrate\.js/);
    assert.strictEqual(helper.getNativeBody('other'), null);
  });
  await test('GAN runs planner then generator/evaluator and stops at verified score threshold', ({ invoke, calls }) => {
    const result = invoke({ command: 'gan-build', task: 'Build a test app.', evalMode: 'code-only', maxIterations: 3 });
    assert.strictEqual(result.status, 0, result.stderr);
    assert.strictEqual(result.output.result.status, 'passed');
    assert.strictEqual(result.output.result.iterations.length, 1);
    assert.deepStrictEqual(calls().map(call => call.kind), ['plan','generate','evaluate']);
  });
  await test('GAN stops on plateau without declaring success and rejects absent browser evidence', ({ invoke, calls }) => {
    const plateau = invoke({ command: 'gan-design', task: 'PLATEAU improve UI.', evalMode: 'code-only', maxIterations: 3 });
    assert.strictEqual(plateau.output.result.status, 'plateau');
    assert.strictEqual(plateau.output.result.iterations.length, 3);
    const browser = invoke({ command: 'gan-build', task: 'Build UI.', evalMode: 'playwright', maxIterations: 1 });
    assert.notStrictEqual(browser.status, 0);
    assert.ok(calls().length <= 10);
  });
  await test('multi-model plans run independently and execution requires a stored approved plan', ({ invoke, calls }) => {
    const plan = invoke({ command: 'multi-plan', task: 'Design API.' });
    assert.strictEqual(plan.status, 0, plan.stderr);
    assert.strictEqual(plan.output.result.status, 'awaiting-approval');
    const analyses = calls().filter(call => call.kind === 'analyze');
    assert.strictEqual(analyses.length, 2);
    assert.deepStrictEqual(analyses[0].context, analyses[1].context);
    assert.notStrictEqual(invoke({ command: 'multi-execute', task: 'Apply API.' }).status, 0);
    const executed = invoke({ command: 'multi-execute', planRunId: plan.output.runId, approved: true });
    assert.strictEqual(executed.status, 0, executed.stderr);
    assert.strictEqual(executed.output.result.status, 'reviewed');
  });
  await test('multi workflow variants and Santa use distinct model identities, fail before spawning otherwise', ({ config, writeConfig, invoke, calls }) => {
    for (const command of ['multi-backend','multi-frontend','multi-workflow']) assert.strictEqual(invoke({command, task:'Plan change.'}).status, 0);
    assert.strictEqual(invoke({ command:'santa-loop', task:'Review changes.', diff:'+ safe code' }).output.result.verdict, 'NICE');
    const before = calls().length;
    writeConfig({ ...config, backends: { ...config.backends, second: { ...config.backends.second, identity:'provider/model-a' } } });
    assert.notStrictEqual(invoke({ command:'santa-loop', task:'Review.', diff:'+ x' }).status, 0);
    assert.strictEqual(calls().length, before);
  });
  await test('orch-review deduplicates dimensions and adversarially verifies blockers', ({ invoke }) => {
    const blocked = invoke({ command:'orch-review', task:'BLOCK', diff:'+ query(input)', language:'javascript', changedFiles:['src/app.js'] });
    assert.strictEqual(blocked.status, 0, blocked.stderr);
    assert.strictEqual(blocked.output.result.verdict, 'CHANGES_REQUESTED');
    assert.strictEqual(blocked.output.result.stats.raw, 3);
    assert.strictEqual(blocked.output.result.stats.unique, 1);
    assert.strictEqual(blocked.output.result.blocking.length, 1);
    const refuted = invoke({command:'orch-review',task:'BLOCK REFUTE',diff:'+ query(input)'});
    assert.strictEqual(refuted.output.result.verdict, 'APPROVE');
    const uncertain = invoke({command:'orch-review',task:'BLOCK REFUTE UNCERTAIN',diff:'+ query(input)'});
    assert.strictEqual(uncertain.output.result.verdict, 'CHANGES_REQUESTED');
  });
  await test('review failures and malformed model output never become clean approval', ({ invoke }) => {
    for (const task of ['FAIL', 'BAD_JSON']) {
      const review = invoke({ command:'orch-review',task,diff:'+ query(input)' });
      assert.strictEqual(review.output.result.verdict, 'CHANGES_REQUESTED');
      assert.strictEqual(review.output.result.incomplete, true);
      const santa = invoke({command:'santa-loop',task,diff:'+ code'});
      assert.strictEqual(santa.output.result.verdict, 'NAUGHTY');
    }
  });
  await test('loop preparation never launches models; stored run can be inspected and explicitly started', ({ invoke, calls }) => {
    const prepared = invoke({command:'loop-start',task:'Implement bounded changes.',pattern:'sequential',maxIterations:2});
    assert.strictEqual(prepared.output.result.status, 'prepared');
    assert.strictEqual(calls().length, 0);
    assert.strictEqual(invoke({command:'loop-status',runId:prepared.output.runId}).output.runs[0].status, 'prepared');
    const launched = invoke({command:'loop-start',runId:prepared.output.runId,launch:true});
    assert.strictEqual(launched.status, 0, launched.stderr);
    assert.ok(launched.output.result.iterations.length <= 2);
  });
  await test('unsafe requests, shell grants, repository adapters and symlink config fail without process effects', ({ cwd, home, config, writeConfig, invoke, calls, configFile }) => {
    assert.notStrictEqual(invoke({command:'unknown',task:'x'}).status,0);
    assert.notStrictEqual(invoke({command:'loop-start',task:'x',maxIterations:100000}).status,0);
    assert.notStrictEqual(invoke({command:'loop-status',runId:'../../outside'}).status,0);
    writeConfig({...config,roles:{...config.roles,generator:{backend:'first',allowTools:['shell(*)']}}});
    assert.notStrictEqual(invoke({command:'gan-build',task:'x',evalMode:'code-only'}).status,0);
    writeConfig({...config,backends:{...config.backends,first:{...config.backends.first,args:[path.join(cwd,'repo-wrapper.js')]}}});
    assert.notStrictEqual(invoke({command:'multi-plan',task:'x'}).status,0);
    writeConfig(config);fs.renameSync(configFile,path.join(home,'real.json'));fs.symlinkSync(path.join(home,'real.json'),configFile);
    assert.notStrictEqual(invoke({command:'multi-plan',task:'x'}).status,0);
    assert.strictEqual(calls().length,0);
  });
  await test('run records stay workspace-scoped and secret material never persists', ({ root, cwd, home, env, invoke }) => {
    const prepared=invoke({command:'loop-start',task:'Private normal task.',maxIterations:1});
    const other=path.join(root,'other');fs.mkdirSync(other);
    const foreign=spawnSync(process.execPath,[runnerPath],{cwd:other,env,input:JSON.stringify({command:'loop-status',runId:prepared.output.runId}),encoding:'utf8'});
    assert.notStrictEqual(foreign.status,0);
    const secret='ghp_'+'x'.repeat(36);
    assert.notStrictEqual(invoke({command:'multi-plan',task:'Use '+secret}).status,0);
    const all=(dir)=>fs.readdirSync(dir,{withFileTypes:true}).flatMap(e=>e.isDirectory()?all(path.join(dir,e.name)):fs.readFileSync(path.join(dir,e.name),'utf8'));
    assert.ok(!all(path.join(home,'ecc')).join('').includes(secret));
    assert.ok(fs.existsSync(cwd));
  });
  await test('timeout and byte bounds abort model work and retain explicit failed state', ({ invoke }) => {
    const timeout=invoke({command:'gan-build',task:'HANG',evalMode:'code-only'});
    assert.notStrictEqual(timeout.status,0);
    const huge=invoke({command:'multi-plan',task:'x'.repeat(1024*1024+1)});
    assert.notStrictEqual(huge.status,0);
  });
  console.log(`\nPassed: ${passed}, Failed: ${failed}`);
  process.exitCode=failed?1:0;
})();
