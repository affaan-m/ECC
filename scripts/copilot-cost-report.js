#!/usr/bin/env node
'use strict';
const fs = require('fs');
const path = require('path');
const { configRoot, sessionId } = require('./lib/copilot-sessions');
const { readSessionEvents } = require('./lib/copilot-native-events');

function amount(value, integer = true) {
  if (value === undefined) return null;
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || (integer && !Number.isSafeInteger(value))) throw new Error('Invalid cumulative usage quantity.');
  return value;
}
function summarize(id, events) {
  const snapshots = events.filter(event => ['session.shutdown', 'session.usage_checkpoint'].includes(event.type));
  const latest = snapshots.at(-1);
  const shutdown = snapshots.findLast(event => event.type === 'session.shutdown');
  const modelMetrics = {};
  for (const [model, metrics] of Object.entries(shutdown?.data?.modelMetrics || {})) {
    if (model.length > 100 || !metrics || typeof metrics !== 'object') throw new Error('Invalid model usage record.');
    modelMetrics[model] = { usage: Object.fromEntries(['inputTokens', 'outputTokens', 'cacheReadTokens', 'cacheWriteTokens', 'reasoningTokens'].map(key => [key, amount(metrics.usage?.[key])])),
      requests: { count: amount(metrics.requests?.count) }, totalNanoAiu: amount(metrics.totalNanoAiu) };
  }
  return { sessionId: id, totalNanoAiu: amount(latest?.data?.totalNanoAiu), totalPremiumRequests: amount(latest?.data?.totalPremiumRequests, false),
    complete: latest?.type === 'session.shutdown' && latest.data.totalNanoAiu !== undefined, modelMetrics };
}
function run(args, cwd, env = process.env) {
  let id; let csv = false;
  for (let index = 0; index < args.length; index++) {
    if (args[index] === '--session' && !id && args[index + 1]) id = sessionId(args[++index]);
    else if (args[index] === '--csv' && !csv) csv = true;
    else throw new Error('Usage: copilot-cost-report.js [--session <id>] [--csv]');
  }
  const root = path.join(configRoot(env), 'session-state');
  const names = id ? [id] : fs.readdirSync(root);
  if (names.length > 1000) throw new Error('Session scan limit exceeded; select one native session.');
  let bytes = 0;
  const sessions = [];
  for (const name of names) {
    sessionId(name);
    let source;
    try { source = readSessionEvents(name, cwd, env); }
    catch (error) { if (!id && error.code === 'ECC_COPILOT_FOREIGN_SESSION') continue; throw error; }
    bytes += source.bytes;
    if (bytes > 64 * 1024 * 1024) throw new Error('Aggregate usage scan limit exceeded; select one session.');
    sessions.push(summarize(name, source.events));
  }
  const known = sessions.filter(session => session.totalNanoAiu !== null);
  const total = known.length ? known.reduce((sum, session) => sum + session.totalNanoAiu, 0) : null;
  if (total !== null && !Number.isSafeInteger(total)) throw new Error('Usage aggregate exceeds exact numeric range.');
  const result = { schema: 'ecc.copilot.usage.v1', totalNanoAiu: total, estimatedCostUsd: null,
    complete: sessions.length > 0 && sessions.every(session => session.complete), sessions,
    note: 'Native nano-AI units and premium request counts are accounting quantities, not USD prices. Missing data is unavailable.' };
  return csv ? ['session_id,total_nano_aiu,total_premium_requests,complete', ...sessions.map(session =>
    [session.sessionId, session.totalNanoAiu ?? '', session.totalPremiumRequests ?? '', session.complete].join(','))].join('\n') : JSON.stringify(result);
}
module.exports = { run, summarize, amount };
if (require.main === module) {
  try { process.stdout.write(run(process.argv.slice(2), fs.realpathSync(process.cwd())) + '\n'); }
  catch { process.stdout.write('{"error":"Usage unavailable: missing, malformed, foreign, oversized or unsafe native session data."}\n'); process.exitCode = 1; }
}
