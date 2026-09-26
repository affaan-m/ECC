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

function normalizeHereStrings(input, executablePayloads = []) {
  const output = [...input];
  const replacements = [];
  let ordinaryQuote = null;
  let lineComment = false;
  let blockComment = false;
  let bracedVariable = false;

  for (let index = 0; index < input.length - 1; index += 1) {
    const char = input[index];
    const next = input[index + 1];
    if (lineComment) {
      if (char === '\n' || char === '\r') lineComment = false;
      continue;
    }
    if (blockComment) {
      if (char === '#' && next === '>') {
        blockComment = false;
        index += 1;
      }
      continue;
    }
    if (bracedVariable) {
      if (char === '`') index += 1;
      else if (char === '}') bracedVariable = false;
      continue;
    }
    if (ordinaryQuote === "'") {
      if (char === "'" && input[index + 1] === "'") index += 1;
      else if (char === "'") ordinaryQuote = null;
      continue;
    }
    if (char === '`') {
      index += 1;
      continue;
    }
    if (ordinaryQuote === '"') {
      if (char === '"') ordinaryQuote = null;
      continue;
    }

    if (char === '$' && next === '{') {
      bracedVariable = true;
      index += 1;
      continue;
    }
    if (char === '<' && next === '#') {
      blockComment = true;
      index += 1;
      continue;
    }
    if (char === '#') {
      lineComment = true;
      continue;
    }

    if (input[index] !== '@' || (input[index + 1] !== "'" && input[index + 1] !== '"')) {
      if (char === "'" || char === '"') ordinaryQuote = char;
      continue;
    }

    const quote = input[index + 1];
    let openerLineEnd = index + 2;
    while (input[openerLineEnd] === ' ' || input[openerLineEnd] === '\t') openerLineEnd += 1;
    if (input[openerLineEnd] === '\r' && input[openerLineEnd + 1] === '\n') openerLineEnd += 1;
    if (input[openerLineEnd] !== '\n') {
      if (openerLineEnd >= input.length) break;
      continue;
    }

    let closingEnd = -1;
    for (let lineStart = openerLineEnd + 1; lineStart < input.length;) {
      let contentStart = lineStart;
      while (input[contentStart] === ' ' || input[contentStart] === '\t') contentStart += 1;
      if (input[contentStart] === quote && input[contentStart + 1] === '@') {
        closingEnd = contentStart + 2;
        break;
      }
      while (lineStart < input.length && input[lineStart] !== '\n') lineStart += 1;
      if (lineStart < input.length) lineStart += 1;
    }

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

    // Expandable here-strings execute their unescaped subexpressions while the
    // string value is being formed, independently of any later consumer.
    if (quote === '"') {
      for (let offset = openerLineEnd + 1; offset < contentEnd; offset += 1) {
        if (input[offset] === '`') {
          offset += 1;
          continue;
        }
        if (input[offset] !== '$' || input[offset + 1] !== '(') continue;
        const group = readBalancedGroup(input, offset + 1, '(', ')');
        if (!group || group.end > contentEnd) break;
        executablePayloads.push(group.body);
        offset = group.end - 1;
      }
    }

    if (closingEnd === -1) break;
    index = closingEnd - 1;
  }

  if (replacements.length === 0) return output.join('');
  let normalized = '';
  let cursor = 0;
  for (const replacement of replacements) {
    normalized += output.slice(cursor, replacement.start).join('');
    normalized += replacement.value;
    cursor = replacement.end;
  }
  normalized += output.slice(cursor).join('');
  return normalized;
}

function stripPowerShellComments(input) {
  const output = [...input];
  let quote = null;
  let lineComment = false;
  let blockComment = false;
  let bracedVariable = false;

  for (let index = 0; index < input.length; index += 1) {
    const char = input[index];
    const next = input[index + 1];

    if (lineComment) {
      if (char === '\n' || char === '\r') {
        lineComment = false;
      } else {
        output[index] = ' ';
      }
      continue;
    }

    if (blockComment) {
      if (char === '#' && next === '>') {
        output[index] = ' ';
        output[index + 1] = ' ';
        blockComment = false;
        index += 1;
      } else if (char !== '\n' && char !== '\r') {
        output[index] = ' ';
      }
      continue;
    }

    if (bracedVariable) {
      if (char === '`') index += 1;
      else if (char === '}') bracedVariable = false;
      continue;
    }

    if (quote === "'") {
      if (char === "'" && next === "'") {
        index += 1;
      } else if (char === "'") {
        quote = null;
      }
      continue;
    }
    if (char === '`') {
      index += 1;
      continue;
    }
    if (quote === '"') {
      if (char === '"') quote = null;
      continue;
    }
    if (char === "'" || char === '"') {
      quote = char;
      continue;
    }

    if (char === '$' && next === '{') {
      bracedVariable = true;
      index += 1;
      continue;
    }

    if (char === '<' && next === '#') {
      output[index] = ' ';
      output[index + 1] = ' ';
      blockComment = true;
      index += 1;
      continue;
    }

    if (char === '#') {
      output[index] = ' ';
      lineComment = true;
    }
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
  let quote = null;
  let lineComment = false;
  let blockComment = false;
  let bracedVariable = false;

  for (let index = openingIndex + 1; index < input.length; index += 1) {
    const char = input[index];
    const next = input[index + 1];

    if (lineComment) {
      if (char === '\n' || char === '\r') lineComment = false;
      continue;
    }
    if (blockComment) {
      if (char === '#' && next === '>') {
        blockComment = false;
        index += 1;
      }
      continue;
    }
    if (bracedVariable) {
      if (char === '`') index += 1;
      else if (char === '}') bracedVariable = false;
      continue;
    }

    if (quote === "'") {
      if (char === "'" && input[index + 1] === "'") {
        index += 1;
      } else if (char === "'") {
        quote = null;
      }
      continue;
    }
    if (char === '`') {
      index += 1;
      continue;
    }

    if (quote === '"') {
      if (char === '"') quote = null;
      continue;
    }

    if (char === "'" || char === '"') {
      quote = char;
      continue;
    }

    if (char === '$' && next === '{') {
      bracedVariable = true;
      index += 1;
      continue;
    }

    if (char === '<' && next === '#') {
      blockComment = true;
      index += 1;
      continue;
    }
    if (char === '#') {
      lineComment = true;
      continue;
    }

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

function invokesContainerResult(prefix) {
  const clause = currentClause(prefix);
  const pipelineStart = clause.lastIndexOf('|');
  const pipelineCommand = clause.slice(pipelineStart + 1).trim();
  return /(?:^|\s)(?:&|\.)\s*$/.test(clause) ||
    /\.\s*(?:foreach|where)\s*$/i.test(clause) ||
    /-(?:action|begin|command|end|expression|filter|initializationscript|parallel|process|scriptblock)(?:\s*:\s*)?$/i.test(clause) ||
    /^(?:(?:[\w.-]+\\)?(?:foreach-object|where-object|foreach|where|invoke-command|start-job|measure-command)|%|\?)(?:\s|$)/i.test(pipelineCommand);
}

function invokesDynamicResult(prefix) {
  return invokesContainerResult(prefix) ||
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

function staticStringArrayResult(body) {
  const input = String(body || '');
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
    if (!quote && char === '(') depth += 1;
    if (!quote && char === ')') depth -= 1;
    if (!quote && depth === 0 && char === ',') {
      items.push(item);
      item = '';
      continue;
    }
    item += char;
  }
  if (quote || depth !== 0) return null;
  items.push(item);
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
function extractExecutableContainers(input, options = {}) {
  const bodies = [];
  const deferredFunctions = [];
  const masked = [...input];
  let quote = null;
  let bracedVariable = false;
  let context = '';
  let contextTruncated = false;

  const resetContext = () => {
    context = '';
    contextTruncated = false;
  };

  const appendContext = value => {
    for (const contextChar of value) {
      if (contextChar === ';' || contextChar === '}') {
        resetContext();
      } else if (contextChar === '\n' || contextChar === '\r') {
        const clause = currentClause(context);
        if (/^(?:if|elseif|else|for|foreach|while|do|switch|default|try|catch|finally|trap|function|filter|workflow|begin|process|end|dynamicparam|clean)\b/i.test(clause)) {
          if (context && !context.endsWith(' ')) context += ' ';
        } else {
          resetContext();
        }
      } else if (/\s/.test(contextChar)) {
        if (context && !context.endsWith(' ')) context += ' ';
      } else {
        context += contextChar;
      }
      if (context.length > MAX_CONTEXT_LENGTH) {
        context = context.slice(-Math.floor(MAX_CONTEXT_LENGTH / 2));
        contextTruncated = true;
      }
    }
  };

  for (let index = 0; index < input.length; index += 1) {
    const char = input[index];

    if (bracedVariable) {
      if (char === '`' && index + 1 < input.length) {
        appendContext(input[index + 1]);
        index += 1;
      } else if (char === '}') {
        context += char;
        bracedVariable = false;
      } else {
        appendContext(char);
      }
      continue;
    }

    if (quote === "'") {
      if (char === "'" && input[index + 1] === "'") {
        index += 1;
      } else if (char === "'") {
        quote = null;
      }
      continue;
    }
    if (char === '`') {
      if (!quote && index + 1 < input.length) {
        const escaped = input[index + 1];
        appendContext(escaped === '\n' || escaped === '\r' ? ' ' : escaped);
        if (escaped === '\r' && input[index + 2] === '\n') index += 1;
      }
      index += 1;
      continue;
    }

    if (!quote && char === "'") {
      quote = "'";
      appendContext(' ');
      continue;
    }

    if (!quote && char === '$' && input[index + 1] === '{') {
      appendContext('${');
      bracedVariable = true;
      index += 1;
      continue;
    }

    if (char === '"') {
      quote = quote === '"' ? null : '"';
      if (quote === '"') appendContext(' ');
      continue;
    }

    const isSubexpression = char === '$' && input[index + 1] === '(';
    if (quote === '"' && !isSubexpression) continue;

    const isArrayExpression = !quote && char === '@' && input[index + 1] === '(';
    const isGroupingExpression = !quote && char === '(';
    const isScriptBlock = !quote && char === '{';
    const isHashtable = isScriptBlock && input[index - 1] === '@';
    const isCmdPayloadGroup = isGroupingExpression &&
      /(?:^|\s)cmd(?:\.exe)?\s+\/[ck](?:\s|$)/i.test(currentClause(context));
    if (!isSubexpression && !isArrayExpression && !isGroupingExpression && !isScriptBlock) {
      if (!quote) appendContext(char);
      continue;
    }
    if (isCmdPayloadGroup) {
      appendContext(char);
      continue;
    }

    const openingIndex = isSubexpression || isArrayExpression ? index + 1 : index;
    const open = isScriptBlock ? '{' : '(';
    const close = isScriptBlock ? '}' : ')';
    const group = readBalancedGroup(input, openingIndex, open, close);
    if (!group) {
      for (let offset = index; offset < input.length; offset += 1) masked[offset] = ' ';
      break;
    }

    const withinDoubleQuote = quote === '"';
    const prefix = context;
    const invokedAfter = isInvokedAfterContainer(input, group.end);
    const createsScriptBlock = /\[\s*(?:system\.management\.automation\.)?scriptblock\s*\]\s*::\s*create\s*$/i.test(
      currentClause(prefix)
    );
    const shouldScan = contextTruncated || !isScriptBlock || isHashtable || invokedAfter ||
      isExecutableScriptBlock(prefix, options);
    if (shouldScan) {
      const executesNestedScriptBlocks = isScriptBlock && /^switch\b/i.test(currentClause(prefix));
      bodies.push({
        body: group.body,
        options: {
          executeBareScriptBlocks: Boolean(options.executeBareScriptBlocks) ||
            invokedAfter || executesNestedScriptBlocks ||
            (!isScriptBlock && invokesContainerResult(prefix)),
        },
      });
    } else {
      const functionName = deferredScriptBlockName(prefix);
      if (functionName) deferredFunctions.push({ body: group.body, functionName });
    }
    if (createsScriptBlock && (invokedAfter || options.executeBareScriptBlocks)) {
      const scalarReference = variableReference(group.body);
      const scriptText = staticStringResult(group.body) ||
        (scalarReference ? options.staticScalars?.get(scalarReference) : null);
      if (scriptText) {
        bodies.push({ body: scriptText, options: { executeBareScriptBlocks: true } });
      }
    }
    for (let offset = index; offset < group.end; offset += 1) {
      masked[offset] = ' ';
    }
    let resolvedCommand = null;
    if (!isScriptBlock) {
      if (isSubexpression || invokesContainerResult(prefix)) {
        resolvedCommand = staticOutputResult(group.body);
        if (resolvedCommand === null && isSubexpression) {
          const scalarReference = variableReference(group.body);
          if (scalarReference) {
            resolvedCommand = options.staticScalars?.get(scalarReference) ?? null;
          }
        }
      } else if (/^(?:start-process|saps|start)\b/i.test(currentClause(prefix))) {
        resolvedCommand = staticStringArrayResult(group.body);
      } else if (/^new-object\b/i.test(currentClause(prefix))) {
        resolvedCommand = staticTypeNameResult(group.body);
      } else if (isPipedToPowerShellStdin(input, group.end)) {
        resolvedCommand = staticScalarResult(group.body);
      } else {
        resolvedCommand = staticCommandResult(group.body);
      }
    }
    const executableBlockExpression = /\{|\[\s*(?:system\.management\.automation\.)?scriptblock\s*\]\s*::\s*create/i.test(
      maskQuotedStrings(group.body)
    );
    if (!resolvedCommand && !isScriptBlock && invokesDynamicResult(prefix) && !executableBlockExpression) {
      resolvedCommand = DYNAMIC_EXECUTION_MARKER;
    }
    if (resolvedCommand) {
      for (let offset = 0; offset < resolvedCommand.length; offset += 1) {
        masked[index + offset] = resolvedCommand[offset];
      }
      if (!withinDoubleQuote) appendContext(resolvedCommand);
    } else if (isScriptBlock) {
      if (invokesContainerResult(prefix)) {
        context = prefix;
      } else {
        resetContext();
      }
    } else if (!withinDoubleQuote) {
      appendContext(' ');
    }
    index = group.end - 1;
  }

  return { bodies, deferredFunctions, outer: masked.join('') };
}

/**
 * Split PowerShell into statements, pipelines, and dequoted words. Backticks
 * are interpreted before token comparison so `Rem`ove-Item` normalizes to the
 * command PowerShell executes. Backslashes remain ordinary characters.
 */
function parseStatements(input) {
  const statements = [];
  let statement = [];
  let segment = [];
  let segmentQuotedTokens = [];
  let segmentQuoteKinds = [];
  let segmentTokenSources = [];
  let segmentInlineValueQuoteKinds = [];
  let word = '';
  let wordSource = '';
  let wordHasQuotedContent = false;
  let wordHasUnquotedContent = false;
  let wordQuoteKind = null;
  let wordInlineValueQuoteKind = null;
  let wordInlineValueQuoteClosed = false;
  let quote = null;
  let parenDepth = 0;
  let callOperatorPending = false;

  const flushWord = () => {
    if (word) {
      segment.push(word);
      segmentQuotedTokens.push(wordHasQuotedContent && !wordHasUnquotedContent);
      segmentQuoteKinds.push(
        wordHasQuotedContent && !wordHasUnquotedContent ? wordQuoteKind : null
      );
      segmentTokenSources.push(wordSource);
      segmentInlineValueQuoteKinds.push(
        wordInlineValueQuoteClosed && wordInlineValueQuoteKind !== 'mixed'
          ? wordInlineValueQuoteKind
          : null
      );
    }
    word = '';
    wordSource = '';
    wordHasQuotedContent = false;
    wordHasUnquotedContent = false;
    wordQuoteKind = null;
    wordInlineValueQuoteKind = null;
    wordInlineValueQuoteClosed = false;
  };
  const flushSegment = () => {
    flushWord();
    if (segment.length) {
      Object.defineProperties(segment, {
        invokedByCallOperator: { value: callOperatorPending },
        quotedTokens: { value: segmentQuotedTokens },
        quoteKinds: { value: segmentQuoteKinds },
        tokenSources: { value: segmentTokenSources },
        inlineValueQuoteKinds: { value: segmentInlineValueQuoteKinds },
      });
      statement.push(segment);
      callOperatorPending = false;
    }
    segment = [];
    segmentQuotedTokens = [];
    segmentQuoteKinds = [];
    segmentTokenSources = [];
    segmentInlineValueQuoteKinds = [];
  };
  const flushStatement = () => {
    flushSegment();
    if (statement.length) statements.push(statement);
    statement = [];
  };

  for (let index = 0; index < input.length; index += 1) {
    const char = input[index];

    if (quote === "'") {
      if (char === "'" && input[index + 1] === "'") {
        word += "'";
        wordSource += "''";
        index += 1;
      } else if (char === "'") {
        quote = null;
        if (wordInlineValueQuoteKind === "'") wordInlineValueQuoteClosed = true;
      } else {
        word += char;
        wordSource += char;
        wordHasQuotedContent = true;
      }
      continue;
    }

    if (char === '`') {
      if (index + 1 >= input.length) {
        word += '`';
        wordSource += '`';
        continue;
      }
      const escaped = input[index + 1];
      wordSource += `\`${escaped}`;
      index += 1;
      if (escaped === '\n' || escaped === '\r') {
        if (escaped === '\r' && input[index + 1] === '\n') {
          wordSource += '\n';
          index += 1;
        }
      } else {
        if (wordInlineValueQuoteClosed) wordInlineValueQuoteKind = 'mixed';
        word += escaped;
        if (quote) wordHasQuotedContent = true;
        else wordHasUnquotedContent = true;
      }
      continue;
    }

    if (quote === '"') {
      if (char === '"') {
        quote = null;
        if (wordInlineValueQuoteKind === '"') wordInlineValueQuoteClosed = true;
      } else {
        word += char;
        wordSource += char;
        wordHasQuotedContent = true;
      }
      continue;
    }

    if (char === "'" || char === '"') {
      if (wordInlineValueQuoteClosed) {
        wordInlineValueQuoteKind = 'mixed';
      } else if (wordInlineValueQuoteKind === null && /^-+[^:\s]+:$/.test(word)) {
        wordInlineValueQuoteKind = char;
      }
      quote = char;
      wordHasQuotedContent = true;
      wordQuoteKind = wordQuoteKind === null || wordQuoteKind === char ? char : 'mixed';
      continue;
    }

    if (char === '(') {
      if (wordInlineValueQuoteClosed) wordInlineValueQuoteKind = 'mixed';
      parenDepth += 1;
      word += char;
      wordSource += char;
      wordHasUnquotedContent = true;
      continue;
    }
    if (char === ')' && parenDepth > 0) {
      if (wordInlineValueQuoteClosed) wordInlineValueQuoteKind = 'mixed';
      parenDepth -= 1;
      word += char;
      wordSource += char;
      wordHasUnquotedContent = true;
      continue;
    }

    if (parenDepth === 0 && (char === ';' || char === '\n' || char === '\r')) {
      flushStatement();
      continue;
    }
    if (parenDepth === 0 && char === '|') {
      flushSegment();
      continue;
    }
    if (parenDepth === 0 && char === '&') {
      if (word || segment.length) flushStatement();
      callOperatorPending = true;
      continue;
    }
    if (/\s/.test(char)) {
      flushWord();
      continue;
    }

    if (wordInlineValueQuoteClosed) wordInlineValueQuoteKind = 'mixed';
    word += char;
    wordSource += char;
    wordHasUnquotedContent = true;
  }

  flushStatement();
  return statements;
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

function scanNestedPowerShell(tokens, depth, findings, analysis, scanState, upstreamTokens = null) {
  for (let index = 1; index < tokens.length; index += 1) {
    const token = tokens[index];

    if (isEncodedCommandFlag(token)) {
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
      if (decoded !== null) addNestedScan(decoded, depth, findings, analysis, {}, scanState);
      return;
    }

    if (isCommandFlag(token)) {
      const inlinePayload = parameterValue(token);
      let payload = inlinePayload
        ? [inlinePayload, ...tokens.slice(index + 1)].join(' ')
        : tokens.slice(index + 1).join(' ');
      const pipelinePayload = payload === '-' ? staticPipelineInput(upstreamTokens, scanState, findings) : null;
      const payloadIndex = index + 1;
      const inlineQuoteKind = tokens.inlineValueQuoteKinds?.[index];
      if (inlinePayload && inlineQuoteKind !== "'") {
        const inlineSource = parameterValue(tokens.tokenSources?.[index] || token);
        const expanded = expandStaticDoubleQuotedString(
          inlineSource || inlinePayload,
          scanState,
          findings
        );
        if (expanded === null) return;
        payload = [expanded, ...tokens.slice(index + 1)].join(' ');
      } else if (inlinePayload) {
        payload = [inlinePayload, ...tokens.slice(index + 1)].join(' ');
      } else if (tokens[payloadIndex] && tokens.quoteKinds?.[payloadIndex] !== "'") {
        const expanded = expandStaticDoubleQuotedString(
          tokens.tokenSources?.[payloadIndex] ?? tokens[payloadIndex],
          scanState,
          findings
        );
        if (expanded === null) return;
        payload = [expanded, ...tokens.slice(payloadIndex + 1)].join(' ');
      } else {
        const payloadReference = tokens.quoteKinds?.[payloadIndex] === "'"
          ? null
          : variableReference(payload);
        if (payloadReference) {
          const staticValue = scanState?.staticScalars.get(payloadReference);
          if (staticValue === undefined) {
            findings.add(RULE_IDS.DYNAMIC_EXECUTION);
            return;
          }
          payload = staticValue;
        }
      }
      if (pipelinePayload || (payload && payload !== '-')) {
        addNestedScan(
          pipelinePayload || payload,
          depth,
          findings,
          analysis,
          { executeBareScriptBlocks: true },
          scanState
        );
      }
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

function scanCmdWords(inputWords, depth, findings, analysis, scanState, wrapperDepth = 0) {
  if (wrapperDepth > 64) {
    findings.add(RULE_IDS.SCAN_DEPTH_EXCEEDED);
    return;
  }

  let words = inputWords.filter(Boolean).map(word => String(word));
  if (words.length === 0) return;
  words[0] = words[0].replace(/^@+/, '').replace(/^\(+/, '');
  words[words.length - 1] = words[words.length - 1].replace(/\)+$/, '');

  while (words.length > 0 && /^\d*(?:>>?|<<?)/.test(words[0])) {
    const redirection = words.shift();
    if (/^\d*(?:>>?|<<?)$/.test(redirection)) words.shift();
  }
  if (words.length === 0) return;

  let firstCommand = commandBasename(words[0].replace(/^@+/, '').replace(/^\(+/, ''));
  if (firstCommand === 'if') {
    const elseIndex = words.findIndex((word, index) => index > 0 && /^else$/i.test(word));
    const trueBranch = elseIndex === -1 ? words : words.slice(0, elseIndex);
    let commandIndex = 1;
    if (/^\/i$/i.test(trueBranch[commandIndex])) commandIndex += 1;
    if (/^not$/i.test(trueBranch[commandIndex])) commandIndex += 1;
    if (/^(?:exist|defined|errorlevel|cmdextversion)$/i.test(trueBranch[commandIndex])) {
      commandIndex += 2;
    } else if (/^(?:equ|neq|lss|leq|gtr|geq)$/i.test(trueBranch[commandIndex + 1])) {
      commandIndex += 3;
    } else {
      commandIndex += 1;
    }
    scanCmdWords(
      trueBranch.slice(commandIndex),
      depth,
      findings,
      analysis,
      scanState,
      wrapperDepth + 1
    );
    if (elseIndex !== -1) {
      scanCmdWords(
        words.slice(elseIndex + 1),
        depth,
        findings,
        analysis,
        scanState,
        wrapperDepth + 1
      );
    }
    return;
  }
  if (firstCommand === 'for') {
    const doIndex = words.findIndex(word => /^do$/i.test(word));
    if (doIndex !== -1) {
      scanCmdWords(
        words.slice(doIndex + 1),
        depth,
        findings,
        analysis,
        scanState,
        wrapperDepth + 1
      );
    }
    return;
  }
  if (firstCommand === 'call') {
    scanCmdWords(words.slice(1), depth, findings, analysis, scanState, wrapperDepth + 1);
    return;
  }
  if (firstCommand === 'start') {
    words = words.slice(1);
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
    scanCmdWords(words, depth, findings, analysis, scanState, wrapperDepth + 1);
    return;
  }

  if (POWERSHELL_COMMANDS.has(firstCommand) || firstCommand === 'cmd') {
    addNestedScan(
      [firstCommand, ...words.slice(1)].join(' '),
      depth,
      findings,
      analysis,
      { executeBareScriptBlocks: true },
      scanState
    );
    return;
  }
  if (CMD_DELETE_COMMANDS.has(firstCommand) && words.slice(1).some(word => /^[-/]s$/i.test(word))) {
    findings.add(RULE_IDS.CMD_RECURSIVE_DELETE);
  }
}

function scanCmd(tokens, depth, findings, analysis, scanState) {
  const flagIndex = tokens.findIndex((token, index) => index > 0 && /^\/[ck]$/i.test(token));
  if (flagIndex === -1) return;

  const payload = tokens
    .slice(flagIndex + 1)
    .filter(token => token !== '--%')
    .join(' ');
  for (const segment of splitCmdSegments(payload)) {
    scanCmdWords(
      segment.trim().split(/\s+/),
      depth,
      findings,
      analysis,
      scanState
    );
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

function scanStartProcess(tokens, depth, findings, analysis, scanState) {
  const command = commandBasename(tokens[0]);
  if (!['start-process', 'saps', 'start'].includes(command)) return;
  if (tokens.slice(1).some((token, index) =>
    !(tokens.quotedTokens || [])[index + 1] &&
      /^@(?:(?:global|script|local|private):)?[A-Za-z_][\w-]*$/i.test(token)
  )) {
    findings.add(RULE_IDS.DYNAMIC_EXECUTION);
    return;
  }

  let executable = null;
  let argumentParts = null;
  const quotedTokens = tokens.quotedTokens || [];

  for (let index = 1; index < tokens.length; index += 1) {
    if (quotedTokens[index]) continue;
    const parameter = startProcessParameterName(tokens[index]);
    if (parameter !== 'filepath') continue;
    executable = parameterValue(tokens[index]) || tokens[index + 1] || null;
    break;
  }

  for (let index = 1; index < tokens.length; index += 1) {
    const token = tokens[index];
    const quoted = quotedTokens[index] === true;
    const parameter = quoted ? null : startProcessParameterName(token);
    if (parameter === 'argumentlist') {
      const inlineValue = parameterValue(token);
      const end = tokens.findIndex(
        (candidate, candidateIndex) => candidateIndex > index &&
          !quotedTokens[candidateIndex] && startProcessParameterName(candidate)
      );
      const remaining = tokens.slice(index + 1, end === -1 ? tokens.length : end);
      argumentParts = inlineValue ? [inlineValue, ...remaining] : remaining;
      break;
    }
    if (parameter) {
      if (START_PROCESS_VALUE_PARAMETERS.has(parameter) && !parameterValue(token)) index += 1;
      continue;
    }
    if (!quoted && token.startsWith('-')) continue;
    if (executable !== null) continue;
    if (executable === null) {
      executable = token;
    }
  }

  if (argumentParts === null && executable !== null) {
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
      if (executableSeen) {
        argumentParts = tokens.slice(index);
        break;
      }
      if (!quotedTokens[index] && token.startsWith('-')) continue;
    }
  }

  const nestedCommand = commandBasename(executable);
  let argumentList = argumentParts ? normalizeArgumentList(argumentParts) : '';
  if (POWERSHELL_COMMANDS.has(nestedCommand) || nestedCommand === 'cmd') {
    const argumentReference = variableReference(argumentList);
    if (argumentReference) {
      const staticValue = scanState.staticScalars.get(argumentReference);
      if (staticValue === undefined) {
        findings.add(RULE_IDS.DYNAMIC_EXECUTION);
        return;
      }
      argumentList = staticValue;
    }
  }
  if ((POWERSHELL_COMMANDS.has(nestedCommand) || nestedCommand === 'cmd') && argumentList) {
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

function scanPowerShell(command, depth, findings, analysis = null, options = {}, scanState = null) {
  const raw = normalizeSmartQuotes(command);
  if (!raw.trim()) return;

  const state = scanState || createScanState();

  const hereStringExpressions = [];
  const normalizedHereStrings = normalizeHereStrings(raw, hereStringExpressions);
  const withoutComments = stripPowerShellComments(normalizedHereStrings);
  collectStaticScalarAssignments(withoutComments, state);
  const unquoted = maskQuotedStrings(withoutComments);
  scanInvokeScriptCalls(withoutComments, unquoted, depth, findings, analysis, state);
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
  const invokedBlockVariable = /(\$\{[^}]+\}|\$(?:[A-Za-z_][\w-]*:)?[A-Za-z_][\w-]*(?:\[[^\]]+\]|\.(?!getnewclosure\b)[A-Za-z_][\w-]*)*)(?:\.getnewclosure\s*\(\s*\))+\.\s*(?:invoke|invokereturnasis|invokewithcontext)\s*\(/gi;
  let invokedBlockMatch;
  while ((invokedBlockMatch = invokedBlockVariable.exec(unquoted)) !== null) {
    recordInvocation(state, invokedBlockMatch[1].toLowerCase());
  }
  for (const entry of bodies) {
    addNestedScan(entry.body, depth, findings, analysis, entry.options, state);
  }

  for (const statement of parseStatements(outer)) {
    const deleteSegments = new Set();
    const recurseSegments = new Set();

    for (let index = 0; index < statement.length; index += 1) {
      const segmentTokens = statement[index];
      const executable = executableSegment(segmentTokens);
      const tokens = executable.tokens;
      if (tokens.length === 0) continue;
      if (executable.firstTokenQuoted && !segmentTokens.invokedByCallOperator) continue;
      const commandName = commandBasename(tokens[0]);
      recordInvocation(state, commandName);
      const aliasTarget = state.aliases.get(commandName);
      if (aliasTarget) {
        addNestedScan(
          [aliasTarget, ...tokens.slice(1)].join(' '),
          depth,
          findings,
          analysis,
          { executeBareScriptBlocks: true },
          state
        );
      }
      if (['set-alias', 'new-alias', 'sal', 'nal'].includes(commandName)) {
        for (const definition of staticAliasDefinitions(tokens, executable.quotedTokens, state)) {
          state.aliases.set(definition.name, definition.value);
        }
      }
      const classInvocation = commandName.match(/^\[([a-z_][\w-]*)\]::/i);
      if (classInvocation) recordInvocation(state, `__class__:${classInvocation[1].toLowerCase()}`);
      if (commandName === 'new-object') {
        let className = newObjectClassName(tokens, executable.quotedTokens);
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
      const invokedVariable = commandName.match(
        /^((?:\$\{[^}]+\}|\$(?:[a-z_][\w-]*:)?[a-z_][\w-]*(?:\[[^\]]+\]|\.[a-z_][\w-]*)*))(?:\.getnewclosure\(\))*\.(?:invoke|invokereturnasis|invokewithcontext)(?:\(|$)/i
      );
      if (invokedVariable) recordInvocation(state, invokedVariable[1].toLowerCase());
      if (commandName === '.' && tokens[1]) {
        recordInvocation(state, commandBasename(tokens[1]));
      }
      markPowerShellElevation(tokens, analysis);
      scanStartProcess(tokens, depth, findings, analysis, state);
      scanScriptBlockConsumer(tokens, executable.quotedTokens, findings, state);
      if (tokens.some(token => commandBasename(token) === DYNAMIC_EXECUTION_MARKER)) {
        findings.add(RULE_IDS.DYNAMIC_EXECUTION);
      }

      const invokedReference = segmentTokens.invokedByCallOperator
        ? variableReference(tokens[0])
        : null;
      if (invokedReference && !state.deferredFunctions.has(invokedReference)) {
        const commandValue = state.staticScalars.get(invokedReference);
        if (commandValue === undefined) {
          findings.add(RULE_IDS.DYNAMIC_EXECUTION);
        } else if (POWERSHELL_COMMANDS.has(commandBasename(commandValue))) {
          scanNestedPowerShell(
            [commandValue, ...tokens.slice(1)],
            depth,
            findings,
            analysis,
            state,
            statement[index - 1]
          );
        } else {
          addNestedScan(
            [commandValue, ...tokens.slice(1)].join(' '),
            depth,
            findings,
            analysis,
            { executeBareScriptBlocks: true },
            state
          );
        }
      }

      if (POWERSHELL_COMMANDS.has(commandName)) {
        scanNestedPowerShell(tokens, depth, findings, analysis, state, statement[index - 1]);
      } else if (commandName === 'cmd') {
        scanCmd(tokens, depth, findings, analysis, state);
      } else if (commandName === 'invoke-expression' || commandName === 'iex') {
        let payload = tokens.slice(1).join(' ');
        const payloadReference = variableReference(payload);
        if (payloadReference) {
          const staticValue = state.staticScalars.get(payloadReference);
          if (staticValue === undefined) {
            findings.add(RULE_IDS.DYNAMIC_EXECUTION);
            payload = '';
          } else {
            payload = staticValue;
          }
        }
        if (payload) {
          addNestedScan(
            payload,
            depth,
            findings,
            analysis,
            { executeBareScriptBlocks: true },
            state
          );
        }
      } else if (commandName === 'clear-content' || commandName === 'clc') {
        findings.add(RULE_IDS.CLEAR_CONTENT);
      } else if (commandName === 'clear-disk') {
        findings.add(RULE_IDS.CLEAR_DISK);
      } else if (commandName === 'format-volume') {
        findings.add(RULE_IDS.FORMAT_VOLUME);
      }

      if (scanDeleteSegment(tokens, findings, executable.quotedTokens)) deleteSegments.add(index);
      if (tokens.some(
        (token, tokenIndex) => !executable.quotedTokens[tokenIndex] &&
          isEnabledSwitch(token, 'recurse')
      )) {
        recurseSegments.add(index);
      }
    }

    const hasUpstreamRecurse = [...recurseSegments].some(index => !deleteSegments.has(index));
    if (statement.length > 1 && deleteSegments.size > 0 && hasUpstreamRecurse) {
      findings.add(RULE_IDS.PIPELINE_RECURSE);
    }
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
