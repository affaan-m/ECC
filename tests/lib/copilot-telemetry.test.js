'use strict';
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { recordSkillFact, recordHookMetric, readTelemetry, summarizeTelemetry, skillHealthRecords, telemetryFile } = require('../../scripts/lib/copilot-telemetry');
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ecc-telemetry-'));
const workspace = path.join(root, 'project'); fs.mkdirSync(workspace);
const env = { COPILOT_HOME: path.join(root, 'config'), ECC_COPILOT_TELEMETRY: '1' };
let failures = 0;
function test(name, fn) { try { fn(); console.log(`✓ ${name}`); } catch(error) { failures++; console.error(`✗ ${name}: ${error.stack}`); } }
function fact(kind = 'invoked', callId = 'call1', skillId = 'scope/skill') { return { workspace, sessionId: 'session1', eventId: `${callId}-${kind}`, callId, skillId, kind, source: 'explicit-host-signal' }; }
try {
 test('disabled means no state creation', () => {
   assert.deepStrictEqual(recordSkillFact(fact(), {}), { status: 'disabled' });
   assert.strictEqual(telemetryFile(workspace, env), null);
 });
 test('discovery selection invocation and completion stay distinct', () => {
   ['discovered', 'selected', 'invoked', 'completed'].forEach(kind => recordSkillFact(fact(kind), env));
   const summary = summarizeTelemetry(readTelemetry(workspace, env));
   assert.deepStrictEqual(summary.skills['scope/skill'], { discovered:1, selected:1, invoked:1, completed:1, failed:0, unknown:0 });
   const health = skillHealthRecords(readTelemetry(workspace, env));
   assert.strictEqual(health.length, 1); assert.strictEqual(health[0].outcome, 'success');
   assert.strictEqual(health[0].tokens_used, null);
 });
 test('unknown completion never becomes a success or failure', () => {
   recordSkillFact(fact('unknown', 'call2'), env);
   assert.strictEqual(skillHealthRecords(readTelemetry(workspace, env)).length,1);
 });
 test('duplicate signal ignored while identical distinct calls count separately', () => {
   assert.strictEqual(recordSkillFact(fact('completed'), env).status, 'duplicate');
   recordSkillFact(fact('completed','call3'), env);
   assert.strictEqual(skillHealthRecords(readTelemetry(workspace, env)).length,2);
 });
 test('cross session signals do not deduplicate', () => {
   recordSkillFact({ ...fact('completed'), sessionId:'session2' }, env);
   assert.strictEqual(skillHealthRecords(readTelemetry(workspace, env)).length,3);
 });
 test('citations installed paths and arbitrary free text cannot be usage facts', () => {
   for(const value of [ { ...fact(), kind:'installed' }, { ...fact(), source:'citation' }, { ...fact(), skillId:'password=secret' }, { ...fact(), callId:null }, { ...fact(), eventId:null } ]) assert.throws(() => recordSkillFact(value,env));
 });
 test('hook metrics contain measured latency and status only', () => {
   recordHookMetric({workspace, sessionId:'s', eventId:'h1', hookId:'pre:config-protection', status:'timeout', durationMs:5, command:'TOP_SECRET', tokens:9000},env);
   const rows = readTelemetry(workspace,env);
   assert.ok(!JSON.stringify(rows).includes('TOP_SECRET'));
   const summary = summarizeTelemetry(rows);
   assert.strictEqual(summary.hooks['pre:config-protection'].count,1);
   assert.strictEqual(summary.hooks['pre:config-protection'].p95Ms,5);
   assert.strictEqual(summary.costUsd,null);
   assert.strictEqual(summary.tokens,null);
 });
 test('hook metric errors and future schemas rejected', () => {
   assert.throws(() => recordHookMetric({workspace,sessionId:'s',eventId:'h2',hookId:'x',status:'invented',durationMs:1},env));
   assert.throws(() => recordHookMetric({workspace,sessionId:'s',eventId:'h2',hookId:'x',status:'success',durationMs:-1},env));
   const file=telemetryFile(workspace,env); const original=fs.readFileSync(file,'utf8');
   fs.appendFileSync(file,'{"schema":"future"}\n');
   assert.throws(()=>readTelemetry(workspace,env)); fs.writeFileSync(file,original);
 });
 test('stored raw extra fields are rejected instead of retained', () => {
   const file=telemetryFile(workspace,env),original=fs.readFileSync(file,'utf8');
   const row=JSON.parse(original.split('\n')[0]);
   fs.writeFileSync(file,JSON.stringify({...row,rawOutput:'PRIVATE'})+'\n');
   assert.throws(()=>readTelemetry(workspace,env));fs.writeFileSync(file,original);
 });
 test('dispatcher records actual measured hook status without changing decisions', () => {
   const {runHook}=require('../../scripts/hooks/copilot-hook-adapter');
   const payload={cwd:workspace,sessionId:'metric-session',toolCallId:'metric-call',toolName:'bash',toolArgs:{command:'echo hello'}};
   const result=runHook('preToolUse','pre:bash:block-no-verify',JSON.stringify(payload),{env:{...process.env,...env,ECC_HOOK_PROFILE:'standard'}});
   assert.strictEqual(result.exitCode,0);
   const rows=readTelemetry(workspace,env).filter(row=>row.type==='hook'&&row.hookId==='pre:bash:block-no-verify');
   assert.strictEqual(rows.length,1);assert.strictEqual(rows[0].status,'success');assert.ok(rows[0].durationMs>=0);
   runHook('preToolUse','pre:bash:block-no-verify',JSON.stringify({...payload,toolCallId:undefined}),{env:{...process.env,...env,ECC_HOOK_PROFILE:'standard'}});
   assert.strictEqual(readTelemetry(workspace,env).filter(row=>row.hookId==='pre:bash:block-no-verify').length,2);
 });
 test('telemetry write failure preserves the actual hook decision', () => {
   const {runHook}=require('../../scripts/hooks/copilot-hook-adapter');
   const file=telemetryFile(workspace,env);fs.mkdirSync(file+'.lock');
   try {
    const result=runHook('preToolUse','pre:bash:block-no-verify',JSON.stringify({cwd:workspace,sessionId:'metric-session',toolCallId:'failure-call',toolName:'bash',toolArgs:{command:'echo hello'}}),{env:{...process.env,...env,ECC_HOOK_PROFILE:'standard'}});
    assert.strictEqual(result.exitCode,0);assert.deepStrictEqual(JSON.parse(result.stdout),{});assert.match(result.stderr,/telemetry unavailable/);
   } finally {fs.rmdirSync(file+'.lock');}
 });
 test('lock contention fails without overwriting state', () => {
   const file=telemetryFile(workspace,env); fs.mkdirSync(file+'.lock');
   try { assert.throws(()=>recordSkillFact(fact('failed','locked'),env)); } finally { fs.rmdirSync(file+'.lock'); }
 });
 test('foreign workspace remains empty and disabling preserves earlier rows', () => {
   const second=path.join(root,'second');fs.mkdirSync(second); assert.deepStrictEqual(readTelemetry(second,env),[]);
   const before=readTelemetry(workspace,env).length;
   recordSkillFact(fact('failed','disabled'),{...env,ECC_COPILOT_TELEMETRY:'0'});
   assert.strictEqual(readTelemetry(workspace,env).length,before);
 });
 test('contradictory terminal events stay unmeasured and replay cannot restore success', () => {
   recordSkillFact(fact('completed','conflict'),env);recordSkillFact(fact('failed','conflict'),env);
   assert.strictEqual(recordSkillFact({...fact('completed','conflict'),eventId:'different-replay'},env).status,'duplicate');
   const health=skillHealthRecords(readTelemetry(workspace,env)); assert.strictEqual(health.length,3);
 });
 test('partial records and symlink stores rejected', () => {
   const file=telemetryFile(workspace,env), original=fs.readFileSync(file,'utf8');
   fs.writeFileSync(file,original+'{');assert.throws(()=>readTelemetry(workspace,env));fs.writeFileSync(file,original);
   if(process.platform!=='win32') { const backup=file+'.backup';fs.renameSync(file,backup);fs.symlinkSync(backup,file);assert.throws(()=>readTelemetry(workspace,env));fs.unlinkSync(file);fs.renameSync(backup,file); }
 });
} finally { fs.rmSync(root,{recursive:true,force:true}); }
process.exitCode=failures?1:0;
