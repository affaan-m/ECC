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

// Delimiters undergo quote removal, not command expansion. Keeping this small
// reader shared with substitution matching prevents body punctuation becoming
// shell syntax while locating the enclosing execution region.
function heredocDelimiter(input, start, budget) {
  if (!input.startsWith('<<', start) || input[start + 2] === '<') return null;
  const operator = input[start + 2] === '-' ? '<<-' : '<<';
  let i = start + operator.length;
  while (i < input.length) {
    budget.spend();
    if (input[i] === ' ' || input[i] === '\t' || input[i] === '\r') { i++; continue; }
    const continued = continuationEnd(input, i);
    if (continued === i) break;
    i = continued;
  }
  let value = '';
  let quote = null;
  let began = false;
  let quoted = false;
  for (; i < input.length; i++) {
    budget.spend();
    const c = input[i];
    if (quote === "'") {
      if (c === "'") quote = null;
      else value += c;
      continue;
    }
    if (c === '\\') {
      const continued = continuationEnd(input, i);
      if (continued !== i) { i = continued - 1; continue; }
      began = true; quoted = true;
      const next = input[i + 1];
      if (next === undefined) { value += c; continue; }
      if (quote === '"' && !'"$`\\'.includes(next)) value += '\\';
      value += next; i++; continue;
    }
    if (quote === '"') {
      if (c === '"') quote = null;
      else value += c;
      continue;
    }
    if (c === "'" || c === '"') { quote = c; began = true; quoted = true; continue; }
    if (/[\s;|&()<>]/.test(c) || (!began && c === '#')) break;
    began = true; value += c;
  }
  return began ? { operator, word: { value, quoted }, end: i } : null;
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

// Locate a nested execution region without evaluating any supplied text.
// Balanced substitutions have independent quote state; malformed regions extend
// to EOF and remain conservatively inspectable instead of silently disappearing.
function executionRegion(input, start, budget) {
  if (input[start] === '`') return legacyRegion(input, start, budget);
  const from = start + 2;
  const frame = () => ({ quote: null, depth: 1, cases: [], word: '', quotedWord: false, commandStart: true, heredocs: [] });
  const stack = [frame()];
  function endWord(state) {
    if (!state.word) return;
    const phase = state.cases[state.cases.length - 1];
    if (!state.quotedWord && state.word === 'esac' && (state.commandStart || phase === 'pattern')) state.cases.pop();
    else if (!state.quotedWord && state.word === 'case' && state.commandStart) state.cases.push('subject');
    else if (phase === 'subject') state.cases[state.cases.length - 1] = 'in';
    else if (!state.quotedWord && state.word === 'in' && phase === 'in') state.cases[state.cases.length - 1] = 'pattern';
    state.commandStart = false;
    state.word = ''; state.quotedWord = false;
  }
  for (let i = from; i < input.length; i++) {
    budget.spend();
    const state = stack[stack.length - 1];
    const c = input[i];
    if (state.quote === "'" || state.quote === "$'") {
      if (state.quote === "$'" && c === '\\' && i + 1 < input.length) { i++; continue; }
      if (c === "'") state.quote = null;
      continue;
    }
    if (c === '\\') { state.word += input[i + 1] || ''; state.quotedWord = true; i++; continue; }
    if (c === '$' && input[i + 1] === '(') {
      state.word += '$()'; state.quotedWord = true; stack.push(frame()); i++; continue;
    }
    if (c === '`') {
      const region = legacyRegion(input, i, budget);
      state.word += '`'; state.quotedWord = true; i = region.end - 1; continue;
    }
    if (state.quote === '"') {
      if (c === '"') state.quote = null;
      continue;
    }
    if (c === '$' && input[i + 1] === "'") {
      state.quote = "$'"; state.word += "$'"; state.quotedWord = true; i++; continue;
    }
    if (c === '"' || c === "'") { state.quote = c; state.word += c; state.quotedWord = true; continue; }
    if (c === '#' && /[\s;|&()]/.test(input[i - 1] || ' ')) {
      while (i < input.length && input[i] !== '\n') { budget.spend(); i++; }
      i--; // Process the newline, including any pending heredoc bodies.
      continue;
    }
    if (c === '<' && input.startsWith('<<<', i)) { endWord(state); i += 2; continue; }
    if (c === '<' && input[i + 1] === '<' && input[i + 2] !== '<') {
      endWord(state);
      const delimiter = heredocDelimiter(input, i, budget);
      if (delimiter) { state.heredocs.push(delimiter); i = delimiter.end - 1; continue; }
    }
    if (c === '\n' && state.heredocs.length) {
      endWord(state);
      let next = i + 1;
      for (const redirect of state.heredocs) next = heredocBody(input, next, redirect, budget).end;
      state.heredocs.length = 0;
      state.commandStart = true; i = next - 1; continue;
    }
    if (/[\s;|&()]/.test(c)) endWord(state);
    else state.word += c;
    const phase = state.cases[state.cases.length - 1];
    // A case pattern's closing ')' is not the end of $(...). Only literal
    // keyword positions affect this state; quoted or echo operands do not.
    if (c === ')' && phase === 'pattern') {
      state.cases[state.cases.length - 1] = 'body'; state.commandStart = true; continue;
    }
    if (c === '(' && phase === 'pattern') continue;
    if (c === ';' && input[i + 1] === ';' && phase === 'body') {
      state.cases[state.cases.length - 1] = 'pattern'; state.commandStart = true; i++; continue;
    }
    if (/[;|&\n]/.test(c)) state.commandStart = true;
    if (c === '(') state.depth++;
    if (c === ')') {
      state.depth--;
      if (state.depth === 0) {
        stack.pop();
        if (stack.length === 0) {
          budget.spend(i - from + 1);
          return { text: input.slice(from, i), end: i + 1 };
        }
      }
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

function scanShell(input, budget) {
  const commands = [];
  const nested = [];
  const pendingHeredocs = [];
  const rootScope = { parent: null, isolated: false, conditional: false };
  let scope = rootScope;
  const command = pipeFrom => ({ words: [], redirects: [], pipeFrom, nested: [], scope });
  let current = command(null);
  let word = null;
  let quote = null;
  let pendingRedirect = null;
  let i = 0;
  function begin() {
    if (!word) word = { value: '', start: i, end: i, quoted: false, literal: true, dynamic: false };
  }
  function flushWord() {
    if (!word) return;
    word.end = i;
    word.raw = input.slice(word.start, i);
    if (pendingRedirect) {
      const redirect = { operator: pendingRedirect, word, body: '' };
      current.redirects.push(redirect);
      if (pendingRedirect === '<<' || pendingRedirect === '<<-') pendingHeredocs.push({ redirect, owner: current });
      pendingRedirect = null;
    } else current.words.push(word);
    word = null;
  }
  function flushCommand(pipe = false, background = false) {
    flushWord();
    const previous = current;
    previous.pipeTo = pipe;
    previous.background = background;
    if (previous.closedScope && (pipe || background)) {
      previous.closedScope.isolated = true;
      previous.closedScope.pipelineLast = false;
    }
    const first = previous.words[0];
    if (first && !first.quoted && ['if', 'then', 'elif', 'else', 'while', 'until', 'do', 'case', 'for', 'select', 'function'].includes(first.value)) scope.conditional = true;
    if (previous.words.length || previous.redirects.length) commands.push(previous);
    current = command(pipe ? previous : null);
    pendingRedirect = null;
  }
  function consumeHeredocs() {
    for (const { redirect, owner } of pendingHeredocs) {
      const region = heredocBody(input, i, redirect, budget);
      redirect.body = region.body;
      i = region.end;
      if (!redirect.word.quoted) {
        const regions = scanExpansions(redirect.body, budget);
        for (const text of regions) { budget.spend(); nested.push(text); owner.nested.push(text); }
      }
    }
    pendingHeredocs.length = 0;
  }
  while (i < input.length) {
    budget.spend();
    const c = input[i];
    if (quote === "'" || quote === "$'") {
      if (quote === "$'" && c === '\\' && i + 1 < input.length) {
        const next = input[i + 1];
        // Preserve boundaries without claiming general ANSI-C escape expansion.
        word.value += next === "'" || next === '\\' ? next : c + next;
        i += 2; continue;
      }
      if (c === "'") quote = null;
      else word.value += c;
      i++; continue;
    }
    const continued = continuationEnd(input, i);
    if (continued !== i) { i = continued; continue; }
    if (c === '\\') {
      begin(); word.quoted = true;
      const next = input[i + 1];
      if (next === undefined) { word.value += c; i++; continue; }
      if (quote === '"' && !'"$`\\'.includes(next)) word.value += '\\';
      word.value += next; i += 2; continue;
    }
    if (hasExpansion(input, i, quote === null)) {
      begin(); word.literal = false; word.dynamic = true;
      const region = executionRegion(input, i, budget);
      nested.push(region.text); current.nested.push(region.text); word.value += '\u0000'; i = region.end; continue;
    }
    // Parameter expansions remain opaque values. Escaped/single/ANSI-C
    // quoted dollars have already been consumed as data above.
    if (c === '$' && /[A-Za-z0-9_@*#?$!{-]/.test(input[i + 1] || '')) {
      begin(); word.dynamic = true;
    }
    if (quote === '"') {
      if (c === '"') quote = null;
      else word.value += c;
      i++; continue;
    }
    if (c === '$' && input[i + 1] === "'") {
      // ANSI-C escaped quotes do not close the word; its contents never expand.
      // Numeric/control escapes and generated names remain outside this grammar.
      begin(); word.quoted = true; quote = "$'"; i += 2; continue;
    }
    if (c === '"' || c === "'") { begin(); word.quoted = true; quote = c; i++; continue; }
    if (c === '#' && !word) {
      while (i < input.length && input[i] !== '\n') { budget.spend(); i++; }
      continue;
    }
    const braceKeyword = (c === '{' || c === '}') && !word && current.words.length === 0 && /[\s;&|]/.test(input[i + 1] || ' ');
    if (c === '\n' || c === ';' || c === '&' || c === '|' || c === '(' || c === ')' || braceKeyword) {
      const pipe = c === '|' && input[i + 1] !== '|';
      const background = c === '&' && input[i + 1] !== '&';
      if ((c === '&' || c === '|') && input[i + 1] === c) scope.conditional = true;
      const incomingPipe = Boolean(current.pipeFrom);
      if (c === '(') {
        flushWord();
        // A function definition does not execute its body. Function grammar
        // is unsupported: keep pre-definition alternatives instead of using
        // flattened body mutations to certify a later command as safe.
        if (current.words.length === 1 && !current.words[0].quoted &&
            /^[A-Za-z_][A-Za-z0-9_]*$/.test(current.words[0].value)) scope.conditional = true;
      }
      flushCommand(pipe, background);
      if (c === '(' || (braceKeyword && c === '{')) {
        scope = { parent: scope, isolated: c === '(' || incomingPipe, conditional: false, pipelineLast: c === '{' && incomingPipe };
        current.scope = scope;
      } else if ((c === ')' || (braceKeyword && c === '}')) && scope.parent) {
        const closedScope = scope;
        scope = scope.parent;
        current.scope = scope;
        current.closedScope = closedScope;
        // Ordered metadata only; there is no executable argv in this event.
        commands.push({ ...command(null), scopeExit: closedScope });
      }
      i += (c === '&' || c === '|') && input[i + 1] === c ? 2 : 1;
      if (c === '\n') consumeHeredocs();
      continue;
    }
    if (c === '<' && input[i + 1] === '<' && input[i + 2] !== '<') {
      const delimiter = heredocDelimiter(input, i, budget);
      if (delimiter) {
        if (word && /^\d+$/.test(word.value)) word = null;
        flushWord();
        const redirect = { operator: delimiter.operator, word: delimiter.word, body: '' };
        current.redirects.push(redirect); pendingHeredocs.push({ redirect, owner: current });
        i = delimiter.end; pendingRedirect = null; continue;
      }
    }
    if (c === '<' || c === '>') {
      // An immediately adjacent numeric word is a descriptor, not an argv word.
      if (word && /^\d+$/.test(word.value)) word = null;
      flushWord();
      let operator = c;
      if (input[i + 1] === c) operator += c;
      if (operator === '<<' && input[i + 2] === '<') operator = '<<<';
      else if (operator === '<<' && input[i + 2] === '-') operator = '<<-';
      else if (input[i + 1] === '&') operator += '&';
      pendingRedirect = operator; i += operator.length; continue;
    }
    if (/\s/.test(c)) { flushWord(); i++; continue; }
    begin(); word.value += c; i++;
  }
  flushCommand();
  return { commands, nested, rootScope };
}

module.exports = { createBudget, scanShell, scanExpansions };
