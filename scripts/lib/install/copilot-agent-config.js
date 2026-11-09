'use strict';
// Only the launch environment selects this operator file. No project discovery,
// hook payload, instruction, checkpoint or agent body can supply its path.
const fs = require('fs');
const path = require('path');
const { mappings, list, model, nativeTool, object } = require('./copilot-agent-policy');
const MAX_BYTES = 64 * 1024;
function readConfig(file) {
  if (typeof file !== 'string' || !path.isAbsolute(file) || file.includes('\0')) throw new Error('Agent config path must be absolute.');
  for (let cursor = file; ; cursor = path.dirname(cursor)) {
    const stat = fs.lstatSync(cursor);
    if (stat.isSymbolicLink()) throw new Error('Linked agent config paths are unsupported.');
    if (path.dirname(cursor) === cursor) break;
  }
  const before = fs.lstatSync(file);
  if (!before.isFile() || before.nlink !== 1 || before.size > MAX_BYTES) throw new Error('Unsafe or oversized agent configuration.');
  const fd = fs.openSync(file, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0));
  try {
    const opened = fs.fstatSync(fd);
    if (opened.dev !== before.dev || opened.ino !== before.ino || !opened.isFile() || opened.nlink !== 1) throw new Error('Agent config identity changed.');
    const data = Buffer.alloc(MAX_BYTES + 1);
    let bytes = 0;
    while (bytes <= MAX_BYTES) {
      const count = fs.readSync(fd, data, bytes, data.length - bytes, null);
      if (!count) break;
      bytes += count;
    }
    if (bytes > MAX_BYTES) throw new Error('Agent configuration read limit exceeded.');
    try { return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(data.subarray(0, bytes))); }
    catch { throw new Error('Invalid operator agent configuration encoding or JSON.'); }
  } finally { fs.closeSync(fd); }
}
function validate(config) {
  object(config);
  if (config.schema !== 'ecc.copilot.agents.v1' || typeof config.cliVersion !== 'string'
    || !/^\d+\.\d+\.\d+(?:[-+][A-Za-z0-9.-]+)?$/.test(config.cliVersion)
    || Object.keys(config).some(key => !['schema', 'cliVersion', 'verifiedTools', 'verifiedModels', 'agents'].includes(key))) {
    throw new Error('Unsupported operator agent configuration.');
  }
  const verifiedTools = list(config.verifiedTools, nativeTool, 256);
  const verifiedModels = list(config.verifiedModels, model, 100);
  object(config.agents);
  if (Object.keys(config.agents).length > 100) throw new Error('Agent profile quota exceeded.');
  for (const [name, entry] of Object.entries(config.agents)) {
    if (!/^[a-z][a-z0-9-]{0,127}$/.test(name) || ['constructor', 'prototype'].includes(name)) throw new Error('Invalid configured agent identity.');
    object(entry);
    if (Object.keys(entry).some(key => !['toolMappings', 'model'].includes(key))) throw new Error('Unknown configured agent metadata.');
    mappings(entry.toolMappings, verifiedTools);
    if (entry.model !== undefined && (!model(entry.model) || !verifiedModels.includes(entry.model))) throw new Error('Agent model is not explicitly verified.');
  }
  return { ...config, verifiedTools, verifiedModels };
}
function loadAgentOptions(agentName, env = process.env) {
  if (env.ECC_COPILOT_AGENT_CONFIG === undefined) return {};
  const config = validate(readConfig(env.ECC_COPILOT_AGENT_CONFIG));
  const entry = Object.hasOwn(config.agents, agentName) ? config.agents[agentName] : {};
  return { cliVersion: config.cliVersion, verifiedTools: [...config.verifiedTools], verifiedModels: [...config.verifiedModels],
    toolMappings: mappings(entry.toolMappings, config.verifiedTools), ...(entry.model ? { model: entry.model } : {}) };
}
module.exports = { loadAgentOptions, MAX_BYTES };
