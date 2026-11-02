'use strict';

// Finite literal shell scanner for block-no-verify. This is not an interpreter:
// aliases, generated programs, expansion results and foreign languages remain
// opaque. Every scan/queued region spends one shared input-proportional budget.
function createBudget(length) {
  let remaining = 24 * (length + 1) + 4096;
  return { spend(amount = 1) {
    remaining -= amount;
    if (remaining < 0) throw new RangeError('Shell scan work budget exceeded');
  } };
}

function continuationEnd(input, index) {
  if (input[index] !== '\\') return index;
  if (input[index + 1] === '\n') return index + 2;
  if (input[index + 1] === '\r' && input[index + 2] === '\n') return index + 3;
  return index;
}

// Skip to the end of a comment. The returned index is the newline or EOF.
function skipComment(input, start, budget) {
  let i = start;
  while (i < input.length && input[i] !== '\n') { budget.spend(); i++; }
  return i;
}

function skipDelimiterBlanks(input, start, budget) {
  let i = start;
  while (i < input.length) {
    budget.spend();
    if (input[i] === ' ' || input[i] === '\t' || input[i] === '\r') { i++; continue; }
    const continued = continuationEnd(input, i);
    if (continued === i) break;
    i = continued;
  }
  return i;
}

// A backslash in the delimiter word. Returns the index of the last consumed
// character; a continuation is removed without starting the word.
function delimiterEscape(input, i, word) {
  const continued = continuationEnd(input, i);
  if (continued !== i) return continued - 1;
  word.began = true; word.quoted = true;
  const next = input[i + 1];
  if (next === undefined) { word.value += '\\'; return i; }
  if (word.quote === '"' && !'"$`\\'.includes(next)) word.value += '\\';
  word.value += next;
  return i + 1;
}

function readDelimiterWord(input, start, budget) {
  const word = { value: '', quote: null, began: false, quoted: false, end: start };
  let i = start;
  for (; i < input.length; i++) {
    budget.spend();
    const c = input[i];
    if (word.quote === "'") {
      if (c === "'") word.quote = null;
      else word.value += c;
      continue;
    }
    if (c === '\\') { i = delimiterEscape(input, i, word); continue; }
    if (word.quote === '"') {
      if (c === '"') word.quote = null;
      else word.value += c;
      continue;
    }
    if (c === "'" || c === '"') { word.quote = c; word.began = true; word.quoted = true; continue; }
    if (/[\s;|&()<>]/.test(c) || (!word.began && c === '#')) break;
    word.began = true; word.value += c;
  }
  word.end = i;
  return word;
}

// Delimiters undergo quote removal, not command expansion. Keeping this small
// reader shared with substitution matching prevents body punctuation becoming
// shell syntax while locating the enclosing execution region.
function heredocDelimiter(input, start, budget) {
  if (!input.startsWith('<<', start) || input[start + 2] === '<') return null;
  const operator = input[start + 2] === '-' ? '<<-' : '<<';
  const word = readDelimiterWord(input, skipDelimiterBlanks(input, start + operator.length, budget), budget);
  return word.began ? { operator, word: { value: word.value, quoted: word.quoted }, end: word.end } : null;
}

function heredocLine(input, start, joinContinuations, budget) {
  const parts = [];
  let i = start;
  let fragment = start;
  while (i < input.length && input[i] !== '\n') {
    budget.spend();
    if (joinContinuations && input[i] === '\\') {
      const continued = continuationEnd(input, i);
      if (continued !== i) {
        budget.spend(i - fragment + 1);
        parts.push(input.slice(fragment, i));
        i = continued; fragment = i; continue;
      }
      // An escaped backslash cannot itself quote the following newline. Keep
      // the pair unchanged; only the unpaired final slash joins physical lines.
      if (i + 1 < input.length) { i += 2; continue; }
    }
    i++;
  }
  budget.spend(3 * (i - start + 1));
  parts.push(input.slice(fragment, i));
  const newline = i < input.length;
  return { text: parts.join(''), newline, end: newline ? i + 1 : i };
}

function heredocBody(input, start, redirect, budget) {
  const lines = [];
  let length = 0;
  let i = start;
  while (i < input.length) {
    // Bash removes unquoted backslash-newline before testing the ending
    // delimiter. Quoted delimiters retain physical lines. The original end
    // offset is kept separately so the next actual command is never swallowed.
    const line = heredocLine(input, i, !redirect.word.quoted, budget);
    budget.spend(2 * (line.text.length + 1));
    const text = redirect.operator === '<<-' ? line.text.replace(/^\t+/, '') : line.text;
    i = line.end;
    if (text.replace(/\r$/, '') === redirect.word.value) break;
    lines.push(text);
    length += text.length;
    if (line.newline) { lines.push('\n'); length++; }
  }
  budget.spend(length + 1);
  return { body: lines.join(''), end: i };
}

function legacyRegion(input, start, budget) {
  const decoded = [];
  let i = start + 1;
  for (; i < input.length; i++) {
    budget.spend();
    const c = input[i];
    if (c === '`') break;
    if (c === '\\' && '$`\\\n'.includes(input[i + 1] || '\u0000')) {
      // One old-style substitution layer only. Escapes outside an executable
      // backtick region are still handled by the outer lexer as literal data.
      const next = input[++i];
      if (next !== '\n') decoded.push(next);
    } else decoded.push(c);
  }
  budget.spend(decoded.length + 1);
  return { text: decoded.join(''), end: i < input.length ? i + 1 : i };
}

// --- $(...) region state ---
// Each helper below takes the innermost frame and the index of the current
// character. Those that consume input return the index of the last consumed
// character, or undefined when the character was not theirs to handle.

function regionFrame() {
  return { quote: null, depth: 1, cases: [], word: '', quotedWord: false, commandStart: true, heredocs: [] };
}

function endRegionWord(state) {
  if (!state.word) return;
  const phase = state.cases[state.cases.length - 1];
  if (!state.quotedWord && state.word === 'esac' && (state.commandStart || phase === 'pattern')) state.cases.pop();
  else if (!state.quotedWord && state.word === 'case' && state.commandStart) state.cases.push('subject');
  else if (phase === 'subject') state.cases[state.cases.length - 1] = 'in';
  else if (!state.quotedWord && state.word === 'in' && phase === 'in') state.cases[state.cases.length - 1] = 'pattern';
  state.commandStart = false;
  state.word = ''; state.quotedWord = false;
}

// Inside '...' or $'...': only the closing quote matters, and an ANSI-C escape
// protects the next character.
function regionQuotedEnd(state, input, i) {
  const c = input[i];
  if (state.quote === "$'" && c === '\\' && i + 1 < input.length) return i + 1;
  if (c === "'") state.quote = null;
  return i;
}

// Escapes and nested substitutions apply inside double quotes as well.
function regionSubstitution(state, stack, input, i, budget) {
  const c = input[i];
  if (c === '\\') { state.word += input[i + 1] || ''; state.quotedWord = true; return i + 1; }
  if (c === '$' && input[i + 1] === '(') {
    state.word += '$()'; state.quotedWord = true; stack.push(regionFrame()); return i + 1;
  }
  if (c === '`') {
    const region = legacyRegion(input, i, budget);
    state.word += '`'; state.quotedWord = true; return region.end - 1;
  }
  return undefined;
}

function openRegionQuote(state, input, i) {
  const c = input[i];
  if (c === '$' && input[i + 1] === "'") {
    state.quote = "$'"; state.word += "$'"; state.quotedWord = true; return i + 1;
  }
  if (c === '"' || c === "'") { state.quote = c; state.word += c; state.quotedWord = true; return i; }
  return undefined;
}

// A here-string or heredoc operator ends the current word. A heredoc
// delimiter queues its body for the next newline.
function regionHeredocOperator(state, input, i, budget) {
  if (input[i] !== '<') return undefined;
  if (input.startsWith('<<<', i)) { endRegionWord(state); return i + 2; }
  if (input[i + 1] === '<' && input[i + 2] !== '<') {
    endRegionWord(state);
    const delimiter = heredocDelimiter(input, i, budget);
    if (delimiter) { state.heredocs.push(delimiter); return delimiter.end - 1; }
  }
  return undefined;
}

function regionHeredocBodies(state, input, i, budget) {
  endRegionWord(state);
  let next = i + 1;
  for (const redirect of state.heredocs) next = heredocBody(input, next, redirect, budget).end;
  state.heredocs.length = 0;
  state.commandStart = true;
  return next - 1;
}

// A case pattern's closing ')' is not the end of $(...). Only literal
// keyword positions affect this state; quoted or echo operands do not.
function casePhaseStep(state, input, i) {
  const c = input[i];
  const phase = state.cases[state.cases.length - 1];
  if (c === ')' && phase === 'pattern') {
    state.cases[state.cases.length - 1] = 'body'; state.commandStart = true; return i;
  }
  if (c === '(' && phase === 'pattern') return i;
  if (c === ';' && input[i + 1] === ';' && phase === 'body') {
    state.cases[state.cases.length - 1] = 'pattern'; state.commandStart = true; return i + 1;
  }
  return undefined;
}

// Tracks parenthesis depth; true once the outermost region has closed.
function closeRegionParen(stack, state, c) {
  if (/[;|&\n]/.test(c)) state.commandStart = true;
  if (c === '(') state.depth++;
  if (c !== ')') return false;
  state.depth--;
  if (state.depth !== 0) return false;
  stack.pop();
  return stack.length === 0;
}

// Locate a nested execution region without evaluating any supplied text.
// Balanced substitutions have independent quote state; malformed regions extend
// to EOF and remain conservatively inspectable instead of silently disappearing.
function executionRegion(input, start, budget) {
  if (input[start] === '`') return legacyRegion(input, start, budget);
  const from = start + 2;
  const stack = [regionFrame()];
  for (let i = from; i < input.length; i++) {
    budget.spend();
    const state = stack[stack.length - 1];
    const c = input[i];
    if (state.quote === "'" || state.quote === "$'") { i = regionQuotedEnd(state, input, i); continue; }
    const substituted = regionSubstitution(state, stack, input, i, budget);
    if (substituted !== undefined) { i = substituted; continue; }
    if (state.quote === '"') {
      if (c === '"') state.quote = null;
      continue;
    }
    const opened = openRegionQuote(state, input, i);
    if (opened !== undefined) { i = opened; continue; }
    if (c === '#' && /[\s;|&()]/.test(input[i - 1] || ' ')) {
      // Stop before the newline so pending heredoc bodies are still processed.
      i = skipComment(input, i, budget) - 1;
      continue;
    }
    const redirected = regionHeredocOperator(state, input, i, budget);
    if (redirected !== undefined) { i = redirected; continue; }
    if (c === '\n' && state.heredocs.length) { i = regionHeredocBodies(state, input, i, budget); continue; }
    if (/[\s;|&()]/.test(c)) endRegionWord(state);
    else state.word += c;
    const stepped = casePhaseStep(state, input, i);
    if (stepped !== undefined) { i = stepped; continue; }
    if (closeRegionParen(stack, state, c)) {
      budget.spend(i - from + 1);
      return { text: input.slice(from, i), end: i + 1 };
    }
  }
  budget.spend(input.length - from + 1);
  return { text: input.slice(from), end: input.length };
}

function hasExpansion(input, index, processSubstitution = false) {
  return input[index] === '`' || (input[index] === '$' && input[index + 1] === '(') ||
    (processSubstitution && '<>'.includes(input[index]) && input[index + 1] === '(');
}

// Unquoted heredoc bodies expand even inside quote characters in the body.
// Backslash still protects $, ` and backslash; quoted delimiters skip this pass.
function scanExpansions(input, budget) {
  const nested = [];
  for (let i = 0; i < input.length;) {
    budget.spend();
    if (input[i] === '\\' && /[$`\\\r\n]/.test(input[i + 1] || '')) {
      const continued = continuationEnd(input, i);
      i = continued !== i ? continued : i + 2;
      continue;
    }
    if (hasExpansion(input, i)) {
      const region = executionRegion(input, i, budget);
      nested.push(region.text); i = region.end;
    } else i++;
  }
  return nested;
}

// --- Top-level scan state ---
// scan.i is the read position; every helper advances it past what it consumed.

const COMPOUND_KEYWORDS = ['if', 'then', 'elif', 'else', 'while', 'until', 'do', 'case', 'for', 'select', 'function'];

function newCommand(scan, pipeFrom) {
  return { words: [], redirects: [], pipeFrom, nested: [], scope: scan.scope };
}

function createScan(input, budget) {
  const rootScope = { parent: null, isolated: false, conditional: false };
  const scan = {
    input, budget, commands: [], nested: [], pendingHeredocs: [], rootScope,
    scope: rootScope, current: null, word: null, quote: null, pendingRedirect: null, i: 0
  };
  scan.current = newCommand(scan, null);
  return scan;
}

function beginWord(scan) {
  if (!scan.word) scan.word = { value: '', start: scan.i, end: scan.i, quoted: false, literal: true, dynamic: false };
}

function flushWord(scan) {
  const { word, current } = scan;
  if (!word) return;
  word.end = scan.i;
  word.raw = scan.input.slice(word.start, scan.i);
  if (scan.pendingRedirect) {
    const redirect = { operator: scan.pendingRedirect, word, body: '' };
    current.redirects.push(redirect);
    if (scan.pendingRedirect === '<<' || scan.pendingRedirect === '<<-') scan.pendingHeredocs.push({ redirect, owner: current });
    scan.pendingRedirect = null;
  } else current.words.push(word);
  scan.word = null;
}

function flushCommand(scan, pipe = false, background = false) {
  flushWord(scan);
  const previous = scan.current;
  previous.pipeTo = pipe;
  previous.background = background;
  if (previous.closedScope && (pipe || background)) {
    previous.closedScope.isolated = true;
    previous.closedScope.pipelineLast = false;
  }
  const first = previous.words[0];
  if (first && !first.quoted && COMPOUND_KEYWORDS.includes(first.value)) scan.scope.conditional = true;
  if (previous.words.length || previous.redirects.length) scan.commands.push(previous);
  scan.current = newCommand(scan, pipe ? previous : null);
  scan.pendingRedirect = null;
}

function consumeHeredocs(scan) {
  for (const { redirect, owner } of scan.pendingHeredocs) {
    const region = heredocBody(scan.input, scan.i, redirect, scan.budget);
    redirect.body = region.body;
    scan.i = region.end;
    if (!redirect.word.quoted) {
      const regions = scanExpansions(redirect.body, scan.budget);
      for (const text of regions) { scan.budget.spend(); scan.nested.push(text); owner.nested.push(text); }
    }
  }
  scan.pendingHeredocs.length = 0;
}

// Inside '...' or $'...'.
function scanQuotedChar(scan) {
  const c = scan.input[scan.i];
  if (scan.quote === "$'" && c === '\\' && scan.i + 1 < scan.input.length) {
    const next = scan.input[scan.i + 1];
    // Preserve boundaries without claiming general ANSI-C escape expansion.
    scan.word.value += next === "'" || next === '\\' ? next : c + next;
    scan.i += 2;
    return;
  }
  if (c === "'") scan.quote = null;
  else scan.word.value += c;
  scan.i++;
}

function scanDoubleQuotedChar(scan, c) {
  if (c === '"') scan.quote = null;
  else scan.word.value += c;
  scan.i++;
}

function scanEscape(scan) {
  beginWord(scan); scan.word.quoted = true;
  const next = scan.input[scan.i + 1];
  if (next === undefined) { scan.word.value += '\\'; scan.i++; return; }
  if (scan.quote === '"' && !'"$`\\'.includes(next)) scan.word.value += '\\';
  scan.word.value += next; scan.i += 2;
}

function scanSubstitution(scan) {
  beginWord(scan); scan.word.literal = false; scan.word.dynamic = true;
  const region = executionRegion(scan.input, scan.i, scan.budget);
  scan.nested.push(region.text); scan.current.nested.push(region.text);
  scan.word.value += '\u0000'; scan.i = region.end;
}

// Parameter expansions remain opaque values. Escaped/single/ANSI-C
// quoted dollars have already been consumed as data before this point.
function markParameterExpansion(scan, c) {
  if (c === '$' && /[A-Za-z0-9_@*#?$!{-]/.test(scan.input[scan.i + 1] || '')) {
    beginWord(scan); scan.word.dynamic = true;
  }
}

function openQuote(scan, c) {
  if (c === '$' && scan.input[scan.i + 1] === "'") {
    // ANSI-C escaped quotes do not close the word; its contents never expand.
    // Numeric/control escapes and generated names remain outside this grammar.
    beginWord(scan); scan.word.quoted = true; scan.quote = "$'"; scan.i += 2;
    return true;
  }
  if (c === '"' || c === "'") { beginWord(scan); scan.word.quoted = true; scan.quote = c; scan.i++; return true; }
  return false;
}

function isBraceKeyword(scan, c) {
  return (c === '{' || c === '}') && !scan.word && scan.current.words.length === 0 && /[\s;&|]/.test(scan.input[scan.i + 1] || ' ');
}

function markFunctionDefinition(scan) {
  flushWord(scan);
  // A function definition does not execute its body. Function grammar
  // is unsupported: keep pre-definition alternatives instead of using
  // flattened body mutations to certify a later command as safe.
  const words = scan.current.words;
  if (words.length === 1 && !words[0].quoted && /^[A-Za-z_][A-Za-z0-9_]*$/.test(words[0].value)) scan.scope.conditional = true;
}

function openScope(scan, c, incomingPipe) {
  scan.scope = { parent: scan.scope, isolated: c === '(' || incomingPipe, conditional: false, pipelineLast: c === '{' && incomingPipe };
  scan.current.scope = scan.scope;
}

function closeScope(scan) {
  const closedScope = scan.scope;
  scan.scope = closedScope.parent;
  scan.current.scope = scan.scope;
  scan.current.closedScope = closedScope;
  // Ordered metadata only; there is no executable argv in this event.
  scan.commands.push({ ...newCommand(scan, null), scopeExit: closedScope });
}

function scanOperator(scan, c, braceKeyword) {
  const doubled = (c === '&' || c === '|') && scan.input[scan.i + 1] === c;
  const pipe = c === '|' && !doubled;
  const background = c === '&' && !doubled;
  if (doubled) scan.scope.conditional = true;
  const incomingPipe = Boolean(scan.current.pipeFrom);
  if (c === '(') markFunctionDefinition(scan);
  flushCommand(scan, pipe, background);
  if (c === '(' || (braceKeyword && c === '{')) openScope(scan, c, incomingPipe);
  else if ((c === ')' || (braceKeyword && c === '}')) && scan.scope.parent) closeScope(scan);
  scan.i += doubled ? 2 : 1;
  if (c === '\n') consumeHeredocs(scan);
}

// An immediately adjacent numeric word is a descriptor, not an argv word.
function dropDescriptorWord(scan) {
  if (scan.word && /^\d+$/.test(scan.word.value)) scan.word = null;
}

function queueHeredoc(scan, delimiter) {
  dropDescriptorWord(scan);
  flushWord(scan);
  const redirect = { operator: delimiter.operator, word: delimiter.word, body: '' };
  scan.current.redirects.push(redirect);
  scan.pendingHeredocs.push({ redirect, owner: scan.current });
  scan.i = delimiter.end;
  scan.pendingRedirect = null;
}

function redirectOperator(input, i, c) {
  let operator = c;
  if (input[i + 1] === c) operator += c;
  if (operator === '<<' && input[i + 2] === '<') operator = '<<<';
  else if (operator === '<<' && input[i + 2] === '-') operator = '<<-';
  else if (input[i + 1] === '&') operator += '&';
  return operator;
}

function scanRedirect(scan, c) {
  const { input } = scan;
  if (c === '<' && input[scan.i + 1] === '<' && input[scan.i + 2] !== '<') {
    const delimiter = heredocDelimiter(input, scan.i, scan.budget);
    if (delimiter) { queueHeredoc(scan, delimiter); return; }
  }
  dropDescriptorWord(scan);
  flushWord(scan);
  scan.pendingRedirect = redirectOperator(input, scan.i, c);
  scan.i += scan.pendingRedirect.length;
}

function scanShell(input, budget) {
  const scan = createScan(input, budget);
  while (scan.i < input.length) {
    budget.spend();
    if (scan.quote === "'" || scan.quote === "$'") { scanQuotedChar(scan); continue; }
    const continued = continuationEnd(input, scan.i);
    if (continued !== scan.i) { scan.i = continued; continue; }
    const c = input[scan.i];
    if (c === '\\') { scanEscape(scan); continue; }
    if (hasExpansion(input, scan.i, scan.quote === null)) { scanSubstitution(scan); continue; }
    markParameterExpansion(scan, c);
    if (scan.quote === '"') { scanDoubleQuotedChar(scan, c); continue; }
    if (openQuote(scan, c)) continue;
    if (c === '#' && !scan.word) { scan.i = skipComment(input, scan.i, budget); continue; }
    const braceKeyword = isBraceKeyword(scan, c);
    if (braceKeyword || '\n;&|()'.includes(c)) { scanOperator(scan, c, braceKeyword); continue; }
    if (c === '<' || c === '>') { scanRedirect(scan, c); continue; }
    if (/\s/.test(c)) { flushWord(scan); scan.i++; continue; }
    beginWord(scan); scan.word.value += c; scan.i++;
  }
  flushCommand(scan);
  return { commands: scan.commands, nested: scan.nested, rootScope: scan.rootScope };
}

module.exports = { createBudget, scanShell, scanExpansions };
