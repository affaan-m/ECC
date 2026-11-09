'use strict';
const TOOL_ALIASES = Object.freeze({
  read: 'read', notebookread: 'read', grep: 'search', glob: 'search', search: 'search',
  edit: 'edit', multiedit: 'edit', write: 'edit', notebookedit: 'edit',
  bash: 'execute', powershell: 'execute', shell: 'execute', execute: 'execute',
  task: 'agent', agent: 'agent', 'custom-agent': 'agent',
  websearch: 'web', webfetch: 'web', web: 'web', todowrite: 'todo', todo: 'todo',
});
const NATIVE_GROUPS = new Set(Object.values(TOOL_ALIASES));
const READ_ONLY_ROLES = /(?:^|[-/])(?:[^/]*reviewer|[^/]*analyzer|agent-evaluator)(?:\.agent)?(?:\.md)?$/i;
function object(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Agent configuration must be an object.');
  return value;
}
function nativeTool(value) {
  return typeof value === 'string' && (NATIVE_GROUPS.has(value)
    || /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}\/[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/.test(value));
}
function list(value, validator, maximum) {
  if (!Array.isArray(value) || value.length > maximum || value.some(item => !validator(item))
    || new Set(value).size !== value.length) throw new Error('Invalid verified agent capability list.');
  return [...value];
}
function mappings(value = {}, verifiedTools = []) {
  object(value);
  const verified = list(verifiedTools, nativeTool, 256);
  if (Object.keys(value).length > 128) throw new Error('Agent tool mapping quota exceeded.');
  for (const [canonical, native] of Object.entries(value)) {
    if (!/^[A-Za-z][A-Za-z0-9_.:/-]{0,127}$/.test(canonical)
      || Object.hasOwn(TOOL_ALIASES, canonical.toLowerCase())
      || !nativeTool(native) || !verified.includes(native)) {
      throw new Error('Agent mapping must select an exact verified unmapped tool; canonical aliases cannot be overridden.');
    }
  }
  return { ...value };
}
function model(value) { return typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}$/.test(value); }
module.exports = { TOOL_ALIASES, READ_ONLY_ROLES, nativeTool, mappings, list, model, object };
