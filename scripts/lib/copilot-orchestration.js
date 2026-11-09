'use strict';

const io = require('./copilot-orchestration-io');
const crypto = require('crypto');
const COMMANDS = Object.freeze(['gan-build', 'gan-design', 'loop-start', 'loop-status', 'multi-backend', 'multi-execute', 'multi-frontend', 'multi-plan', 'multi-workflow', 'orch-review', 'santa-loop']);

function validateRequest(request) {
  if (!io.object(request) || !COMMANDS.includes(request.command)) throw new Error('Unknown orchestration command.');
  for (const field of ['task', 'diff']) if (request[field] !== undefined) io.safeText(request[field]);
  if (request.maxIterations !== undefined) io.positive(request.maxIterations, 15, 'iteration budget');
  if (request.changedFiles !== undefined && (!Array.isArray(request.changedFiles) || request.changedFiles.length > 100 || request.changedFiles.some(file => typeof file !== 'string' || file.length > 1000))) throw new Error('Invalid changed-file list.');
}

function model(context, role, kind, evidence = {}) {
  return io.invokeModel(context.config, role, { kind, task: context.request.task || '', ...evidence }, context.options);
}

function findings(value) {
  if (!Array.isArray(value) || value.length > 100) throw new Error('Reviewer must return a bounded findings array.');
  return value.map(item => {
    if (!io.object(item) || typeof item.title !== 'string' || !['CRITICAL', 'HIGH', 'MEDIUM', 'LOW', 'INFO'].includes(item.severity)) throw new Error('Invalid review finding.');
    return { ...item, title: io.safeText(item.title, 1000), file: io.safeText(item.file || '', 1000), evidence: io.safeText(item.evidence || '', 8000) };
  });
}

async function review(context, adversarial) {
  io.distinct(context.config, 'reviewerA', adversarial ? 'verifier' : 'reviewerB');
  const dimensions = adversarial ? ['correctness', 'security', 'tests'] : ['independent-a', 'independent-b'];
  const results = await Promise.allSettled(dimensions.map((dimension, index) => model(context, index % 2 ? 'reviewerB' : 'reviewerA', 'review', {
    dimension, context: { diff: context.request.diff || '', files: context.request.changedFiles || [] },
    outputShape: { verdict: 'APPROVE|CHANGES_REQUESTED', findings: [{ title: 'string', severity: 'HIGH', file: 'string', evidence: 'string' }] },
  })));
  let incomplete = false;
  const collected = [];
  for (const result of results) {
    try {
      if (result.status !== 'fulfilled' || !['APPROVE', 'CHANGES_REQUESTED'].includes(result.value.verdict)) throw new Error('Incomplete review.');
      const items = findings(result.value.findings);
      if (result.value.verdict === 'CHANGES_REQUESTED' && !items.length) incomplete = true;
      collected.push(...items);
    } catch { incomplete = true; }
  }
  const unique = [...new Map(collected.map(finding => [JSON.stringify([finding.file, finding.title, finding.severity]), finding])).values()];
  const blocking = [];
  for (const finding of unique.filter(item => ['CRITICAL', 'HIGH', 'MEDIUM'].includes(item.severity))) {
    if (!adversarial) { blocking.push(finding); continue; }
    try {
      const verification = await model(context, 'verifier', 'verify', { finding, diff: context.request.diff || '',
        outputShape: { isReal: 'boolean', confidence: 'number 0..1', reasoning: 'string' } });
      if (typeof verification.isReal !== 'boolean' || typeof verification.confidence !== 'number'
        || verification.confidence < 0 || verification.confidence > 1) throw new Error('Invalid verifier result.');
      if (verification.isReal || verification.confidence < 0.8) blocking.push({ ...finding, verification });
    } catch { incomplete = true; blocking.push(finding); }
  }
  return { verdict: incomplete || blocking.length ? 'CHANGES_REQUESTED' : 'APPROVE', incomplete, blocking, findings: unique,
    stats: { raw: collected.length, unique: unique.length }, status: 'reviewed' };
}

async function gan(context, skipPlan = false) {
  io.distinct(context.config, 'generator', 'evaluator');
  const mode = context.request.evalMode || 'playwright';
  if (!['code-only', 'playwright'].includes(mode)) throw new Error('Invalid evaluation mode.');
  if (mode === 'playwright' && !context.config.roles.evaluator.availableTools?.some(tool => /browser|playwright/.test(tool))) throw new Error('Configure browser evaluation tools or explicitly request code-only evaluation.');
  const plan = skipPlan ? { spec: context.request.task, rubric: ['Project verification passes'] }
    : await model(context, 'planner', 'plan', { outputShape: { spec: 'string', rubric: ['string'] } });
  if (typeof plan.spec !== 'string' || !Array.isArray(plan.rubric) || !plan.rubric.length || plan.rubric.length > 20) throw new Error('Invalid GAN specification.');
  const limit = Math.min(context.request.maxIterations || context.config.limits.maxIterations, context.config.limits.maxIterations);
  const iterations = [];
  for (let index = 0; index < limit; index++) {
    const generated = await model(context, 'generator', 'generate', { spec: plan.spec, rubric: plan.rubric, feedback: iterations.at(-1)?.evaluation || null });
    const evaluation = await model(context, 'evaluator', 'evaluate', { spec: plan.spec, rubric: plan.rubric, generated,
      evalMode: mode, outputShape: { score: 'number 0..10', evidence: ['verification evidence'], findings: ['string'] } });
    if (typeof evaluation.score !== 'number' || !Number.isFinite(evaluation.score) || evaluation.score < 0 || evaluation.score > 10
      || !Array.isArray(evaluation.evidence) || (mode === 'playwright' && !evaluation.evidence.length)) throw new Error('Missing or invalid evaluator evidence.');
    iterations.push({ index: index + 1, evaluation });
    if (evaluation.score >= 8) return { status: 'passed', evalMode: mode, iterations };
    if (iterations.length >= 3 && iterations.slice(-3).every(item => item.evaluation.score === evaluation.score)) return { status: 'plateau', evalMode: mode, iterations };
  }
  return { status: 'budget-exhausted', evalMode: mode, iterations };
}

async function multi(context) {
  io.distinct(context.config, 'backend', 'frontend');
  const contextData = { task: context.request.task, workflow: context.request.command,
    focus: context.request.command === 'multi-backend' ? 'backend' : context.request.command === 'multi-frontend' ? 'frontend' : 'full',
    diff: context.request.diff || '', changedFiles: context.request.changedFiles || [] };
  const analyses = await Promise.all(['backend', 'frontend'].map(role => model(context, role, 'analyze', { context: contextData,
    outputShape: { summary: 'string with findings, risks and design' } })));
  const plan = await model(context, 'planner', 'plan', { analyses, outputShape: { spec: 'string', rubric: ['string'] } });
  if (typeof plan.spec !== 'string' || !Array.isArray(plan.rubric)) throw new Error('Invalid consolidated multi-model plan.');
  return { status: 'awaiting-approval', analyses, plan };
}

async function run(request, cwd, env = process.env) {
  validateRequest(request);
  if (request.command === 'loop-status') return { runs: request.runId ? [io.readRun(cwd, request.runId, env)] : io.listRuns(cwd, env) };
  if (request.command === 'loop-start' && !request.launch) {
    if (!request.task?.trim()) throw new Error('A loop requires a task.');
    const record = { schema: 'ecc.copilot.run.v1', runId: crypto.randomUUID(), workspace: cwd, command: request.command,
      request, status: 'prepared', result: { status: 'prepared' }, updatedAt: new Date().toISOString() };
    io.writeRun(cwd, record, env);
    return { runId: record.runId, result: record.result };
  }
  const stored = request.command === 'multi-execute' ? io.readRun(cwd, request.planRunId, env)
    : request.command === 'loop-start' ? io.readRun(cwd, request.runId, env) : null;
  if (request.command === 'multi-execute' && (!request.approved || stored.result?.status !== 'awaiting-approval')) throw new Error('Execution requires a stored plan and explicit approval.');
  if (stored && request.command === 'loop-start' && stored.status !== 'prepared') throw new Error('Only prepared loops can be started.');
  const effective = { ...stored?.request, ...request, task: request.task || stored?.request.task };
  if (request.command === 'loop-start' && !effective.evalMode) effective.evalMode = 'code-only';
  if (!effective.task?.trim()) throw new Error('A task is required.');
  const config = io.loadConfig(cwd, env);
  const context = { request: effective, config, options: { cwd, env, deadline: Date.now() + config.limits.budgetMs } };
  const record = { schema: 'ecc.copilot.run.v1', runId: stored && request.command === 'loop-start' ? stored.runId : crypto.randomUUID(),
    workspace: cwd, command: request.command, request: effective, status: 'running', updatedAt: new Date().toISOString() };
  io.writeRun(cwd, record, env);
  try {
    let result;
    if (request.command.startsWith('gan-') || request.command === 'loop-start') result = await gan(context, request.command === 'loop-start');
    else if (['orch-review', 'santa-loop'].includes(request.command)) {
      result = await review(context, request.command === 'orch-review');
      if (request.command === 'santa-loop') result = { ...result, verdict: result.verdict === 'APPROVE' ? 'NICE' : 'NAUGHTY' };
    } else if (request.command === 'multi-execute') {
      io.distinct(config, 'reviewerA', 'reviewerB');
      await model(context, 'generator', 'generate', { plan: stored.result.plan });
      result = await review(context, false);
    } else result = await multi(context);
    io.writeRun(cwd, { ...record, status: result.status, result, updatedAt: new Date().toISOString() }, env);
    return { runId: record.runId, result };
  } catch (error) {
    io.writeRun(cwd, { ...record, status: 'failed', error: 'Execution failed; inspect backend configuration and verified evidence.', updatedAt: new Date().toISOString() }, env);
    throw error;
  }
}

module.exports = { COMMANDS, run, review, gan, multi, validateRequest };
