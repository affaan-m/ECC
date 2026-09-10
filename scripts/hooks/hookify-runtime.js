#!/usr/bin/env node
/**
 * ECC-native Hookify runtime.
 *
 * Loads project-local Hookify markdown rules and evaluates them against
 * Claude Code lifecycle payloads. Invalid configuration fails open with a
 * diagnostic; matched rules use structured hook output.
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { StringDecoder } = require('string_decoder');
const vm = require('vm');

const MAX_STDIN_BYTES = 1024 * 1024;
const MAX_RULE_BYTES = 64 * 1024;
const MAX_RULES = 100;
const MAX_PATTERN_CHARS = 512;
const MAX_MESSAGE_CHARS = 8000;
const MAX_FIELD_CHARS = 64 * 1024;
const REGEX_TIMEOUT_MS = 25;
const REGEX_TEST_SCRIPT = new vm.Script('values.some(value => regex.test(value))');
const VALID_EVENTS = new Set(['bash', 'file', 'stop', 'prompt', 'all']);
const VALID_ACTIONS = new Set(['warn', 'block']);
const VALID_OPERATORS = new Set([
  'regex_match', 'contains', 'equals', 'not_contains', 'starts_with', 'ends_with',
]);
const VALID_FIELDS = new Set([
  'command', 'content', 'file_path', 'last_assistant_message',
  'new_string', 'new_text', 'old_string', 'old_text', 'prompt',
  'reason', 'tool_name', 'tool_response', 'user_prompt',
]);
const VALID_RULE_KEYS = new Set([
  'name', 'enabled', 'event', 'action', 'pattern', 'conditions', 'tool_matcher',
]);
const VALID_CONDITION_KEYS = new Set(['field', 'operator', 'pattern']);

function sanitizeDiagnostic(value) {
  return String(value || '')
    // eslint-disable-next-line no-control-regex
    .replace(/\x1b(?:\[[0-9;?]*[A-Za-z]|\][^\x07\x1b]*(?:\x07|\x1b\\)|\([A-Z]|[A-Z])/g, '')
    .replace(/[^\x20-\x7E]/g, '?')
    .slice(0, 500);
}

function sanitizeMessage(value) {
  return String(value || '')
    // eslint-disable-next-line no-control-regex
    .replace(/\x1b(?:\[[0-9;?]*[A-Za-z]|\][^\x07\x1b]*(?:\x07|\x1b\\)|\([A-Z]|[A-Z])/g, '')
    // Keep newline and tab for Markdown while dropping other control bytes.
    // eslint-disable-next-line no-control-regex
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '')
    .trim();
}

function diagnostic(fileName, message) {
  return '[Hookify] ' + sanitizeDiagnostic(fileName) + ': ' + sanitizeDiagnostic(message);
}

function isPlainObject(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function extractFrontmatter(source) {
  const normalized = String(source || '').replace(/^\uFEFF/, '');
  const match = normalized.match(/^---[ \t]*\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/);
  if (!match) return null;
  return { yaml: match[1], message: normalized.slice(match[0].length) };
}

function parseScalar(rawValue) {
  const value = String(rawValue || '').trim();
  if (value.toLowerCase() === 'true') return true;
  if (value.toLowerCase() === 'false') return false;
  if (value.startsWith('"') && value.endsWith('"')) {
    try {
      return JSON.parse(value);
    } catch {
      throw new Error('invalid double-quoted scalar');
    }
  }
  if (value.startsWith("'") && value.endsWith("'")) {
    return value.slice(1, -1).replace(/''/g, "'");
  }
  if (value.startsWith('"') || value.endsWith('"') || value.startsWith("'") || value.endsWith("'")) {
    throw new Error('unterminated quoted scalar');
  }
  if (value.startsWith('[') || value.startsWith('{')) {
    throw new Error('flow collections are not supported in Hookify frontmatter');
  }
  return value;
}

function parseRuleFrontmatter(source) {
  const result = Object.create(null);
  const seenTopLevel = new Set();
  let conditions = null;
  let currentCondition = null;

  for (const rawLine of String(source || '').split(/\r?\n/)) {
    const trimmed = rawLine.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const indent = rawLine.length - rawLine.trimStart().length;

    if (indent === 0) {
      currentCondition = null;
      const separator = rawLine.indexOf(':');
      if (separator <= 0) throw new Error('invalid top-level frontmatter line');
      const key = rawLine.slice(0, separator).trim();
      const rawValue = rawLine.slice(separator + 1);
      if (seenTopLevel.has(key)) throw new Error('duplicate frontmatter key: ' + key);
      seenTopLevel.add(key);
      if (key === 'conditions') {
        if (rawValue.trim()) throw new Error('conditions must be a YAML list');
        conditions = [];
        result.conditions = conditions;
      } else {
        result[key] = parseScalar(rawValue);
      }
      continue;
    }

    if (!conditions) throw new Error('nested values are only supported under conditions');
    if (trimmed.startsWith('- ')) {
      const item = trimmed.slice(2);
      const separator = item.indexOf(':');
      if (separator <= 0) throw new Error('invalid condition list item');
      currentCondition = Object.create(null);
      const key = item.slice(0, separator).trim();
      currentCondition[key] = parseScalar(item.slice(separator + 1));
      conditions.push(currentCondition);
      continue;
    }
    if (!currentCondition) throw new Error('condition property is missing a list item');
    const separator = trimmed.indexOf(':');
    if (separator <= 0) throw new Error('invalid condition property');
    const key = trimmed.slice(0, separator).trim();
    if (Object.prototype.hasOwnProperty.call(currentCondition, key)) {
      throw new Error('duplicate condition key: ' + key);
    }
    currentCondition[key] = parseScalar(trimmed.slice(separator + 1));
  }

  return result;
}

function isSafeRegexSource(pattern) {
  if (!pattern || pattern.length > MAX_PATTERN_CHARS) return false;
  if (/\\[1-9]/.test(pattern) || /\(\?<([=!])/.test(pattern)) return false;
  // Reject common catastrophic nested-quantifier and ambiguous-alternation
  // shapes such as (a+)+, ([a-z]+){2,}, and (a|aa)+.
  if (/(?:\([^()]*(?:\*|\+|\{\d+(?:,\d*)?\})[^()]*\)|\[[^\]]*\](?:\*|\+|\{\d+(?:,\d*)?\}))\s*(?:\*|\+|\{\d+(?:,\d*)?\})/.test(pattern)) {
    return false;
  }
  if (/\([^()]*(?:\|)[^()]*\)\s*(?:\*|\+|\{\d+(?:,\d*)?\})/.test(pattern)) {
    return false;
  }
  if (/(?:\.\*|\.\+)(?:[^|)]{0,32})(?:\.\*|\.\+)/.test(pattern)) return false;
  // Reject quantified groups containing any quantifier, including nested
  // parentheses that the simpler one-level detector cannot model.
  const quantifiedGroup = /\)\s*(?:\*|\+|\{\d+(?:,\d*)?\})/g;
  let match;
  while ((match = quantifiedGroup.exec(pattern)) !== null) {
    let depth = 1;
    let cursor = match.index - 1;
    for (; cursor >= 0; cursor -= 1) {
      if (pattern[cursor] === ')' && pattern[cursor - 1] !== '\\') depth += 1;
      if (pattern[cursor] === '(' && pattern[cursor - 1] !== '\\') {
        depth -= 1;
        if (depth === 0) break;
      }
    }
    if (cursor >= 0) {
      const groupBody = pattern.slice(cursor + 1, match.index);
      if (/(?:^|[^\\])(?:\*|\+|\{\d+(?:,\d*)?\})/.test(groupBody)) return false;
    }
  }
  return true;
}

function compileRegex(pattern) {
  if (typeof pattern !== 'string' || !isSafeRegexSource(pattern)) {
    throw new Error('pattern must be a non-empty bounded regex without nested quantifiers');
  }
  try {
    return new RegExp(pattern, 'i');
  } catch {
    // Do not echo the user-authored pattern into hook diagnostics. Patterns
    // may intentionally target secret-shaped strings.
    throw new Error('invalid regex syntax');
  }
}

function testRegex(regex, textOrValues) {
  const values = Array.isArray(textOrValues) ? textOrValues : [textOrValues];
  try {
    return REGEX_TEST_SCRIPT.runInNewContext(
      { regex, values },
      { timeout: REGEX_TIMEOUT_MS }
    );
  } catch (error) {
    if (error && error.code === 'ERR_SCRIPT_EXECUTION_TIMEOUT') {
      const timeoutError = new Error('regex evaluation exceeded ' + REGEX_TIMEOUT_MS + 'ms');
      timeoutError.code = 'HOOKIFY_REGEX_TIMEOUT';
      throw timeoutError;
    }
    throw error;
  }
}

function normalizeCondition(value) {
  if (!isPlainObject(value)) throw new Error('conditions must contain objects');
  const unknownKeys = Object.keys(value).filter(key => !VALID_CONDITION_KEYS.has(key));
  if (unknownKeys.length > 0) throw new Error('unsupported condition key: ' + unknownKeys[0]);
  const field = String(value.field || '').trim();
  const operator = String(value.operator || 'regex_match').trim();
  const pattern = value.pattern;
  if (!VALID_FIELDS.has(field)) throw new Error('unsupported condition field: ' + (field || '<empty>'));
  if (!VALID_OPERATORS.has(operator)) throw new Error('unsupported condition operator: ' + (operator || '<empty>'));
  if (typeof pattern !== 'string' || pattern.length > MAX_PATTERN_CHARS) {
    throw new Error('condition pattern must be a bounded string');
  }
  return Object.freeze({
    field,
    operator,
    pattern,
    regex: operator === 'regex_match' ? compileRegex(pattern) : null,
  });
}

function normalizeRule(frontmatter, message, sourcePath) {
  if (!isPlainObject(frontmatter)) throw new Error('frontmatter must be a YAML mapping');
  const unknownKeys = Object.keys(frontmatter).filter(key => !VALID_RULE_KEYS.has(key));
  if (unknownKeys.length > 0) throw new Error('unsupported frontmatter key: ' + unknownKeys[0]);
  const name = String(frontmatter.name || '').trim();
  const event = String(frontmatter.event || 'all').trim().toLowerCase();
  const action = String(frontmatter.action || 'warn').trim().toLowerCase();
  const toolMatcher = frontmatter.tool_matcher === undefined
    ? null
    : String(frontmatter.tool_matcher || '').trim();

  if (!name || name.length > 100) throw new Error('name must contain 1-100 characters');
  if (frontmatter.enabled !== undefined && typeof frontmatter.enabled !== 'boolean') {
    throw new Error('enabled must be true or false');
  }
  if (!VALID_EVENTS.has(event)) throw new Error('unsupported event: ' + event);
  if (!VALID_ACTIONS.has(action)) throw new Error('unsupported action: ' + action);
  if (toolMatcher !== null && (!toolMatcher || toolMatcher.length > MAX_PATTERN_CHARS)) {
    throw new Error('tool_matcher must be a bounded non-empty string');
  }

  const conditions = frontmatter.conditions === undefined ? [] : frontmatter.conditions;
  if (!Array.isArray(conditions) || conditions.length > 16) {
    throw new Error('conditions must be an array with at most 16 entries');
  }
  const normalizedConditions = conditions.map(normalizeCondition);
  const simplePattern = frontmatter.pattern;
  if (normalizedConditions.length === 0 && typeof simplePattern !== 'string') {
    throw new Error('rule requires pattern or conditions');
  }
  const regex = normalizedConditions.length === 0 ? compileRegex(simplePattern) : null;
  const safeMessage = sanitizeMessage(message);
  if (!safeMessage) throw new Error('message body must not be empty');

  return Object.freeze({
    name,
    enabled: frontmatter.enabled !== false,
    event,
    action,
    pattern: typeof simplePattern === 'string' ? simplePattern : null,
    regex,
    conditions: Object.freeze(normalizedConditions),
    toolMatcher,
    message: safeMessage,
    sourcePath,
  });
}

function readRuleFile(filePath) {
  const stat = fs.lstatSync(filePath);
  if (stat.isSymbolicLink()) throw new Error('symbolic links are not loaded');
  if (!stat.isFile()) throw new Error('rule path is not a regular file');
  if (stat.size > MAX_RULE_BYTES) throw new Error('rule exceeds ' + MAX_RULE_BYTES + ' bytes');

  const noFollow = fs.constants.O_NOFOLLOW || 0;
  const fd = fs.openSync(filePath, fs.constants.O_RDONLY | noFollow);
  try {
    const openedStat = fs.fstatSync(fd);
    if (!openedStat.isFile() || openedStat.size > MAX_RULE_BYTES) {
      throw new Error('rule exceeds ' + MAX_RULE_BYTES + ' bytes or is not a regular file');
    }
    const source = fs.readFileSync(fd, 'utf8');
    const document = extractFrontmatter(source);
    if (!document) throw new Error('missing YAML frontmatter');
    const frontmatter = parseRuleFrontmatter(document.yaml);
    return normalizeRule(frontmatter, document.message, filePath);
  } finally {
    fs.closeSync(fd);
  }
}

function loadRules(projectRoot) {
  const rules = [];
  const diagnostics = [];
  const rulesDir = path.join(path.resolve(projectRoot), '.claude');
  let entries;
  try {
    const dirStat = fs.lstatSync(rulesDir);
    if (dirStat.isSymbolicLink() || !dirStat.isDirectory()) {
      return { rules, diagnostics: [diagnostic('.claude', 'rule directory must be a real directory')] };
    }
    entries = fs.readdirSync(rulesDir, { withFileTypes: true });
  } catch (error) {
    if (error && error.code === 'ENOENT') return { rules, diagnostics };
    return { rules, diagnostics: [diagnostic('.claude', error.message)] };
  }

  const candidates = entries
    .filter(entry => /^hookify\.[^/\\]+\.local\.md$/.test(entry.name))
    .sort((left, right) => left.name.localeCompare(right.name));
  if (candidates.length > MAX_RULES) {
    diagnostics.push(diagnostic('.claude', 'only the first ' + MAX_RULES + ' Hookify rules are loaded'));
  }
  for (const entry of candidates.slice(0, MAX_RULES)) {
    try {
      const rule = readRuleFile(path.join(rulesDir, entry.name));
      if (rule.enabled) rules.push(rule);
    } catch (error) {
      diagnostics.push(diagnostic(entry.name, error.message));
    }
  }
  return { rules, diagnostics };
}

function resolveProjectRoot(cwd, env) {
  const configured = String(env.CLAUDE_PROJECT_DIR || '').trim();
  return path.resolve(configured || cwd || process.cwd());
}

function toBoundedText(value) {
  if (typeof value === 'string') return value.slice(0, MAX_FIELD_CHARS);
  if (value === undefined || value === null) return '';
  try {
    return JSON.stringify(value).slice(0, MAX_FIELD_CHARS);
  } catch {
    return String(value).slice(0, MAX_FIELD_CHARS);
  }
}

function fileValues(toolInput) {
  const values = [toolInput.file_path, toolInput.path, toolInput.content, toolInput.new_string];
  if (Array.isArray(toolInput.edits)) {
    for (const edit of toolInput.edits.slice(0, 100)) {
      if (!isPlainObject(edit)) continue;
      values.push(edit.file_path, edit.path, edit.content, edit.new_string);
    }
  }
  return values.map(toBoundedText).filter(Boolean);
}

function eventAlias(input) {
  const hookEvent = String(input.hook_event_name || '');
  if (hookEvent === 'UserPromptSubmit') return 'prompt';
  if (hookEvent === 'Stop') return 'stop';
  if (hookEvent !== 'PreToolUse' && hookEvent !== 'PostToolUse') return null;
  const toolName = String(input.tool_name || '').toLowerCase();
  if (toolName === 'bash' || toolName === 'powershell') return 'bash';
  if (toolName === 'write' || toolName === 'edit' || toolName === 'multiedit') return 'file';
  return 'tool';
}

function simpleValues(rule, input, alias) {
  const toolInput = isPlainObject(input.tool_input) ? input.tool_input : {};
  if (rule.event === 'all') {
    const values = [
      input.prompt, input.user_prompt, input.reason, input.last_assistant_message,
      input.tool_name, toolInput.command, ...fileValues(toolInput), input.tool_response,
    ].map(toBoundedText).filter(Boolean);
    return values.length > 0 ? values : [''];
  }
  if (alias === 'bash') return [toBoundedText(toolInput.command)].filter(Boolean);
  if (alias === 'file') return fileValues(toolInput);
  if (alias === 'prompt') return [toBoundedText(input.prompt || input.user_prompt)].filter(Boolean);
  if (alias === 'stop') {
    const stopValues = [toBoundedText(input.last_assistant_message), toBoundedText(input.reason)];
    return stopValues.some(Boolean) ? stopValues.filter(Boolean) : [''];
  }
  return [];
}

function fieldValue(field, input) {
  const toolInput = isPlainObject(input.tool_input) ? input.tool_input : {};
  const edits = Array.isArray(toolInput.edits) ? toolInput.edits.filter(isPlainObject).slice(0, 100) : [];
  const editField = key => edits.map(edit => edit[key]).map(toBoundedText).filter(Boolean);
  const present = value => (value === undefined || value === null ? null : toBoundedText(value));
  const joined = values => {
    const available = values.filter(value => value !== undefined && value !== null);
    return available.length > 0 ? available.map(toBoundedText).join('\n') : null;
  };
  switch (field) {
    case 'command': return present(toolInput.command);
    case 'file_path': return joined([toolInput.file_path, toolInput.path, ...editField('file_path'), ...editField('path')]);
    case 'content': return joined([toolInput.content, toolInput.new_string, ...editField('content'), ...editField('new_string')]);
    case 'new_text':
    case 'new_string': return joined([toolInput.new_string, ...editField('new_string')]);
    case 'old_text':
    case 'old_string': return joined([toolInput.old_string, ...editField('old_string')]);
    case 'prompt':
    case 'user_prompt': return present(input.prompt ?? input.user_prompt);
    case 'last_assistant_message': return present(input.last_assistant_message);
    case 'reason': return present(input.reason);
    case 'tool_name': return present(input.tool_name);
    case 'tool_response': return present(input.tool_response);
    default: return null;
  }
}

function matchesTool(matcher, toolName) {
  if (!matcher || matcher === '*') return true;
  const actual = String(toolName || '').toLowerCase();
  return matcher.split('|').map(value => value.trim().toLowerCase()).filter(Boolean).includes(actual);
}

function matchesCondition(condition, input) {
  const value = fieldValue(condition.field, input);
  if (value === null) return false;
  switch (condition.operator) {
    case 'regex_match': return testRegex(condition.regex, value);
    case 'contains': return value.includes(condition.pattern);
    case 'equals': return value === condition.pattern;
    case 'not_contains': return !value.includes(condition.pattern);
    case 'starts_with': return value.startsWith(condition.pattern);
    case 'ends_with': return value.endsWith(condition.pattern);
    default: return false;
  }
}

function conditionCandidates(input) {
  const toolInput = isPlainObject(input.tool_input) ? input.tool_input : {};
  if (String(input.tool_name || '').toLowerCase() !== 'multiedit' || !Array.isArray(toolInput.edits)) {
    return [input];
  }
  const edits = toolInput.edits.filter(isPlainObject).slice(0, 100);
  if (edits.length === 0) return [input];
  return edits.map(edit => ({
    ...input,
    tool_input: {
      ...toolInput,
      ...edit,
      edits: [],
    },
  }));
}

function ruleMatches(rule, input, alias) {
  if (rule.event !== 'all' && rule.event !== alias) return false;
  if (!matchesTool(rule.toolMatcher, input.tool_name)) return false;
  if (rule.conditions.length > 0) {
    return conditionCandidates(input).some(candidate => (
      rule.conditions.every(condition => matchesCondition(condition, candidate))
    ));
  }
  return testRegex(rule.regex, simpleValues(rule, input, alias));
}

function renderMatches(rules) {
  const text = rules.map(rule => '**[' + sanitizeMessage(rule.name) + ']**\n' + rule.message).join('\n\n');
  if (text.length <= MAX_MESSAGE_CHARS) return text;
  const marker = '\n\n[Hookify output truncated]';
  return text.slice(0, MAX_MESSAGE_CHARS - marker.length) + marker;
}

function buildOutput(input, matchedRules) {
  const blockers = matchedRules.filter(rule => rule.action === 'block');
  const message = renderMatches(blockers.length > 0 ? blockers : matchedRules);
  const hookEvent = String(input.hook_event_name || '');
  if (blockers.length > 0) {
    if (hookEvent === 'PreToolUse') {
      return {
        hookSpecificOutput: {
          hookEventName: 'PreToolUse',
          permissionDecision: 'deny',
          permissionDecisionReason: message,
        },
      };
    }
    return { decision: 'block', reason: message };
  }
  return { hookSpecificOutput: { hookEventName: hookEvent, additionalContext: message } };
}

function parseInput(inputOrRaw) {
  if (typeof inputOrRaw !== 'string') return isPlainObject(inputOrRaw) ? inputOrRaw : null;
  try {
    const parsed = inputOrRaw.trim() ? JSON.parse(inputOrRaw) : {};
    return isPlainObject(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function run(inputOrRaw, options = {}) {
  const raw = typeof inputOrRaw === 'string' ? inputOrRaw : JSON.stringify(inputOrRaw || {});
  const passThrough = { raw, stdout: raw, stderr: '', exitCode: 0 };
  if (options.truncated) {
    return { ...passThrough, stderr: diagnostic('input', 'payload exceeded ' + (options.maxStdin || MAX_STDIN_BYTES) + ' bytes; rule evaluation skipped') };
  }
  const input = parseInput(inputOrRaw);
  if (!input) return { ...passThrough, stderr: diagnostic('input', 'invalid hook JSON; rule evaluation skipped') };
  const alias = eventAlias(input);
  if (!alias || (alias === 'stop' && input.stop_hook_active === true)) return passThrough;

  const env = options.env || process.env;
  const loaded = loadRules(resolveProjectRoot(options.cwd || process.cwd(), env));
  const diagnostics = [...loaded.diagnostics];
  const matchedRules = [];
  for (const rule of loaded.rules) {
    try {
      if (ruleMatches(rule, input, alias)) matchedRules.push(rule);
    } catch (error) {
      diagnostics.push(diagnostic(path.basename(rule.sourcePath), error.message));
    }
  }
  if (matchedRules.length === 0) return { ...passThrough, stderr: diagnostics.join('\n') };
  return {
    raw,
    stdout: JSON.stringify(buildOutput(input, matchedRules)),
    stderr: diagnostics.join('\n'),
    exitCode: 0,
  };
}

function readStdin() {
  return new Promise(resolve => {
    const decoder = new StringDecoder('utf8');
    let raw = '';
    let bytes = 0;
    let truncated = false;
    process.stdin.on('data', chunk => {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      const remaining = Math.max(0, MAX_STDIN_BYTES - bytes);
      const accepted = buffer.subarray(0, remaining);
      if (accepted.length > 0) {
        raw += decoder.write(accepted);
        bytes += accepted.length;
      }
      if (accepted.length < buffer.length) truncated = true;
    });
    process.stdin.once('end', () => {
      if (!truncated) raw += decoder.end();
      resolve({ raw, truncated });
    });
    process.stdin.once('error', () => resolve({ raw, truncated: true }));
  });
}

async function main() {
  const input = await readStdin();
  const result = run(input.raw, { truncated: input.truncated, maxStdin: MAX_STDIN_BYTES });
  if (result.stderr) process.stderr.write(result.stderr + '\n');
  if (result.stdout && result.stdout !== input.raw) process.stdout.write(result.stdout);
  process.exitCode = 0;
}

if (require.main === module) {
  main().catch(error => {
    process.stderr.write(diagnostic('runtime', error.message) + '\n');
    process.exitCode = 0;
  });
}

module.exports = {
  MAX_FIELD_CHARS,
  MAX_MESSAGE_CHARS,
  MAX_PATTERN_CHARS,
  MAX_RULE_BYTES,
  MAX_RULES,
  REGEX_TIMEOUT_MS,
  buildOutput,
  conditionCandidates,
  eventAlias,
  extractFrontmatter,
  loadRules,
  normalizeRule,
  parseRuleFrontmatter,
  ruleMatches,
  run,
  testRegex,
};
