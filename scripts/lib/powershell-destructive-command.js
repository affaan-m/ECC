'use strict';

/**
 * Pure PowerShell destructive-command classifier.
 *
 * This is deliberately a small policy parser rather than a PowerShell
 * interpreter. It understands the quoting, escaping, subexpression, and
 * nested-shell forms needed to make GateGuard and governance reach the same
 * decision without retaining raw command text.
 */

const RULE_IDS = Object.freeze({
  REMOVE_RECURSE: 'powershell.remove-item.recurse',
  REMOVE_FORCE: 'powershell.remove-item.force',
  REMOVE_WILDCARD: 'powershell.remove-item.wildcard',
  REMOVE_SPLAT: 'powershell.remove-item.splat',
  PIPELINE_RECURSE: 'powershell.remove-item.pipeline-recurse',
  CLEAR_CONTENT: 'powershell.clear-content',
  CLEAR_DISK: 'powershell.clear-disk',
  FORMAT_VOLUME: 'powershell.format-volume',
  DOTNET_DIRECTORY_DELETE: 'powershell.dotnet.directory-delete',
  DOTNET_FILE_DELETE: 'powershell.dotnet.file-delete',
  CMD_RECURSIVE_DELETE: 'powershell.cmd.recursive-delete',
  DYNAMIC_EXECUTION: 'powershell.dynamic-execution',
  SCAN_DEPTH_EXCEEDED: 'powershell.scan-depth-exceeded',
});

const DELETE_COMMANDS = new Set([
  'remove-item',
  'remove-itemproperty',
  'rp',
  'ri',
  'rm',
  'rmdir',
  'rd',
  'del',
  'erase',
]);

const POWERSHELL_COMMANDS = new Set(['powershell', 'pwsh']);
const CMD_DELETE_COMMANDS = new Set(['rd', 'rmdir', 'del', 'erase']);
const START_PROCESS_VALUE_PARAMETERS = new Set([
  'argumentlist',
  'credential',
  'environment',
  'filepath',
  'redirectstandarderror',
  'redirectstandardinput',
  'redirectstandardoutput',
  'verb',
  'windowstyle',
  'workingdirectory',
]);
const START_PROCESS_SWITCH_PARAMETERS = new Set([
  'loaduserprofile',
  'nonewwindow',
  'passthru',
  'usenewenvironment',
  'wait',
]);
const ALIAS_VALUE_PARAMETERS = new Set([
  'name', 'value', 'description', 'option', 'scope',
  'erroraction', 'warningaction', 'informationaction', 'progressaction',
  'errorvariable', 'warningvariable', 'informationvariable',
  'outvariable', 'outbuffer', 'pipelinevariable',
]);
const ALIAS_SWITCH_PARAMETERS = new Set([
  'force', 'passthru', 'whatif', 'confirm', 'verbose', 'debug',
]);
const ALIAS_PARAMETER_ABBREVIATIONS = Object.freeze({
  ea: 'erroraction', wa: 'warningaction', infa: 'informationaction', proga: 'progressaction',
  ev: 'errorvariable', wv: 'warningvariable', iv: 'informationvariable',
  ov: 'outvariable', ob: 'outbuffer', pv: 'pipelinevariable',
  wi: 'whatif', cf: 'confirm', vb: 'verbose', db: 'debug',
});
const MAX_SCAN_DEPTH = 4;
const MAX_CONTEXT_LENGTH = 4096;
const DYNAMIC_EXECUTION_MARKER = '__ecc_dynamic_execution__';

function normalizeSmartQuotes(value) {
  return String(value || '')
    .replace(/[\u2018\u2019\u201a\u201b]/g, "'")
    .replace(/[\u201c\u201d\u201e]/g, '"')
    .replace(/[\u2013\u2014\u2015]/g, '-');
}

function commandBasename(value) {
  const parts = String(value || '').split(/[\\/]/);
  return (parts[parts.length - 1] || '').replace(/\.exe$/i, '').toLowerCase();
}

function isParameterPrefix(token, parameter) {
  const raw = String(token || '');
  if (!raw.startsWith('-')) return false;
  const name = raw.replace(/^-+/, '').split(':')[0].toLowerCase();
  return name.length > 0 && parameter.startsWith(name);
}

function isEnabledSwitch(token, parameter) {
  if (!isParameterPrefix(token, parameter)) return false;
  const separator = String(token).indexOf(':');
  if (separator === -1) return true;
  return !/^\$?(?:false|null|0)$/i.test(String(token).slice(separator + 1));
}

function isEncodedCommandFlag(token) {
  return isParameterPrefix(token, 'encodedcommand');
}

function isCommandFlag(token) {
  const name = String(token || '').replace(/^-+/, '').split(':')[0].toLowerCase();
  return isParameterPrefix(token, 'command') ||
    isParameterPrefix(token, 'commandwithargs') || name === 'cwa';
}

/**
 * Shared inert-region tracking for the character scanners below. Comments,
 * `${}` variable names, quoted strings, and backtick escapes never contain
 * container delimiters or here-string openers, so every scanner skips them
 * the same way.
 */
function createLexState() {
  return {
    quote: null,
    lineComment: false,
    blockComment: false,
    bracedVariable: false,
    comment: false,
  };
}

/**
 * Consume the character at `index` when it belongs to an open inert region.
 * Returns the last index consumed, or -1 when the character is live and the
 * caller must interpret it. `state.comment` reports whether the consumed run
 * is comment text.
 */
function consumeInertChar(state, input, index) {
  const char = input[index];
  const next = input[index + 1];
  state.comment = false;
  if (state.lineComment) {
    if (char === '\n' || char === '\r') {
      state.lineComment = false;
    } else {
      state.comment = true;
    }
    return index;
  }
  if (state.blockComment) {
    if (char === '#' && next === '>') {
      state.blockComment = false;
      state.comment = true;
      return index + 1;
    }
    state.comment = char !== '\n' && char !== '\r';
    return index;
  }
  if (state.bracedVariable) {
    if (char === '`') return index + 1;
    if (char === '}') state.bracedVariable = false;
    return index;
  }
  if (state.quote === "'") {
    if (char === "'" && next === "'") return index + 1;
    if (char === "'") state.quote = null;
    return index;
  }
  if (char === '`') return index + 1;
  if (state.quote === '"') {
    if (char === '"') state.quote = null;
    return index;
  }
  return -1;
}

/**
 * Open an inert region at a live character. Returns the last index consumed,
 * or -1 when the character does not start a region.
 */
function openInertRegion(state, input, index) {
  const char = input[index];
  const next = input[index + 1];
  state.comment = false;
  if (char === "'" || char === '"') {
    state.quote = char;
    return index;
  }
  if (char === '$' && next === '{') {
    state.bracedVariable = true;
    return index + 1;
  }
  if (char === '<' && next === '#') {
    state.blockComment = true;
    state.comment = true;
    return index + 1;
  }
  if (char === '#') {
    state.lineComment = true;
    state.comment = true;
    return index;
  }
  return -1;
}

function hereStringOpenerLineEnd(input, index) {
  let openerLineEnd = index + 2;
  while (input[openerLineEnd] === ' ' || input[openerLineEnd] === '\t') openerLineEnd += 1;
  if (input[openerLineEnd] === '\r' && input[openerLineEnd + 1] === '\n') openerLineEnd += 1;
  return openerLineEnd;
}

function hereStringClosingEnd(input, openerLineEnd, quote) {
  for (let lineStart = openerLineEnd + 1; lineStart < input.length;) {
    let contentStart = lineStart;
    while (input[contentStart] === ' ' || input[contentStart] === '\t') contentStart += 1;
    if (input[contentStart] === quote && input[contentStart + 1] === '@') {
      return contentStart + 2;
    }
    while (lineStart < input.length && input[lineStart] !== '\n') lineStart += 1;
    if (lineStart < input.length) lineStart += 1;
  }
  return -1;
}

// Expandable here-strings execute their unescaped subexpressions while the
// string value is being formed, independently of any later consumer.
function collectHereStringSubexpressions(input, start, end, executablePayloads) {
  for (let offset = start; offset < end; offset += 1) {
    if (input[offset] === '`') {
      offset += 1;
      continue;
    }
    if (input[offset] !== '$' || input[offset + 1] !== '(') continue;
    const group = readBalancedGroup(input, offset + 1, '(', ')');
    if (!group || group.end > end) break;
    executablePayloads.push(group.body);
    offset = group.end - 1;
  }
}

function applyReplacements(output, replacements) {
  let normalized = '';
  let cursor = 0;
  for (const replacement of replacements) {
    normalized += output.slice(cursor, replacement.start).join('');
    normalized += replacement.value;
    cursor = replacement.end;
  }
  return normalized + output.slice(cursor).join('');
}

function normalizeHereStrings(input, executablePayloads = []) {
  const output = [...input];
  const replacements = [];
  const state = createLexState();

  for (let index = 0; index < input.length - 1; index += 1) {
    const inertEnd = consumeInertChar(state, input, index);
    if (inertEnd !== -1) {
      index = inertEnd;
      continue;
    }

    const quote = input[index + 1];
    if (input[index] !== '@' || (quote !== "'" && quote !== '"')) {
      const regionEnd = openInertRegion(state, input, index);
      if (regionEnd !== -1) index = regionEnd;
      continue;
    }

    const openerLineEnd = hereStringOpenerLineEnd(input, index);
    if (input[openerLineEnd] !== '\n') {
      if (openerLineEnd >= input.length) break;
      continue;
    }

    const closingEnd = hereStringClosingEnd(input, openerLineEnd, quote);
    const contentEnd = closingEnd === -1 ? input.length : closingEnd - 2;
    const content = input.slice(openerLineEnd + 1, contentEnd);

    // Represent a here-string as one ordinary literal token. Standalone
    // literals remain inert, while static consumers such as Invoke-Expression
    // and `pwsh -Command -` can recover the value from normal token flow.
    replacements.push({
      end: closingEnd === -1 ? input.length : closingEnd,
      start: index,
      value: `'${content.replace(/'/g, "''")}'`,
    });
    if (quote === '"') {
      collectHereStringSubexpressions(input, openerLineEnd + 1, contentEnd, executablePayloads);
    }

    if (closingEnd === -1) break;
    index = closingEnd - 1;
  }

  if (replacements.length === 0) return output.join('');
  return applyReplacements(output, replacements);
}

function blankRange(output, start, end) {
  for (let offset = start; offset <= end; offset += 1) {
    if (output[offset] !== '\n' && output[offset] !== '\r') output[offset] = ' ';
  }
}

function stripPowerShellComments(input) {
  const output = [...input];
  const state = createLexState();

  for (let index = 0; index < input.length; index += 1) {
    let end = consumeInertChar(state, input, index);
    if (end === -1) end = openInertRegion(state, input, index);
    if (end === -1) continue;
    if (state.comment) blankRange(output, index, end);
    index = end;
  }

  return output.join('');
}

/**
 * Read one balanced PowerShell container. Quotes do not affect delimiter
 * balance, and a backtick protects exactly the following character. Callers
 * stop after the first unmatched opener, which keeps malformed input linear.
 */
function readBalancedGroup(input, openingIndex, open, close) {
  let depth = 1;
  const state = createLexState();

  for (let index = openingIndex + 1; index < input.length; index += 1) {
    let end = consumeInertChar(state, input, index);
    if (end === -1) end = openInertRegion(state, input, index);
    if (end !== -1) {
      index = end;
      continue;
    }

    const char = input[index];
    if (char === open) {
      depth += 1;
    } else if (char === close) {
      depth -= 1;
      if (depth === 0) {
        return {
          body: input.slice(openingIndex + 1, index),
          end: index + 1,
        };
      }
    }
  }

  return null;
}

/**
 * Decide whether a script block is executed at its declaration site. Function
 * and variable declarations remain inert, while call operators, control-flow
 * clauses, and common script-block-consuming commands execute their bodies.
 */
function currentClause(prefix) {
  const clauseStart = Math.max(
    prefix.lastIndexOf(';'),
    prefix.lastIndexOf('\n'),
    prefix.lastIndexOf('\r')
  );
  return prefix.slice(clauseStart + 1).trim();
}

function invokesContainerResult(prefix, options = {}) {
  const clause = currentClause(prefix);
  const pipelineStart = clause.lastIndexOf('|');
  const pipelineCommand = clause.slice(pipelineStart + 1).trim();
  const isForeachLoopHeader = Boolean(options.groupingExpression) &&
    pipelineStart === -1 &&
    /^foreach$/i.test(pipelineCommand);
  return /(?:^|\s)(?:&|\.)\s*$/.test(clause) ||
    /\.\s*(?:foreach|where)\s*$/i.test(clause) ||
    /-(?:action|begin|command|end|expression|filter|initializationscript|parallel|process|scriptblock)(?:\s*:\s*)?$/i.test(clause) ||
    (!isForeachLoopHeader &&
      /^(?:(?:[\w.-]+\\)?(?:foreach-object|where-object|foreach|where|invoke-command|start-job|measure-command)|%|\?)(?:\s|$)/i.test(pipelineCommand));
}

function invokesDynamicResult(prefix, options = {}) {
  return invokesContainerResult(prefix, options) ||
    /(?:^|\s)(?:iex|invoke-expression)\s*$/i.test(currentClause(prefix));
}

function deferredScriptBlockName(prefix) {
  const clause = currentClause(prefix);
  const functionMatch = clause.match(/^(?:function|filter|workflow)\s+(?:(?:global|local|script|private):)?([A-Za-z_][\w-]*)\b/i);
  if (functionMatch) return functionMatch[1].toLowerCase();
  const classMatch = clause.match(/^class\s+([A-Za-z_][\w-]*)\b/i);
  if (classMatch) return `__class__:${classMatch[1].toLowerCase()}`;
  const variableMatch = clause.match(
    /^((?:\$\{[^}]+\}|\$(?:[A-Za-z_][\w-]*:)?[A-Za-z_][\w-]*(?:\[[^\]]+\]|\.[A-Za-z_][\w-]*)*))\s*=\s*$/
  );
  return variableMatch ? variableMatch[1].toLowerCase() : null;
}

function isExecutableScriptBlock(prefix, options = {}) {
  if (options.executeBareScriptBlocks) return true;
  const clause = currentClause(prefix);
  const pipelineStart = clause.lastIndexOf('|');
  const pipelineCommand = clause.slice(pipelineStart + 1).trim();

  if (invokesContainerResult(prefix)) return true;
  if (/^(?:if|elseif|else|for|foreach|while|do|switch|default|try|catch|finally|trap|begin|process|end|dynamicparam|clean)\b/i.test(clause)) {
    return true;
  }
  return /^(?:(?:[\w.-]+\\)?(?:foreach-object|where-object|foreach|where|invoke-command|start-job|measure-command)|%|\?)(?:\s|$)/i.test(pipelineCommand);
}

function isInvokedAfterContainer(input, end) {
  let index = end;
  const skipSpacing = () => {
    while (index < input.length) {
      if (/\s/.test(input[index])) {
        index += 1;
      } else if (input[index] === '`' && /[\r\n]/.test(input[index + 1] || '')) {
        index += input[index + 1] === '\r' && input[index + 2] === '\n' ? 3 : 2;
      } else {
        break;
      }
    }
  };

  while (index < input.length) {
    skipSpacing();
    if (input[index] !== '.') return false;
    index += 1;
    skipSpacing();

    let method = '';
    const quote = input[index] === "'" || input[index] === '"' ? input[index++] : null;
    while (index < input.length) {
      const char = input[index];
      if (char === '`' && index + 1 < input.length) {
        method += input[index + 1];
        index += 2;
      } else if (quote ? char === quote : !/[A-Za-z]/.test(char)) {
        if (quote) index += 1;
        break;
      } else {
        method += char;
        index += 1;
      }
    }
    skipSpacing();
    if (input[index] !== '(') return false;

    const normalizedMethod = method.toLowerCase();
    if (['invoke', 'invokereturnasis', 'invokewithcontext'].includes(normalizedMethod)) {
      return true;
    }
    if (normalizedMethod !== 'getnewclosure') return false;
    index += 1;
    skipSpacing();
    if (input[index] !== ')') return false;
    index += 1;
  }
  return false;
}

function staticStringResult(body) {
  const value = String(body || '').trim();
  if (value.length < 2) return null;
  const quote = value[0];
  if ((quote !== "'" && quote !== '"') || value[value.length - 1] !== quote) return null;
  const content = value.slice(1, -1);
  return quote === "'" ? content.replace(/''/g, "'") : decodeDoubleQuotedString(content);
}

function decodeDoubleQuotedString(content) {
  const input = String(content || '');
  let value = '';
  for (let index = 0; index < input.length; index += 1) {
    const char = input[index];
    if (char !== '`' || index + 1 >= input.length) {
      value += char;
      continue;
    }
    const escaped = input[index + 1];
    index += 1;
    if (escaped === '\r' && input[index + 1] === '\n') index += 1;
    if (escaped !== '\r' && escaped !== '\n') value += escaped;
  }
  return value;
}

function expandStaticDoubleQuotedString(content, state, findings) {
  const input = String(content || '');
  let value = '';

  for (let index = 0; index < input.length; index += 1) {
    const char = input[index];
    if (char === '`' && index + 1 < input.length) {
      const escaped = input[index + 1];
      index += 1;
      if (escaped === '\r' && input[index + 1] === '\n') index += 1;
      if (escaped !== '\r' && escaped !== '\n') value += escaped;
      continue;
    }
    if (char !== '$') {
      value += char;
      continue;
    }

    if (input[index + 1] === '(') {
      const group = readBalancedGroup(input, index + 1, '(', ')');
      const reference = group ? variableReference(group.body) : null;
      const staticValue = reference ? state?.staticScalars.get(reference) : undefined;
      if (!group || staticValue === undefined) {
        findings.add(RULE_IDS.DYNAMIC_EXECUTION);
        return null;
      }
      value += staticValue;
      index = group.end - 1;
      continue;
    }

    const referenceMatch = input.slice(index).match(
      /^(?:\$\{[^}]+\}|\$(?:[A-Za-z_][\w-]*:)?[A-Za-z_][\w-]*(?:\[[^\]]+\]|\.[A-Za-z_][\w-]*)*)/
    );
    if (!referenceMatch) {
      value += char;
      continue;
    }

    const reference = variableReference(referenceMatch[0]);
    const staticValue = reference ? state?.staticScalars.get(reference) : undefined;
    if (staticValue === undefined) {
      findings.add(RULE_IDS.DYNAMIC_EXECUTION);
      return null;
    }
    value += staticValue;
    index += referenceMatch[0].length - 1;
  }

  return value;
}

function leadingStaticStringResult(source) {
  const input = String(source || '');
  let index = 0;
  while (/\s/.test(input[index] || '')) index += 1;
  const quote = input[index];
  if (quote !== "'" && quote !== '"') return null;
  index += 1;
  let value = '';
  while (index < input.length) {
    const char = input[index];
    if (quote === "'" && char === "'" && input[index + 1] === "'") {
      value += "'";
      index += 2;
      continue;
    }
    if (quote === '"' && char === '`' && index + 1 < input.length) {
      const escaped = input[index + 1];
      index += 2;
      if (escaped === '\r' && input[index] === '\n') index += 1;
      if (escaped !== '\r' && escaped !== '\n') value += escaped;
      continue;
    }
    if (char === quote) return value;
    value += char;
    index += 1;
  }
  return null;
}

function staticScalarResult(body, depth = 0) {
  if (depth > MAX_SCAN_DEPTH) return null;
  const value = String(body || '').trim();
  const literal = staticStringResult(value);
  if (literal !== null) return literal;

  const isSubexpression = value.startsWith('$(');
  const openingIndex = isSubexpression ? 1 : 0;
  if (value[openingIndex] !== '(') return null;
  const group = readBalancedGroup(value, openingIndex, '(', ')');
  if (!group || group.end !== value.length) return null;
  return staticScalarResult(group.body, depth + 1);
}

function staticCommandResult(body) {
  const value = staticScalarResult(body);
  const command = value === null ? '' : value.trim();
  return command && /^[A-Za-z_][\w./\\-]*$/.test(command) ? command : null;
}

/**
 * Split an argument list on top-level commas, keeping quotes and nested
 * parentheses intact. Returns null for unbalanced input.
 */
function splitStaticArrayItems(input) {
  const items = [];
  let item = '';
  let quote = null;
  let depth = 0;
  for (let index = 0; index < input.length; index += 1) {
    const char = input[index];
    if (char === '`' && quote === '"' && index + 1 < input.length) {
      item += char + input[index + 1];
      index += 1;
      continue;
    }
    if (quote === "'" && char === "'" && input[index + 1] === "'") {
      item += "''";
      index += 1;
      continue;
    }
    if (char === "'" || char === '"') {
      quote = quote === char ? null : (quote || char);
      item += char;
      continue;
    }
    if (!quote) {
      if (char === '(') depth += 1;
      else if (char === ')') depth -= 1;
      else if (depth === 0 && char === ',') {
        items.push(item);
        item = '';
        continue;
      }
    }
    item += char;
  }
  if (quote || depth !== 0) return null;
  items.push(item);
  return items;
}

function staticStringArrayResult(body) {
  const items = splitStaticArrayItems(String(body || ''));
  if (!items) return null;
  const values = items.map(value => staticScalarResult(value));
  return values.length > 0 && values.every(value => value !== null)
    ? values.join(' ')
    : null;
}

function staticTypeNameResult(body) {
  const value = String(body || '').trim();
  const match = value.match(/^\[([A-Za-z_][\w-]*)\]$/);
  if (match) return match[1];
  const scalar = staticScalarResult(value);
  if (scalar !== null && /^[A-Za-z_][\w-]*$/.test(scalar)) return scalar;
  const openingIndex = value.startsWith('(') ? 0 : -1;
  if (openingIndex === -1) return null;
  const group = readBalancedGroup(value, openingIndex, '(', ')');
  return group && group.end === value.length ? staticTypeNameResult(group.body) : null;
}

function variableReference(value) {
  const variable = String(value || '').trim();
  return /^(?:\$\{[^}]+\}|\$(?:[A-Za-z_][\w-]*:)?[A-Za-z_][\w-]*(?:\[[^\]]+\]|\.[A-Za-z_][\w-]*)*)$/.test(variable)
    ? variable.toLowerCase()
    : null;
}

function staticOutputResult(body, depth = 0) {
  if (depth > MAX_SCAN_DEPTH) return null;
  const scalar = staticScalarResult(body);
  if (scalar !== null) return scalar.trim();
  const value = String(body || '').trim();
  const openingIndex = value.startsWith('$(') ? 1 : 0;
  if (value[openingIndex] === '(') {
    const group = readBalancedGroup(value, openingIndex, '(', ')');
    if (group && group.end === value.length) {
      return staticOutputResult(group.body, depth + 1);
    }
  }
  const statements = parseStatements(value);
  if (statements.length !== 1 || statements[0].length !== 1) return null;
  const tokens = statements[0][0];
  const command = commandBasename(tokens[0]);
  if ((command !== 'write-output' && command !== 'echo') || tokens.length < 2) return null;
  return tokens.slice(1).join(' ');
}

function isPipedToPowerShellStdin(input, end) {
  return /^\s*\|\s*(?:pwsh|powershell)(?:\.exe)?\s+-(?:command|c)\s+-\s*(?:[;\r\n]|$)/i.test(
    input.slice(end)
  );
}

/**
 * Extract executable `$()`, `@()`, grouping parentheses, and selected script
 * blocks while masking every container from the outer statement pass. `$()`
 * also executes inside double quotes. Other containers are literal there.
 */
const CONTEXT_CLAUSE_KEYWORDS = /^(?:if|elseif|else|for|foreach|while|do|switch|default|try|catch|finally|trap|function|filter|workflow|begin|process|end|dynamicparam|clean)\b/i;

function createContainerScan(input, options) {
  return {
    input,
    options,
    bodies: [],
    deferredFunctions: [],
    masked: [...input],
    quote: null,
    bracedVariable: false,
    context: '',
    contextTruncated: false,
  };
}

function resetContainerContext(scan) {
  scan.context = '';
  scan.contextTruncated = false;
}

function appendContextSpace(scan) {
  if (scan.context && !scan.context.endsWith(' ')) scan.context += ' ';
}

function appendContainerContext(scan, value) {
  for (const contextChar of value) {
    if (contextChar === ';' || contextChar === '}') {
      resetContainerContext(scan);
    } else if (contextChar === '\n' || contextChar === '\r') {
      if (CONTEXT_CLAUSE_KEYWORDS.test(currentClause(scan.context))) {
        appendContextSpace(scan);
      } else {
        resetContainerContext(scan);
      }
    } else if (/\s/.test(contextChar)) {
      appendContextSpace(scan);
    } else {
      scan.context += contextChar;
    }
    if (scan.context.length > MAX_CONTEXT_LENGTH) {
      scan.context = scan.context.slice(-Math.floor(MAX_CONTEXT_LENGTH / 2));
      scan.contextTruncated = true;
    }
  }
}

function maskRange(masked, start, end) {
  for (let offset = start; offset < end; offset += 1) masked[offset] = ' ';
}

function consumeBracedVariableChar(scan, index) {
  const { input } = scan;
  const char = input[index];
  if (char === '`' && index + 1 < input.length) {
    appendContainerContext(scan, input[index + 1]);
    return index + 1;
  }
  if (char === '}') {
    scan.context += char;
    scan.bracedVariable = false;
  } else {
    appendContainerContext(scan, char);
  }
  return index;
}

// A backtick outside quotes folds the escaped character into the clause
// context; inside quotes it only protects the next character.
function consumeContainerEscape(scan, index) {
  const { input } = scan;
  if (!scan.quote && index + 1 < input.length) {
    const escaped = input[index + 1];
    appendContainerContext(scan, escaped === '\n' || escaped === '\r' ? ' ' : escaped);
    if (escaped === '\r' && input[index + 2] === '\n') return index + 2;
  }
  return index + 1;
}

/**
 * Consume characters that cannot open a container: `${}` names, single-quoted
 * text, backtick escapes, and quote delimiters. Returns the last consumed
 * index, or -1 for a live character.
 */
function consumeContainerInertChar(scan, index) {
  const { input } = scan;
  const char = input[index];
  if (scan.bracedVariable) return consumeBracedVariableChar(scan, index);
  if (scan.quote === "'") {
    if (char === "'" && input[index + 1] === "'") return index + 1;
    if (char === "'") scan.quote = null;
    return index;
  }
  if (char === '`') return consumeContainerEscape(scan, index);
  if (!scan.quote && char === "'") {
    scan.quote = "'";
    appendContainerContext(scan, ' ');
    return index;
  }
  if (!scan.quote && char === '$' && input[index + 1] === '{') {
    appendContainerContext(scan, '${');
    scan.bracedVariable = true;
    return index + 1;
  }
  if (char === '"') {
    scan.quote = scan.quote === '"' ? null : '"';
    if (scan.quote === '"') appendContainerContext(scan, ' ');
    return index;
  }
  return -1;
}

function containerDescriptor(input, index, flags) {
  const { isSubexpression, isArrayExpression, isScriptBlock } = flags;
  return {
    ...flags,
    isHashtable: isScriptBlock && input[index - 1] === '@',
    openingIndex: isSubexpression || isArrayExpression ? index + 1 : index,
    open: isScriptBlock ? '{' : '(',
    close: isScriptBlock ? '}' : ')',
  };
}

/**
 * Classify the live character at `index`. Returns a container descriptor, or
 * null after folding a non-container character into the clause context.
 */
function readContainerOpener(scan, index) {
  const { input, quote } = scan;
  const char = input[index];
  const isSubexpression = char === '$' && input[index + 1] === '(';
  if (quote === '"' && !isSubexpression) return null;

  const isArrayExpression = !quote && char === '@' && input[index + 1] === '(';
  const isGroupingExpression = !quote && char === '(';
  const isScriptBlock = !quote && char === '{';
  if (!isSubexpression && !isArrayExpression && !isGroupingExpression && !isScriptBlock) {
    if (!quote) appendContainerContext(scan, char);
    return null;
  }
  const isCmdPayloadGroup = isGroupingExpression &&
    /(?:^|\s)cmd(?:\.exe)?\s+\/[ck](?:\s|$)/i.test(currentClause(scan.context));
  if (isCmdPayloadGroup) {
    appendContainerContext(scan, char);
    return null;
  }
  return containerDescriptor(input, index, {
    isSubexpression,
    isArrayExpression,
    isGroupingExpression,
    isScriptBlock,
  });
}

function queueCreatedScriptBlock(scan, group, clause, invokedAfter) {
  const { options } = scan;
  const createsScriptBlock = /\[\s*(?:system\.management\.automation\.)?scriptblock\s*\]\s*::\s*create\s*$/i.test(clause);
  if (!createsScriptBlock || !(invokedAfter || options.executeBareScriptBlocks)) return;
  const scalarReference = variableReference(group.body);
  const scriptText = staticStringResult(group.body) ||
    (scalarReference ? options.staticScalars?.get(scalarReference) : null);
  if (scriptText) {
    scan.bodies.push({ body: scriptText, options: { executeBareScriptBlocks: true } });
  }
}

function queueContainerBody(scan, container, group, info) {
  const { options } = scan;
  const { isScriptBlock, isHashtable } = container;
  const { prefix, invokesContainer, invokedAfter } = info;
  const clause = currentClause(prefix);
  const shouldScan = scan.contextTruncated || !isScriptBlock || isHashtable || invokedAfter ||
    isExecutableScriptBlock(prefix, options);
  if (shouldScan) {
    const executesNestedScriptBlocks = isScriptBlock && /^switch\b/i.test(clause);
    scan.bodies.push({
      body: group.body,
      options: {
        executeBareScriptBlocks: Boolean(options.executeBareScriptBlocks) ||
          invokedAfter || executesNestedScriptBlocks ||
          (!isScriptBlock && invokesContainer),
      },
    });
  } else {
    const functionName = deferredScriptBlockName(prefix);
    if (functionName) scan.deferredFunctions.push({ body: group.body, functionName });
  }
  queueCreatedScriptBlock(scan, group, clause, invokedAfter);
}

function staticContainerCommand(scan, container, group, info) {
  const clause = currentClause(info.prefix);
  if (container.isSubexpression || info.invokesContainer) {
    const output = staticOutputResult(group.body);
    if (output !== null || !container.isSubexpression) return output;
    const scalarReference = variableReference(group.body);
    return scalarReference ? scan.options.staticScalars?.get(scalarReference) ?? null : null;
  }
  if (/^(?:start-process|saps|start)\b/i.test(clause)) return staticStringArrayResult(group.body);
  if (/^new-object\b/i.test(clause)) return staticTypeNameResult(group.body);
  if (isPipedToPowerShellStdin(scan.input, group.end)) return staticScalarResult(group.body);
  return staticCommandResult(group.body);
}

function resolveContainerCommand(scan, container, group, info) {
  const resolvedCommand = container.isScriptBlock
    ? null
    : staticContainerCommand(scan, container, group, info);
  if (resolvedCommand || container.isScriptBlock) return resolvedCommand;
  const executableBlockExpression = /\{|\[\s*(?:system\.management\.automation\.)?scriptblock\s*\]\s*::\s*create/i.test(
    maskQuotedStrings(group.body)
  );
  const dynamic = invokesDynamicResult(info.prefix, {
    groupingExpression: container.isGroupingExpression,
  });
  return dynamic && !executableBlockExpression ? DYNAMIC_EXECUTION_MARKER : null;
}

function recordContainer(scan, container, group, index) {
  const withinDoubleQuote = scan.quote === '"';
  const prefix = scan.context;
  const invokesContainer = invokesContainerResult(prefix, {
    groupingExpression: container.isGroupingExpression,
  });
  const invokedAfter = isInvokedAfterContainer(scan.input, group.end);
  queueContainerBody(scan, container, group, { prefix, invokesContainer, invokedAfter });
  maskRange(scan.masked, index, group.end);

  const resolvedCommand = resolveContainerCommand(scan, container, group, { prefix, invokesContainer });
  if (resolvedCommand) {
    scan.masked[index] = resolvedCommand;
    if (!withinDoubleQuote) appendContainerContext(scan, resolvedCommand);
  } else if (container.isScriptBlock) {
    if (invokesContainer) {
      scan.context = prefix;
    } else {
      resetContainerContext(scan);
    }
  } else if (!withinDoubleQuote) {
    appendContainerContext(scan, ' ');
  }
}

function extractExecutableContainers(input, options = {}) {
  const scan = createContainerScan(input, options);

  for (let index = 0; index < input.length; index += 1) {
    const inertEnd = consumeContainerInertChar(scan, index);
    if (inertEnd !== -1) {
      index = inertEnd;
      continue;
    }

    const container = readContainerOpener(scan, index);
    if (!container) continue;

    const group = readBalancedGroup(input, container.openingIndex, container.open, container.close);
    if (!group) {
      maskRange(scan.masked, index, input.length);
      break;
    }
    recordContainer(scan, container, group, index);
    index = group.end - 1;
  }

  return { bodies: scan.bodies, deferredFunctions: scan.deferredFunctions, outer: scan.masked.join('') };
}

/**
 * Split PowerShell into statements, pipelines, and dequoted words. Backticks
 * are interpreted before token comparison so `Rem`ove-Item` normalizes to the
 * command PowerShell executes. Backslashes remain ordinary characters.
 */
function createWordState() {
  return {
    text: '',
    source: '',
    hasQuotedContent: false,
    hasUnquotedContent: false,
    quoteKind: null,
    inlineValueQuoteKind: null,
    inlineValueQuoteClosed: false,
  };
}

function createSegmentState() {
  return {
    tokens: [],
    quotedTokens: [],
    quoteKinds: [],
    tokenSources: [],
    inlineValueQuoteKinds: [],
  };
}

function createStatementParser() {
  return {
    statements: [],
    statement: [],
    segment: createSegmentState(),
    word: createWordState(),
    quote: null,
    parenDepth: 0,
    callOperatorPending: false,
  };
}

function markInlineValueMixed(word) {
  if (word.inlineValueQuoteClosed) word.inlineValueQuoteKind = 'mixed';
}

function appendUnquotedChar(word, char) {
  word.text += char;
  word.source += char;
  word.hasUnquotedContent = true;
}

function appendQuotedChar(word, char) {
  word.text += char;
  word.source += char;
  word.hasQuotedContent = true;
}

function flushWord(parser) {
  const { word, segment } = parser;
  if (word.text) {
    const quotedOnly = word.hasQuotedContent && !word.hasUnquotedContent;
    segment.tokens.push(word.text);
    segment.quotedTokens.push(quotedOnly);
    segment.quoteKinds.push(quotedOnly ? word.quoteKind : null);
    segment.tokenSources.push(word.source);
    segment.inlineValueQuoteKinds.push(
      word.inlineValueQuoteClosed && word.inlineValueQuoteKind !== 'mixed'
        ? word.inlineValueQuoteKind
        : null
    );
  }
  parser.word = createWordState();
}

function flushSegment(parser) {
  flushWord(parser);
  const { segment } = parser;
  if (segment.tokens.length) {
    Object.defineProperties(segment.tokens, {
      invokedByCallOperator: { value: parser.callOperatorPending },
      quotedTokens: { value: segment.quotedTokens },
      quoteKinds: { value: segment.quoteKinds },
      tokenSources: { value: segment.tokenSources },
      inlineValueQuoteKinds: { value: segment.inlineValueQuoteKinds },
    });
    parser.statement.push(segment.tokens);
    parser.callOperatorPending = false;
  }
  parser.segment = createSegmentState();
}

function flushStatement(parser) {
  flushSegment(parser);
  if (parser.statement.length) parser.statements.push(parser.statement);
  parser.statement = [];
}

// Each consume* helper returns the last input index it consumed.
function consumeSingleQuotedChar(parser, input, index) {
  const { word } = parser;
  const char = input[index];
  if (char === "'" && input[index + 1] === "'") {
    word.text += "'";
    word.source += "''";
    return index + 1;
  }
  if (char === "'") {
    parser.quote = null;
    if (word.inlineValueQuoteKind === "'") word.inlineValueQuoteClosed = true;
    return index;
  }
  appendQuotedChar(word, char);
  return index;
}

function consumeDoubleQuotedChar(parser, input, index) {
  const { word } = parser;
  const char = input[index];
  if (char === '"') {
    parser.quote = null;
    if (word.inlineValueQuoteKind === '"') word.inlineValueQuoteClosed = true;
    return index;
  }
  appendQuotedChar(word, char);
  return index;
}

function consumeBacktickEscape(parser, input, index) {
  const { word } = parser;
  if (index + 1 >= input.length) {
    word.text += '`';
    word.source += '`';
    return index;
  }
  const escaped = input[index + 1];
  word.source += `\`${escaped}`;
  if (escaped === '\n' || escaped === '\r') {
    if (escaped === '\r' && input[index + 2] === '\n') {
      word.source += '\n';
      return index + 2;
    }
    return index + 1;
  }
  markInlineValueMixed(word);
  word.text += escaped;
  if (parser.quote) word.hasQuotedContent = true;
  else word.hasUnquotedContent = true;
  return index + 1;
}

function openWordQuote(parser, char) {
  const { word } = parser;
  if (word.inlineValueQuoteClosed) {
    word.inlineValueQuoteKind = 'mixed';
  } else if (word.inlineValueQuoteKind === null && /^-+[^:\s]+:$/.test(word.text)) {
    word.inlineValueQuoteKind = char;
  }
  parser.quote = char;
  word.hasQuotedContent = true;
  word.quoteKind = word.quoteKind === null || word.quoteKind === char ? char : 'mixed';
}

// Parentheses, statement and pipeline separators, the call operator, and
// whitespace. Returns false when `char` is an ordinary word character.
function consumeStructuralChar(parser, char) {
  if (char === '(') {
    markInlineValueMixed(parser.word);
    parser.parenDepth += 1;
    appendUnquotedChar(parser.word, char);
    return true;
  }
  if (char === ')' && parser.parenDepth > 0) {
    markInlineValueMixed(parser.word);
    parser.parenDepth -= 1;
    appendUnquotedChar(parser.word, char);
    return true;
  }
  if (parser.parenDepth === 0 && (char === ';' || char === '\n' || char === '\r')) {
    flushStatement(parser);
    return true;
  }
  if (parser.parenDepth === 0 && char === '|') {
    flushSegment(parser);
    return true;
  }
  if (parser.parenDepth === 0 && char === '&') {
    if (parser.word.text || parser.segment.tokens.length) flushStatement(parser);
    parser.callOperatorPending = true;
    return true;
  }
  if (/\s/.test(char)) {
    flushWord(parser);
    return true;
  }
  return false;
}

function parseStatements(input) {
  const parser = createStatementParser();

  for (let index = 0; index < input.length; index += 1) {
    const char = input[index];

    if (parser.quote === "'") {
      index = consumeSingleQuotedChar(parser, input, index);
      continue;
    }
    if (char === '`') {
      index = consumeBacktickEscape(parser, input, index);
      continue;
    }
    if (parser.quote === '"') {
      index = consumeDoubleQuotedChar(parser, input, index);
      continue;
    }
    if (char === "'" || char === '"') {
      openWordQuote(parser, char);
      continue;
    }
    if (consumeStructuralChar(parser, char)) continue;

    markInlineValueMixed(parser.word);
    appendUnquotedChar(parser.word, char);
  }

  flushStatement(parser);
  return parser.statements;
}

function maskQuotedStrings(input) {
  let output = '';
  let quote = null;

  for (let index = 0; index < input.length; index += 1) {
    const char = input[index];
    if (quote === "'") {
      output += ' ';
      if (char === "'" && input[index + 1] === "'") {
        output += ' ';
        index += 1;
      } else if (char === "'") {
        quote = null;
      }
      continue;
    }
    if (char === '`') {
      if (index + 1 < input.length) {
        output += quote ? '  ' : input[index + 1];
        index += 1;
      } else {
        output += quote ? ' ' : '`';
      }
      continue;
    }
    if (quote === '"') {
      output += ' ';
      if (char === '"') quote = null;
      continue;
    }
    if (char === "'" || char === '"') {
      quote = char;
      output += ' ';
      continue;
    }
    output += char;
  }

  return output;
}

function decodeUtf16LeBase64(value) {
  const encoded = String(value || '').trim();
  if (!encoded || encoded.length % 4 !== 0 || !/^[A-Za-z0-9+/]+={0,2}$/.test(encoded)) {
    return null;
  }

  const bytes = Buffer.from(encoded, 'base64');
  if (bytes.length === 0 || bytes.length % 2 !== 0) return null;
  if (bytes.toString('base64').replace(/=+$/, '') !== encoded.replace(/=+$/, '')) return null;

  const decoded = bytes.toString('utf16le');
  if (!decoded || decoded.includes('\uFFFD') || decoded.includes('\u0000')) return null;
  return decoded;
}

function createScanState() {
  return {
    deferredFunctions: new Map(),
    invokedCommands: new Set(),
    pendingInvocations: [],
    resolvingFunctions: false,
    scannedFunctions: new Set(),
    staticScalars: new Map(),
    aliases: new Map(),
  };
}

function collectStaticScalarAssignments(input, state) {
  const variable = String.raw`(\$\{[^}]+\}|\$(?:[A-Za-z_][\w-]*:)?[A-Za-z_][\w-]*(?:\[[^\]]+\]|\.[A-Za-z_][\w-]*)*)`;
  const firstReferences = new Map();
  const referencePattern = new RegExp(variable, 'g');
  let reference;
  while ((reference = referencePattern.exec(input)) !== null) {
    const name = reference[1].toLowerCase();
    if (!firstReferences.has(name)) firstReferences.set(name, reference.index);
  }
  const assignmentCounts = new Map();
  const assignmentPattern = new RegExp(`${variable}\\s*(?:\\+=|-=|\\*=|\\/=|%=|=)`, 'g');
  let assignmentMatch;
  while ((assignmentMatch = assignmentPattern.exec(input)) !== null) {
    const name = assignmentMatch[1].toLowerCase();
    assignmentCounts.set(name, (assignmentCounts.get(name) || 0) + 1);
  }
  const pattern = new RegExp(
    String.raw`(?:^|[;\r\n])\s*${variable}\s*=\s*(?:'((?:''|[^'])*)'|"((?:\x60[\s\S]|[^\x60"])*)")\s*(?=;|\r?\n|$)`,
    'g'
  );
  let match;
  while ((match = pattern.exec(input)) !== null) {
    const name = match[1].toLowerCase();
    // The scan pre-collects immutable scalars for nested executable bodies.
    // A value assigned after an earlier reference cannot explain that use.
    // Keep it unresolved so dynamic execution remains gated. Counting even
    // quoted references is deliberately conservative, with a linear scan.
    const assignmentIndex = match.index + match[0].indexOf(match[1]);
    if (firstReferences.get(name) !== assignmentIndex) continue;
    if (match[3] !== undefined && /(^|[^`])\$/.test(match[3])) continue;
    const value = match[2] !== undefined
      ? match[2].replace(/''/g, "'")
      : decodeDoubleQuotedString(match[3]);
    state.staticScalars.set(name, value);
  }
  for (const [name, count] of assignmentCounts) {
    if (count !== 1) state.staticScalars.delete(name);
  }
}

function recordInvocation(state, commandName) {
  if (!commandName || state.invokedCommands.has(commandName)) return;
  state.invokedCommands.add(commandName);
  if (state.resolvingFunctions) state.pendingInvocations.push(commandName);
}

function registerDeferredFunction(state, definition) {
  const definitions = state.deferredFunctions.get(definition.functionName) || [];
  definitions.push(definition);
  state.deferredFunctions.set(definition.functionName, definitions);
  if (state.resolvingFunctions && state.invokedCommands.has(definition.functionName)) {
    state.pendingInvocations.push(definition.functionName);
  }
}

function addNestedScan(payload, depth, findings, analysis, options = {}, scanState = null) {
  if (depth >= MAX_SCAN_DEPTH) {
    findings.add(RULE_IDS.SCAN_DEPTH_EXCEEDED);
    return;
  }
  scanPowerShell(payload, depth + 1, findings, analysis, options, scanState);
}

function staticTokenValue(tokens, index, state, findings, inline = false) {
  const value = inline ? parameterValue(tokens[index]) : tokens[index];
  const quoteKind = inline ? tokens.inlineValueQuoteKinds?.[index] : tokens.quoteKinds?.[index];
  if (quoteKind === "'") return value;
  const source = inline
    ? parameterValue(tokens.tokenSources?.[index] || tokens[index])
    : tokens.tokenSources?.[index] ?? value;
  return expandStaticDoubleQuotedString(source, state, findings);
}

function staticPipelineInput(tokens, state, findings) {
  if (!tokens || tokens.length === 0) return null;
  if (tokens.length === 1) return staticTokenValue(tokens, 0, state, findings);
  const command = commandBasename(tokens[0]);
  if ((command === 'write-output' || command === 'echo') && tokens.length === 2) {
    return staticTokenValue(tokens, 1, state, findings);
  }
  return null;
}

function scanEncodedCommandFlag(tokens, index, scan) {
  const { findings, scanState } = scan;
  const token = tokens[index];
  const inlinePayload = parameterValue(token);
  let encodedPayload = inlinePayload || tokens[index + 1];
  const payloadIndex = index + 1;
  const quoteKind = tokens.quoteKinds?.[payloadIndex];
  const inlineQuoteKind = tokens.inlineValueQuoteKinds?.[index];
  if ((inlinePayload && inlineQuoteKind !== "'") ||
      (!inlinePayload && encodedPayload && quoteKind !== "'")) {
    const source = inlinePayload
      ? parameterValue(tokens.tokenSources?.[index] || token)
      : tokens.tokenSources?.[payloadIndex] ?? encodedPayload;
    const expanded = expandStaticDoubleQuotedString(
      source || encodedPayload,
      scanState,
      findings
    );
    if (expanded === null) return;
    encodedPayload = expanded;
  }
  const decoded = decodeUtf16LeBase64(encodedPayload);
  if (decoded !== null) addNestedScan(decoded, scan.depth, findings, scan.analysis, {}, scanState);
}

// Inline `-Command:value` payloads. Returns null when expansion is unresolved.
function resolveInlineCommandPayload(tokens, index, scan) {
  const token = tokens[index];
  const inlinePayload = parameterValue(token);
  const rest = tokens.slice(index + 1);
  if (tokens.inlineValueQuoteKinds?.[index] === "'") return [inlinePayload, ...rest].join(' ');
  const inlineSource = parameterValue(tokens.tokenSources?.[index] || token);
  const expanded = expandStaticDoubleQuotedString(
    inlineSource || inlinePayload,
    scan.scanState,
    scan.findings
  );
  return expanded === null ? null : [expanded, ...rest].join(' ');
}

// `-Command value` payloads. Returns null when expansion is unresolved.
function resolvePositionalCommandPayload(tokens, payloadIndex, payload, scan) {
  const { findings, scanState } = scan;
  const quoteKind = tokens.quoteKinds?.[payloadIndex];
  if (tokens[payloadIndex] && quoteKind !== "'") {
    const expanded = expandStaticDoubleQuotedString(
      tokens.tokenSources?.[payloadIndex] ?? tokens[payloadIndex],
      scanState,
      findings
    );
    return expanded === null ? null : [expanded, ...tokens.slice(payloadIndex + 1)].join(' ');
  }
  const payloadReference = quoteKind === "'" ? null : variableReference(payload);
  if (!payloadReference) return payload;
  const staticValue = scanState?.staticScalars.get(payloadReference);
  if (staticValue === undefined) {
    findings.add(RULE_IDS.DYNAMIC_EXECUTION);
    return null;
  }
  return staticValue;
}

function scanCommandFlag(tokens, index, scan, upstreamTokens) {
  const { findings, scanState } = scan;
  const inlinePayload = parameterValue(tokens[index]);
  const rawPayload = inlinePayload
    ? [inlinePayload, ...tokens.slice(index + 1)].join(' ')
    : tokens.slice(index + 1).join(' ');
  const pipelinePayload = rawPayload === '-' ? staticPipelineInput(upstreamTokens, scanState, findings) : null;
  const payload = inlinePayload
    ? resolveInlineCommandPayload(tokens, index, scan)
    : resolvePositionalCommandPayload(tokens, index + 1, rawPayload, scan);
  if (payload === null) return;
  if (pipelinePayload || (payload && payload !== '-')) {
    addNestedScan(
      pipelinePayload || payload,
      scan.depth,
      findings,
      scan.analysis,
      { executeBareScriptBlocks: true },
      scanState
    );
  }
}

function scanNestedPowerShell(tokens, depth, findings, analysis, scanState, upstreamTokens = null) {
  const scan = { depth, findings, analysis, scanState };
  for (let index = 1; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (isEncodedCommandFlag(token)) {
      scanEncodedCommandFlag(tokens, index, scan);
      return;
    }
    if (isCommandFlag(token)) {
      scanCommandFlag(tokens, index, scan, upstreamTokens);
      return;
    }
  }
}

function splitCmdSegments(payload) {
  const segments = [];
  let segment = '';
  let quote = false;

  for (let index = 0; index < payload.length; index += 1) {
    const char = payload[index];
    if (char === '^' && index + 1 < payload.length) {
      segment += payload[index + 1];
      index += 1;
      continue;
    }
    if (char === '"') {
      quote = !quote;
      continue;
    }
    if (!quote && (char === '&' || char === '|')) {
      if (segment.trim()) segments.push(segment.trim());
      segment = '';
      continue;
    }
    segment += char;
  }
  if (segment.trim()) segments.push(segment.trim());
  return segments;
}

function stripCmdRedirections(words) {
  while (words.length > 0 && /^\d*(?:>>?|<<?)/.test(words[0])) {
    const redirection = words.shift();
    if (/^\d*(?:>>?|<<?)$/.test(redirection)) words.shift();
  }
}

// Index of the command that follows a cmd `if` condition.
function cmdIfCommandIndex(trueBranch) {
  let commandIndex = 1;
  if (/^\/i$/i.test(trueBranch[commandIndex])) commandIndex += 1;
  if (/^not$/i.test(trueBranch[commandIndex])) commandIndex += 1;
  if (/^(?:exist|defined|errorlevel|cmdextversion)$/i.test(trueBranch[commandIndex])) {
    return commandIndex + 2;
  }
  if (/^(?:equ|neq|lss|leq|gtr|geq)$/i.test(trueBranch[commandIndex + 1])) {
    return commandIndex + 3;
  }
  return commandIndex + 1;
}

function scanCmdIf(words, scan, wrapperDepth) {
  const elseIndex = words.findIndex((word, index) => index > 0 && /^else$/i.test(word));
  const trueBranch = elseIndex === -1 ? words : words.slice(0, elseIndex);
  scanCmdWords(trueBranch.slice(cmdIfCommandIndex(trueBranch)), scan, wrapperDepth + 1);
  if (elseIndex !== -1) {
    scanCmdWords(words.slice(elseIndex + 1), scan, wrapperDepth + 1);
  }
}

// Words after `start [options] [title] ...`, skipping options that take a
// value and a leading window title when a known command follows it.
function cmdStartTarget(inputWords) {
  let words = inputWords.slice(1);
  while (words.length > 0 && /^\//.test(words[0])) {
    const option = words.shift().toLowerCase();
    if (/^\/(?:d|node|affinity)$/.test(option)) words.shift();
  }
  const knownCommands = new Set([
    ...CMD_DELETE_COMMANDS,
    ...POWERSHELL_COMMANDS,
    'call',
    'cmd',
    'for',
    'if',
    'start',
  ]);
  if (words.length > 1 && !knownCommands.has(commandBasename(words[0]))) {
    const commandIndex = words.findIndex(word => knownCommands.has(commandBasename(word)));
    if (commandIndex > 0) words = words.slice(commandIndex);
  }
  return words;
}

function scanCmdWords(inputWords, scan, wrapperDepth = 0) {
  if (wrapperDepth > 64) {
    scan.findings.add(RULE_IDS.SCAN_DEPTH_EXCEEDED);
    return;
  }

  const words = inputWords.filter(Boolean).map(word => String(word));
  if (words.length === 0) return;
  words[0] = words[0].replace(/^@+/, '').replace(/^\(+/, '');
  words[words.length - 1] = words[words.length - 1].replace(/\)+$/, '');
  stripCmdRedirections(words);
  if (words.length === 0) return;

  const firstCommand = commandBasename(words[0].replace(/^@+/, '').replace(/^\(+/, ''));
  if (firstCommand === 'if') {
    scanCmdIf(words, scan, wrapperDepth);
    return;
  }
  if (firstCommand === 'for') {
    const doIndex = words.findIndex(word => /^do$/i.test(word));
    if (doIndex !== -1) scanCmdWords(words.slice(doIndex + 1), scan, wrapperDepth + 1);
    return;
  }
  if (firstCommand === 'call') {
    scanCmdWords(words.slice(1), scan, wrapperDepth + 1);
    return;
  }
  if (firstCommand === 'start') {
    scanCmdWords(cmdStartTarget(words), scan, wrapperDepth + 1);
    return;
  }

  if (POWERSHELL_COMMANDS.has(firstCommand) || firstCommand === 'cmd') {
    addNestedScan(
      [firstCommand, ...words.slice(1)].join(' '),
      scan.depth,
      scan.findings,
      scan.analysis,
      { executeBareScriptBlocks: true },
      scan.scanState
    );
    return;
  }
  if (CMD_DELETE_COMMANDS.has(firstCommand) && words.slice(1).some(word => /^[-/]s$/i.test(word))) {
    scan.findings.add(RULE_IDS.CMD_RECURSIVE_DELETE);
  }
}

function scanCmd(tokens, depth, findings, analysis, scanState) {
  const flagIndex = tokens.findIndex((token, index) => index > 0 && /^\/[ck]$/i.test(token));
  if (flagIndex === -1) return;

  const payload = tokens
    .slice(flagIndex + 1)
    .filter(token => token !== '--%')
    .join(' ');
  const scan = { depth, findings, analysis, scanState };
  for (const segment of splitCmdSegments(payload)) {
    scanCmdWords(segment.trim().split(/\s+/), scan);
  }
}

function scanDeleteSegment(tokens, findings, quotedTokens = []) {
  if (tokens.length === 0) return false;

  const command = commandBasename(tokens[0]);
  if (!DELETE_COMMANDS.has(command)) return false;

  const usesLiteralPath = tokens.slice(1).some(
    (token, index) => !quotedTokens[index + 1] && isParameterPrefix(token, 'literalpath')
  );
  for (let index = 1; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (!quotedTokens[index] && token.startsWith('@')) {
      findings.add(RULE_IDS.REMOVE_SPLAT);
      continue;
    }
    if (!quotedTokens[index] && isEnabledSwitch(token, 'recurse')) {
      findings.add(RULE_IDS.REMOVE_RECURSE);
      continue;
    }
    if (!quotedTokens[index] && isEnabledSwitch(token, 'force')) {
      findings.add(RULE_IDS.REMOVE_FORCE);
      continue;
    }
    if (!usesLiteralPath && !token.startsWith('-') && /[*?]/.test(token)) {
      findings.add(RULE_IDS.REMOVE_WILDCARD);
    }
  }

  return true;
}

function parameterValue(token) {
  const separator = String(token || '').indexOf(':');
  return separator === -1 ? '' : String(token).slice(separator + 1);
}

function startProcessParameterName(token) {
  const raw = String(token || '');
  if (!raw.startsWith('-')) return null;
  const name = raw.replace(/^-+/, '').split(':')[0].toLowerCase();
  if (name === 'args') return 'argumentlist';
  const candidates = [...START_PROCESS_VALUE_PARAMETERS, ...START_PROCESS_SWITCH_PARAMETERS]
    .filter(parameter => parameter.startsWith(name));
  return candidates.length === 1 ? candidates[0] : null;
}

function normalizeArgumentList(parts) {
  let payload = parts.join(' ').trim();
  if (/^@?\(/.test(payload) && /\)$/.test(payload)) {
    payload = payload.replace(/^@?\(\s*/, '').replace(/\s*\)$/, '');
  }
  return payload.replace(/\s*,\s*/g, ' ').trim();
}

function hasSplattedStartProcessArguments(tokens, quotedTokens) {
  return tokens.slice(1).some((token, index) =>
    !quotedTokens[index + 1] &&
      /^@(?:(?:global|script|local|private):)?[A-Za-z_][\w-]*$/i.test(token)
  );
}

function startProcessFilePath(tokens, quotedTokens) {
  for (let index = 1; index < tokens.length; index += 1) {
    if (quotedTokens[index]) continue;
    if (startProcessParameterName(tokens[index]) !== 'filepath') continue;
    return parameterValue(tokens[index]) || tokens[index + 1] || null;
  }
  return null;
}

function startProcessArgumentListParts(tokens, quotedTokens, index) {
  const inlineValue = parameterValue(tokens[index]);
  const end = tokens.findIndex(
    (candidate, candidateIndex) => candidateIndex > index &&
      !quotedTokens[candidateIndex] && startProcessParameterName(candidate)
  );
  const remaining = tokens.slice(index + 1, end === -1 ? tokens.length : end);
  return inlineValue ? [inlineValue, ...remaining] : remaining;
}

// Walk named parameters once: pick up `-ArgumentList` and, when `-FilePath`
// was absent, the first positional value as the executable.
function startProcessNamedTarget(tokens, quotedTokens, filePath) {
  let executable = filePath;
  let argumentParts = null;
  for (let index = 1; index < tokens.length; index += 1) {
    const token = tokens[index];
    const quoted = quotedTokens[index] === true;
    const parameter = quoted ? null : startProcessParameterName(token);
    if (parameter === 'argumentlist') {
      argumentParts = startProcessArgumentListParts(tokens, quotedTokens, index);
      break;
    }
    if (parameter) {
      if (START_PROCESS_VALUE_PARAMETERS.has(parameter) && !parameterValue(token)) index += 1;
      continue;
    }
    if (!quoted && token.startsWith('-')) continue;
    if (executable === null) executable = token;
  }
  return { executable, argumentParts };
}

// Positional arguments are everything after the executable once named
// parameters and their values are skipped.
function startProcessPositionalArguments(tokens, quotedTokens, executable) {
  let executableSeen = false;
  for (let index = 1; index < tokens.length; index += 1) {
    const token = tokens[index];
    const parameter = quotedTokens[index] ? null : startProcessParameterName(token);
    if (parameter) {
      if (parameter === 'filepath') executableSeen = true;
      if (START_PROCESS_VALUE_PARAMETERS.has(parameter) && !parameterValue(token)) index += 1;
      continue;
    }
    if (!executableSeen && token === executable) {
      executableSeen = true;
      continue;
    }
    if (executableSeen) return tokens.slice(index);
  }
  return null;
}

function startProcessTarget(tokens, quotedTokens) {
  const filePath = startProcessFilePath(tokens, quotedTokens);
  const target = startProcessNamedTarget(tokens, quotedTokens, filePath);
  if (target.argumentParts === null && target.executable !== null) {
    target.argumentParts = startProcessPositionalArguments(tokens, quotedTokens, target.executable);
  }
  return target;
}

function scanStartProcess(tokens, depth, findings, analysis, scanState) {
  const command = commandBasename(tokens[0]);
  if (!['start-process', 'saps', 'start'].includes(command)) return;
  const quotedTokens = tokens.quotedTokens || [];
  if (hasSplattedStartProcessArguments(tokens, quotedTokens)) {
    findings.add(RULE_IDS.DYNAMIC_EXECUTION);
    return;
  }

  const { executable, argumentParts } = startProcessTarget(tokens, quotedTokens);
  const nestedCommand = commandBasename(executable);
  if (!POWERSHELL_COMMANDS.has(nestedCommand) && nestedCommand !== 'cmd') return;

  let argumentList = argumentParts ? normalizeArgumentList(argumentParts) : '';
  const argumentReference = variableReference(argumentList);
  if (argumentReference) {
    const staticValue = scanState.staticScalars.get(argumentReference);
    if (staticValue === undefined) {
      findings.add(RULE_IDS.DYNAMIC_EXECUTION);
      return;
    }
    argumentList = staticValue;
  }
  if (argumentList) {
    addNestedScan(
      `${executable} ${argumentList}`,
      depth,
      findings,
      analysis,
      { executeBareScriptBlocks: true },
      scanState
    );
  }
}

function isAssignmentTarget(value) {
  const variable = String(value || '');
  const oneTarget = String.raw`(?:\$\{[^}]+\}|\$(?:[A-Za-z_][\w-]*:)?[A-Za-z_][\w-]*(?:\[[^\]]+\]|\.[A-Za-z_][\w-]*)*)`;
  return new RegExp(`^(?:\\[[^\\]]+\\])?${oneTarget}(?:,${oneTarget})*$`).test(variable);
}

function executableSegment(tokens) {
  if (!tokens || tokens.length === 0) {
    return { firstTokenQuoted: false, quotedTokens: [], tokens: [] };
  }
  const first = String(tokens[0] || '');
  const inlineAssignment = first.match(/^(.+?)(\+=|-=|\*=|\/=|%=|=)(.+)$/);
  if (inlineAssignment && isAssignmentTarget(inlineAssignment[1])) {
    return {
      firstTokenQuoted: false,
      quotedTokens: [false, ...(tokens.quotedTokens || []).slice(1)],
      tokens: [inlineAssignment[3], ...tokens.slice(1)],
    };
  }
  if (tokens.length >= 2 && isAssignmentTarget(first) && /^(?:=|\+=|-=|\*=|\/=|%=)$/.test(tokens[1])) {
    return {
      firstTokenQuoted: tokens.quotedTokens?.[2] === true,
      quotedTokens: (tokens.quotedTokens || []).slice(2),
      tokens: tokens.slice(2),
    };
  }
  if (/^(?:return)$/i.test(first) && tokens.length > 1) {
    return {
      firstTokenQuoted: tokens.quotedTokens?.[1] === true,
      quotedTokens: (tokens.quotedTokens || []).slice(1),
      tokens: tokens.slice(1),
    };
  }
  return {
    firstTokenQuoted: tokens.quotedTokens?.[0] === true,
    quotedTokens: tokens.quotedTokens || [],
    tokens,
  };
}

function newObjectClassName(tokens, quotedTokens = []) {
  for (let index = 1; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (!quotedTokens[index] && isParameterPrefix(token, 'typename')) {
      return parameterValue(token) || tokens[index + 1] || null;
    }
    if (!String(token).startsWith('-')) return token;
  }
  return null;
}

function markPowerShellElevation(tokens, analysis) {
  if (!analysis || analysis.elevated || tokens.length === 0) return;
  const commandName = commandBasename(tokens[0]);
  if (['set-acl', 'icacls', 'takeown', 'runas', 'sudo', 'chmod', 'chown'].includes(commandName)) {
    analysis.elevated = true;
    return;
  }
  if (!['start-process', 'saps', 'start'].includes(commandName)) return;

  for (let index = 1; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (!isParameterPrefix(token, 'verb')) continue;
    const inlineValue = String(token).split(':').slice(1).join(':');
    const value = inlineValue || tokens[index + 1] || '';
    if (/^runas$/i.test(value)) analysis.elevated = true;
    return;
  }
}

function scanScriptBlockConsumer(tokens, quotedTokens, findings, state) {
  const command = commandBasename(tokens[0]);
  const consumers = new Set([
    'foreach',
    'foreach-object',
    'icm',
    'invoke-command',
    'measure-command',
    'register-engineevent',
    'register-objectevent',
    'register-wmievent',
    'start-job',
    'sajb',
    'trace-command',
    'where',
    'where-object',
    '%',
    '?',
  ]);
  if (!consumers.has(command)) return;

  for (const token of tokens.slice(1)) {
    const reference = variableReference(token);
    if (reference && state.deferredFunctions.has(reference)) recordInvocation(state, reference);
  }

  if (tokens.length === 2) {
    const positionalReference = variableReference(tokens[1]);
    if (positionalReference) {
      recordInvocation(state, positionalReference);
      if (!state.deferredFunctions.has(positionalReference)) {
        findings.add(RULE_IDS.DYNAMIC_EXECUTION);
      }
      return;
    }
  }

  const parameters = [
    'action',
    'begin',
    'end',
    'expression',
    'filter',
    'initializationscript',
    'parallel',
    'process',
    'scriptblock',
  ];
  for (let index = 1; index < tokens.length; index += 1) {
    if (quotedTokens[index]) continue;
    const parameter = parameters.find(name => isParameterPrefix(tokens[index], name));
    if (!parameter) continue;
    const reference = variableReference(parameterValue(tokens[index]) || tokens[index + 1]);
    if (!reference) continue;
    recordInvocation(state, reference);
    if (!state.deferredFunctions.has(reference)) findings.add(RULE_IDS.DYNAMIC_EXECUTION);
  }
}

function aliasParameterName(token) {
  const name = String(token).replace(/^-+/, '').split(':')[0].toLowerCase();
  if (Object.hasOwn(ALIAS_PARAMETER_ABBREVIATIONS, name)) return ALIAS_PARAMETER_ABBREVIATIONS[name];
  const parameters = [...ALIAS_VALUE_PARAMETERS, ...ALIAS_SWITCH_PARAMETERS];
  if (parameters.includes(name)) return name;
  const matches = parameters.filter(parameter => name && parameter.startsWith(name));
  return matches.length === 1 ? matches[0] : null;
}

function aliasArguments(tokens, quotedTokens) {
  const named = new Map();
  const positional = [];
  let ambiguous = false;
  for (let index = 1; index < tokens.length; index += 1) {
    const token = String(tokens[index]);
    if (quotedTokens[index] || !token.startsWith('-')) {
      positional.push({ index, inline: false });
      if (!quotedTokens[index] && token.startsWith('@')) ambiguous = true;
      continue;
    }
    const parameter = aliasParameterName(token);
    if (!parameter) {
      ambiguous = true;
      continue;
    }
    if (named.has(parameter)) ambiguous = true;
    const inline = token.includes(':');
    const argument = { index: ALIAS_VALUE_PARAMETERS.has(parameter) && !inline ? ++index : index, inline };
    if (ALIAS_VALUE_PARAMETERS.has(parameter) && tokens[argument.index] === undefined) ambiguous = true;
    named.set(parameter, argument);
    // Option accepts a comma-separated array; its continuation belongs to the
    // named parameter rather than the remaining positional name/value slots.
    if (parameter === 'option') {
      while (index + 1 < tokens.length && !quotedTokens[index] &&
          (String(tokens[index]).endsWith(',') || String(tokens[index + 1]).startsWith(','))) index += 1;
    }
  }
  return { named, positional, ambiguous };
}

function staticAliasDefinitions(tokens, quotedTokens, state) {
  const args = aliasArguments(tokens, quotedTokens);
  // Definitions stay inert. Uncertain binding is gated only when a candidate
  // alias is invoked, without allowing auxiliary values to hide its target.
  const unresolved = new Set();
  const resolve = argument => argument
    ? staticTokenValue(tokens, argument.index, state, unresolved, argument.inline)
    : null;
  let positionalIndex = 0;
  const nameArgument = args.named.get('name') || args.positional[positionalIndex++];
  const valueArgument = args.named.get('value') || args.positional[positionalIndex++];
  const name = resolve(nameArgument);
  const value = resolve(valueArgument);
  const ambiguous = args.ambiguous || positionalIndex < args.positional.length;
  const possibleNames = args.named.has('value') ? args.positional : args.positional.slice(0, -1);
  const names = ambiguous && !args.named.has('name')
    ? [name, ...possibleNames.map(resolve)]
    : [name];
  const target = ambiguous || value === null || /^@/.test(value)
    ? DYNAMIC_EXECUTION_MARKER
    : value;
  if (!/^[A-Za-z_][\w./\\-]*$/.test(target || '')) return [];
  return [...new Set(names.filter(candidate => /^[A-Za-z_][\w-]*$/.test(candidate || '')))]
    .map(candidate => ({ name: candidate.toLowerCase(), value: target }));
}

function scanInvokeScriptCalls(source, unquoted, depth, findings, analysis, state) {
  const pattern = /(?:\$\{executioncontext\}|\$executioncontext)\.invokecommand\.invokescript\s*\(/gi;
  while (pattern.exec(unquoted) !== null) {
    const argumentSource = source.slice(pattern.lastIndex);
    const payload = leadingStaticStringResult(argumentSource);
    if (payload === null) {
      findings.add(RULE_IDS.DYNAMIC_EXECUTION);
    } else {
      addNestedScan(
        payload,
        depth,
        findings,
        analysis,
        { executeBareScriptBlocks: true },
        state
      );
    }
  }
}

const DIRECT_COMMAND_FINDINGS = Object.freeze({
  'clear-content': RULE_IDS.CLEAR_CONTENT,
  clc: RULE_IDS.CLEAR_CONTENT,
  'clear-disk': RULE_IDS.CLEAR_DISK,
  'format-volume': RULE_IDS.FORMAT_VOLUME,
});

function scanStaticDotNetCalls(unquoted, findings, state) {
  if (/\[\s*(?:system\.)?io\.directory\s*\]\s*::\s*delete\s*\(/i.test(unquoted)) {
    findings.add(RULE_IDS.DOTNET_DIRECTORY_DELETE);
  }
  if (/\[\s*(?:system\.)?io\.file\s*\]\s*::\s*delete\s*\(/i.test(unquoted)) {
    findings.add(RULE_IDS.DOTNET_FILE_DELETE);
  }
  const activatorPattern = /\[\s*(?:system\.)?activator\s*\]\s*::\s*createinstance\s*\(\s*\[([A-Za-z_][\w-]*)\]/gi;
  let activatorMatch;
  while ((activatorMatch = activatorPattern.exec(unquoted)) !== null) {
    recordInvocation(state, `__class__:${activatorMatch[1].toLowerCase()}`);
  }
}

function recordInvokedBlockVariables(unquoted, state) {
  const invokedBlockVariable = /(\$\{[^}]+\}|\$(?:[A-Za-z_][\w-]*:)?[A-Za-z_][\w-]*(?:\[[^\]]+\]|\.(?!getnewclosure\b)[A-Za-z_][\w-]*)*)(?:\.getnewclosure\s*\(\s*\))+\.\s*(?:invoke|invokereturnasis|invokewithcontext)\s*\(/gi;
  let invokedBlockMatch;
  while ((invokedBlockMatch = invokedBlockVariable.exec(unquoted)) !== null) {
    recordInvocation(state, invokedBlockMatch[1].toLowerCase());
  }
}

function scanAliasInvocation(commandName, tokens, executable, scan) {
  const { state } = scan;
  const aliasTarget = state.aliases.get(commandName);
  if (aliasTarget) {
    addNestedScan(
      [aliasTarget, ...tokens.slice(1)].join(' '),
      scan.depth,
      scan.findings,
      scan.analysis,
      { executeBareScriptBlocks: true },
      state
    );
  }
  if (['set-alias', 'new-alias', 'sal', 'nal'].includes(commandName)) {
    for (const definition of staticAliasDefinitions(tokens, executable.quotedTokens, state)) {
      state.aliases.set(definition.name, definition.value);
    }
  }
}

function recordNewObjectClass(tokens, quotedTokens, scan) {
  const { findings, state } = scan;
  let className = newObjectClassName(tokens, quotedTokens);
  const classReference = variableReference(className);
  if (classReference) {
    const staticClassName = state.staticScalars.get(classReference);
    if (staticClassName === undefined) {
      findings.add(RULE_IDS.DYNAMIC_EXECUTION);
      className = null;
    } else {
      className = staticClassName;
    }
  }
  if (className && /^[A-Za-z_][\w-]*$/.test(className)) {
    recordInvocation(state, `__class__:${className.toLowerCase()}`);
  }
}

function recordClassInvocations(commandName, tokens, executable, scan) {
  const { state } = scan;
  const classInvocation = commandName.match(/^\[([a-z_][\w-]*)\]::/i);
  if (classInvocation) recordInvocation(state, `__class__:${classInvocation[1].toLowerCase()}`);
  if (commandName === 'new-object') recordNewObjectClass(tokens, executable.quotedTokens, scan);
  const invokedVariable = commandName.match(
    /^((?:\$\{[^}]+\}|\$(?:[a-z_][\w-]*:)?[a-z_][\w-]*(?:\[[^\]]+\]|\.[a-z_][\w-]*)*))(?:\.getnewclosure\(\))*\.(?:invoke|invokereturnasis|invokewithcontext)(?:\(|$)/i
  );
  if (invokedVariable) recordInvocation(state, invokedVariable[1].toLowerCase());
  if (commandName === '.' && tokens[1]) {
    recordInvocation(state, commandBasename(tokens[1]));
  }
}

// `& $variable ...` where the variable holds a static command string.
function scanCallOperatorReference(tokens, upstreamTokens, scan) {
  const { findings, state } = scan;
  const invokedReference = variableReference(tokens[0]);
  if (!invokedReference || state.deferredFunctions.has(invokedReference)) return;
  const commandValue = state.staticScalars.get(invokedReference);
  if (commandValue === undefined) {
    findings.add(RULE_IDS.DYNAMIC_EXECUTION);
  } else if (POWERSHELL_COMMANDS.has(commandBasename(commandValue))) {
    scanNestedPowerShell(
      [commandValue, ...tokens.slice(1)],
      scan.depth,
      findings,
      scan.analysis,
      state,
      upstreamTokens
    );
  } else {
    addNestedScan(
      [commandValue, ...tokens.slice(1)].join(' '),
      scan.depth,
      findings,
      scan.analysis,
      { executeBareScriptBlocks: true },
      state
    );
  }
}

function scanInvokeExpression(tokens, scan) {
  const { findings, state } = scan;
  let payload = tokens.slice(1).join(' ');
  const payloadReference = variableReference(payload);
  if (payloadReference) {
    const staticValue = state.staticScalars.get(payloadReference);
    if (staticValue === undefined) {
      findings.add(RULE_IDS.DYNAMIC_EXECUTION);
      return;
    }
    payload = staticValue;
  }
  if (payload) {
    addNestedScan(
      payload,
      scan.depth,
      findings,
      scan.analysis,
      { executeBareScriptBlocks: true },
      state
    );
  }
}

function scanCommandFamily(commandName, tokens, upstreamTokens, scan) {
  const { findings, state } = scan;
  if (POWERSHELL_COMMANDS.has(commandName)) {
    scanNestedPowerShell(tokens, scan.depth, findings, scan.analysis, state, upstreamTokens);
  } else if (commandName === 'cmd') {
    scanCmd(tokens, scan.depth, findings, scan.analysis, state);
  } else if (commandName === 'invoke-expression' || commandName === 'iex') {
    scanInvokeExpression(tokens, scan);
  } else if (Object.hasOwn(DIRECT_COMMAND_FINDINGS, commandName)) {
    findings.add(DIRECT_COMMAND_FINDINGS[commandName]);
  }
}

/**
 * Scan one pipeline segment. Returns null for inert segments, otherwise
 * whether the segment deletes and whether it carries `-Recurse`.
 */
function scanStatementSegment(statement, index, scan) {
  const { findings, state } = scan;
  const segmentTokens = statement[index];
  const executable = executableSegment(segmentTokens);
  const tokens = executable.tokens;
  if (tokens.length === 0) return null;
  if (executable.firstTokenQuoted && !segmentTokens.invokedByCallOperator) return null;

  const commandName = commandBasename(tokens[0]);
  recordInvocation(state, commandName);
  scanAliasInvocation(commandName, tokens, executable, scan);
  recordClassInvocations(commandName, tokens, executable, scan);
  markPowerShellElevation(tokens, scan.analysis);
  scanStartProcess(tokens, scan.depth, findings, scan.analysis, state);
  scanScriptBlockConsumer(tokens, executable.quotedTokens, findings, state);
  if (tokens.some(token => commandBasename(token) === DYNAMIC_EXECUTION_MARKER)) {
    findings.add(RULE_IDS.DYNAMIC_EXECUTION);
  }
  if (segmentTokens.invokedByCallOperator) {
    scanCallOperatorReference(tokens, statement[index - 1], scan);
  }
  scanCommandFamily(commandName, tokens, statement[index - 1], scan);

  return {
    deletes: scanDeleteSegment(tokens, findings, executable.quotedTokens),
    recurses: tokens.some(
      (token, tokenIndex) => !executable.quotedTokens[tokenIndex] &&
        isEnabledSwitch(token, 'recurse')
    ),
  };
}

function scanStatement(statement, scan) {
  const deleteSegments = new Set();
  const recurseSegments = new Set();

  for (let index = 0; index < statement.length; index += 1) {
    const result = scanStatementSegment(statement, index, scan);
    if (!result) continue;
    if (result.deletes) deleteSegments.add(index);
    if (result.recurses) recurseSegments.add(index);
  }

  const hasUpstreamRecurse = [...recurseSegments].some(index => !deleteSegments.has(index));
  if (statement.length > 1 && deleteSegments.size > 0 && hasUpstreamRecurse) {
    scan.findings.add(RULE_IDS.PIPELINE_RECURSE);
  }
}

function scanPowerShell(command, depth, findings, analysis = null, options = {}, scanState = null) {
  const raw = normalizeSmartQuotes(command);
  if (!raw.trim()) return;

  const state = scanState || createScanState();
  const scan = { depth, findings, analysis, state };

  const hereStringExpressions = [];
  const normalizedHereStrings = normalizeHereStrings(raw, hereStringExpressions);
  const withoutComments = stripPowerShellComments(normalizedHereStrings);
  collectStaticScalarAssignments(withoutComments, state);
  const unquoted = maskQuotedStrings(withoutComments);
  scanInvokeScriptCalls(withoutComments, unquoted, depth, findings, analysis, state);
  scanStaticDotNetCalls(unquoted, findings, state);
  for (const payload of hereStringExpressions) {
    addNestedScan(payload, depth, findings, analysis, { executeBareScriptBlocks: true }, state);
  }

  const { bodies, deferredFunctions, outer } = extractExecutableContainers(withoutComments, {
    ...options,
    staticScalars: state.staticScalars,
  });
  for (const definition of deferredFunctions) {
    registerDeferredFunction(state, { ...definition, depth });
  }
  recordInvokedBlockVariables(unquoted, state);
  for (const entry of bodies) {
    addNestedScan(entry.body, depth, findings, analysis, entry.options, state);
  }

  for (const statement of parseStatements(outer)) {
    scanStatement(statement, scan);
  }
}

function resolveDeferredFunctions(findings, analysis, state) {
  state.pendingInvocations.push(...state.invokedCommands);
  state.resolvingFunctions = true;
  for (let cursor = 0; cursor < state.pendingInvocations.length; cursor += 1) {
    const commandName = state.pendingInvocations[cursor];
    const definitions = state.deferredFunctions.get(commandName) || [];
    for (const definition of definitions) {
      if (state.scannedFunctions.has(definition)) continue;
      state.scannedFunctions.add(definition);
      const options = definition.functionName.startsWith('__class__:')
        ? { executeBareScriptBlocks: true }
        : {};
      addNestedScan(definition.body, definition.depth, findings, analysis, options, state);
    }
  }
  state.resolvingFunctions = false;
}

function classifyPowerShellDestructiveCommand(command) {
  if (typeof command !== 'string' || !command.trim()) return [];

  const findings = new Set();
  const state = createScanState();
  scanPowerShell(command, 0, findings, null, {}, state);
  resolveDeferredFunctions(findings, null, state);
  return [...findings];
}

function isElevatedPowerShellCommand(command) {
  if (typeof command !== 'string' || !command.trim()) return false;

  const analysis = { elevated: false };
  const state = createScanState();
  const findings = new Set();
  scanPowerShell(command, 0, findings, analysis, {}, state);
  resolveDeferredFunctions(findings, analysis, state);
  return analysis.elevated;
}

module.exports = {
  RULE_IDS,
  classifyPowerShellDestructiveCommand,
  isElevatedPowerShellCommand,
};
