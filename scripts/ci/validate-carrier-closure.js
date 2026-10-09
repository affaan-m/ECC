#!/usr/bin/env node
/**
 * Carrier runtime-closure validator.
 *
 * Carriers are read-only file projections. Nothing here executes a planned
 * script: every relative module specifier is extracted statically and checked
 * against the planned file set of the carrier it would ship in.
 *
 * The static require-graph extraction technique is adapted from community
 * PR #2788 (affaan-m/ECC). The staged load smoke from that work -- actually
 * loading entry scripts from inside a materialized carrier -- is deliberately
 * not ported here, and neither is command pruning.
 */

'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { builtinModules } = require('node:module');
const { planContextCarrier } = require('../lib/context-carriers');
const { loadContextRegistry } = require('../lib/context-pack-registry');
const { DEFAULT_REPO_ROOT } = require('../lib/context-profile-support');

const PROFILES = Object.freeze(['lean@1', 'full@1']);
const BUILTINS = new Set(builtinModules);
const SCRIPT_EXTENSIONS = new Set(['.js', '.cjs', '.mjs']);
const MARK = '\u0000';
const SLOT = `${MARK}(\\d+)${MARK}`;
const CALL_PATTERN = new RegExp(`\\b(require|import)\\s*\\(\\s*${SLOT}\\s*\\)`, 'g');
const FROM_PATTERN = new RegExp(`\\bfrom\\s*${SLOT}`, 'g');
const SIDE_EFFECT_PATTERN = new RegExp(`\\bimport\\s*${SLOT}`, 'g');
const DIRNAME_JOIN_PATTERN = new RegExp(
  `\\brequire\\s*\\(\\s*path\\.join\\s*\\(\\s*__dirname\\s*((?:,\\s*${SLOT}\\s*)+)\\)\\s*\\)`, 'g');
const DYNAMIC_PATTERN = /\b(?:require|import)\s*\(\s*((?:[^()]|\([^()]*\))+)\)/g;
const STATIC_JOIN_PATTERN = new RegExp(`^path\\.join\\s*\\(\\s*__dirname\\s*(?:,\\s*${SLOT}\\s*)+\\)$`);
const SLOT_PATTERN = new RegExp(SLOT, 'g');
// Closes an interpolation; no keyword pattern can match across it.
const CLOSE = `${MARK}${MARK}`;
const ESCAPE_PATTERN = /\\(?:u\{([0-9a-fA-F]+)\}|u([0-9a-fA-F]{4})|x([0-9a-fA-F]{2})|(\r\n|[\s\S]))/g;
const SIMPLE_ESCAPES = Object.freeze({ n: '\n', r: '\r', t: '\t', b: '\b', f: '\f', v: '\v', 0: '\0' });
const LINE_CONTINUATIONS = new Set(['\n', '\r', '\r\n', '\u2028', '\u2029']);
// `}` ends a block, so a slash after it starts a statement: a regex.
const REGEX_PRECEDES = /(?:[([{},;:=!&|?+\-*/%~^<>]|\b(?:return|typeof|case|in|of|new|delete|void|instanceof|do|else|yield|await))$/;
const CONDITION_KEYWORD = /(?:^|[^\w$])(if|while|for|with)$/;

/** Cook a raw string or template chunk the way the JavaScript parser would. */
function decodeEscapes(raw) {
  return raw.replace(ESCAPE_PATTERN, (whole, braced, unicode, hex, other) => {
    if (braced !== undefined) {
      const codePoint = parseInt(braced, 16);
      return codePoint <= 0x10ffff ? String.fromCodePoint(codePoint) : whole;
    }
    if (unicode !== undefined) return String.fromCharCode(parseInt(unicode, 16));
    if (hex !== undefined) return String.fromCharCode(parseInt(hex, 16));
    if (LINE_CONTINUATIONS.has(other)) return '';
    return SIMPLE_ESCAPES[other] ?? other;
  });
}

function isAbsoluteSpecifier(value) {
  return value.startsWith('/') || value.startsWith('\\\\') || /^[A-Za-z]:[\\/]/.test(value) || /^file:/i.test(value);
}

/**
 * Whether code ends with a keyword whose `(` opens a statement condition.
 * `obj.if(`, `obj?. while(` and `obj.` + newline + `if(` are method calls,
 * so the token before the keyword, ignoring whitespace, must not be a dot.
 */
function opensCondition(code) {
  const match = CONDITION_KEYWORD.exec(code);
  return Boolean(match) && !code.slice(0, code.length - match[1].length).trimEnd().endsWith('.');
}

function readRegexLiteral(source, start) {
  let index = start + 1;
  let inClass = false;
  while (index < source.length) {
    const char = source[index];
    if (char === '\\') { index += 2; continue; }
    if (char === '\n') return index;
    if (char === '[') inClass = true;
    else if (char === ']') inClass = false;
    else if (char === '/' && !inClass) return index + 1;
    index += 1;
  }
  return index;
}

/**
 * Reduce source to a code skeleton in which every comment is gone and every
 * string literal is replaced by an indexed slot. A `require` shape written
 * inside a comment, a string, or a regex therefore cannot be mistaken for a
 * dependency, while `${...}` interpolations stay code.
 */
function scanSource(rawSource) {
  const source = String(rawSource || '');
  const literals = [];
  const stack = [];
  // Whether each open paren began a statement condition, and whether the
  // last one closed did: `/` after `if (...)` starts a regex, not division.
  const parens = [];
  let closedCondition = false;
  let code = '';
  let index = 0;
  // Slots cut from template literals; `from` and `import` need a quoted string.
  const templates = new Set();
  const slot = (value, fromTemplate = false) => {
    const slotIndex = literals.push(decodeEscapes(value)) - 1;
    if (fromTemplate) templates.add(slotIndex);
    code += `${MARK}${slotIndex}${MARK}`;
  };
  const frame = () => (stack.length ? stack[stack.length - 1] : null);

  while (index < source.length) {
    const char = source[index];
    const next = source[index + 1];
    const open = frame();

    if (open && open.type === 'template') {
      if (char === '\\') { open.text += source.substr(index, 2); index += 2; continue; }
      if (char === '`') { stack.pop(); slot(open.text, true); index += 1; continue; }
      if (char === '$' && next === '{') {
        slot(open.text, true);
        open.text = '';
        stack.push({ type: 'interpolation', depth: 0 });
        index += 2;
        continue;
      }
      open.text += char;
      index += 1;
      continue;
    }
    if (char === '/' && next === '/') {
      while (index < source.length && source[index] !== '\n') index += 1;
      continue;
    }
    if (char === '/' && next === '*') {
      index = source.indexOf('*/', index + 2);
      index = index === -1 ? source.length : index + 2;
      continue;
    }
    if (char === '/' && (REGEX_PRECEDES.test(code.trimEnd()) || (closedCondition && code.trimEnd().endsWith(')')))) {
      index = readRegexLiteral(source, index);
      code += ' ';
      continue;
    }
    if (char === '\'' || char === '"') {
      let cursor = index + 1;
      let value = '';
      while (cursor < source.length && source[cursor] !== char && source[cursor] !== '\n') {
        if (source[cursor] === '\\') { value += source.substr(cursor, 2); cursor += 2; continue; }
        value += source[cursor];
        cursor += 1;
      }
      slot(value);
      index = source[cursor] === char ? cursor + 1 : cursor;
      continue;
    }
    if (char === '`') { stack.push({ type: 'template', text: '' }); index += 1; continue; }
    if (open && open.type === 'interpolation') {
      if (char === '{') open.depth += 1;
      else if (char === '}') {
        if (open.depth === 0) { stack.pop(); index += 1; code += CLOSE; continue; }
        open.depth -= 1;
      }
    }
    if (char === '(') parens.push(opensCondition(code.trimEnd()));
    else if (char === ')') closedCondition = parens.pop() === true;
    code += char;
    index += 1;
  }
  if (frame() && frame().type === 'template') slot(frame().text, true);
  return { code, literals, templates };
}

function collect(pattern, code, handler) {
  pattern.lastIndex = 0;
  let match = pattern.exec(code);
  while (match !== null) {
    handler(match);
    match = pattern.exec(code);
  }
}

function renderExpression(text, literals) {
  return text.replace(SLOT_PATTERN, (_whole, slotIndex) => `'${literals[Number(slotIndex)]}'`).split(CLOSE).join(' ').trim();
}

/**
 * Extract the relative module specifiers a script declares, plus the
 * non-literal `require`/`import` arguments that cannot be resolved without
 * running the code. `imports` lists the specifiers reached through `import()`
 * or static `import`/`from`, which Node resolves by exact path.
 */
function extractReferences(rawSource) {
  const { code, literals, templates } = scanSource(rawSource);
  const specifiers = new Set();
  const imports = new Set();
  const packages = new Set();
  const dynamic = new Set();

  const record = (value, viaImport) => {
    if (value.startsWith('.') || isAbsoluteSpecifier(value)) {
      specifiers.add(value);
      if (viaImport) imports.add(value);
    } else if (!value.startsWith('node:') && !BUILTINS.has(value.split('/')[0])) {
      packages.add(value.startsWith('@') ? value.split('/').slice(0, 2).join('/') : value.split('/')[0]);
    }
  };
  collect(CALL_PATTERN, code, match => record(literals[Number(match[2])], match[1] === 'import'));
  // Static `from` and side-effect `import` take only a quoted string, so a
  // template there (a tag named `from`, say) is not an import.
  for (const pattern of [FROM_PATTERN, SIDE_EFFECT_PATTERN]) {
    collect(pattern, code, match => {
      if (!templates.has(Number(match[1]))) record(literals[Number(match[1])], true);
    });
  }
  collect(DIRNAME_JOIN_PATTERN, code, match => {
    const segments = [];
    collect(SLOT_PATTERN, match[1], slotMatch => segments.push(literals[Number(slotMatch[1])]));
    specifiers.add(`./${segments.join('/')}`);
  });
  collect(DYNAMIC_PATTERN, code, match => {
    const argument = match[1].trim();
    if (new RegExp(`^${SLOT}$`).test(argument) || STATIC_JOIN_PATTERN.test(argument)) return;
    dynamic.add(renderExpression(argument, literals));
  });
  return { specifiers: [...specifiers], imports: [...imports], packages: [...packages], dynamic: [...dynamic] };
}

/**
 * The planned paths that would satisfy a specifier, or the failure reason
 * when none can. CommonJS `require` tries the path, then `.js` and `.json`,
 * then a directory's `index.js` and `index.json` (`.cjs` and `.mjs` must be
 * named); ESM (`import`, or any `.mjs` file) resolves only the exact path.
 * A relative backslash is not a separator on Linux or macOS, so it is
 * rejected rather than normalized.
 */
function candidateDestinations(destinationPath, specifier, exact) {
  if (isAbsoluteSpecifier(specifier)) return { base: specifier, candidates: null, reason: 'outside-carrier-tree' };
  if (specifier.includes('\\')) return { base: specifier, candidates: null, reason: 'non-portable-separator' };
  const base = path.posix.join(path.posix.dirname(destinationPath), specifier);
  if (base === '..' || base.startsWith('../')) return { base, candidates: null, reason: 'outside-carrier-tree' };
  const candidates = exact
    ? [base]
    : [base, `${base}.js`, `${base}.json`, `${base}/index.js`, `${base}/index.json`];
  return { base, candidates, reason: null };
}

function sourceReader(repoRoot) {
  const cache = new Map();
  return file => {
    if (file.kind === 'generated') return file.content;
    if (!cache.has(file.sourcePath)) {
      cache.set(file.sourcePath, fs.readFileSync(path.join(repoRoot, ...file.sourcePath.split('/')), 'utf8'));
    }
    return cache.get(file.sourcePath);
  };
}

function inspectProjection(carrier, profileId, read, report) {
  const planned = new Set(carrier.files.map(file => file.destinationPath));
  const scripts = carrier.files.filter(file => SCRIPT_EXTENSIONS.has(path.posix.extname(file.destinationPath)));
  for (const file of scripts) {
    const { specifiers, imports, packages, dynamic } = extractReferences(read(file));
    const exactOnly = new Set(imports);
    const isModule = file.destinationPath.endsWith('.mjs');
    const location = {
      target: carrier.target, layout: carrier.layout.id, profileId,
      file: file.destinationPath, source: file.sourcePath || null,
    };
    for (const specifier of specifiers) {
      report.specifierCount += 1;
      const exact = isModule || exactOnly.has(specifier);
      const { base, candidates, reason } = candidateDestinations(file.destinationPath, specifier, exact);
      if (!candidates) {
        report.failures.push({ ...location, specifier, resolved: base, reason });
      } else if (candidates.some(candidate => planned.has(candidate))) {
        report.resolvedCount += 1;
      } else {
        report.failures.push({ ...location, specifier, resolved: base, reason: 'unplanned-target' });
      }
    }
    for (const expression of dynamic) {
      report.dynamicCount += 1;
      report.warnings.push({ ...location, kind: 'dynamic', expression });
    }
    for (const name of packages) {
      report.packageCount += 1;
      report.warnings.push({ ...location, kind: 'package', package: name });
    }
  }
  report.plannedFileCount += carrier.files.length;
  report.scriptCount += scripts.length;
}

function validate(repoRoot = DEFAULT_REPO_ROOT) {
  const registry = loadContextRegistry({ repoRoot });
  const read = sourceReader(repoRoot);
  const report = {
    plannedFileCount: 0, scriptCount: 0, specifierCount: 0, resolvedCount: 0, dynamicCount: 0, packageCount: 0,
    failures: [], warnings: [],
  };
  const layouts = [];
  const unsupportedTargets = [];

  for (const target of registry.targets) {
    let supported = null;
    for (const profileId of PROFILES) {
      const carrier = planContextCarrier({ repoRoot, profileId, target });
      if (!carrier.layout) break;
      supported = { target, layout: carrier.layout.id, skillRoot: carrier.layout.skillRoot };
      inspectProjection(carrier, profileId, read, report);
    }
    if (supported) layouts.push(supported); else unsupportedTargets.push(target);
  }

  return {
    schemaVersion: 'ecc.carrier-closure.v1',
    status: report.failures.length ? 'failure' : 'success',
    profiles: [...PROFILES], layouts, unsupportedTargets,
    projectionCount: layouts.length * PROFILES.length,
    registryDigest: registry.registryDigest,
    loadSmoke: 'deferred',
    lineage: 'static require-graph technique adapted from community PR #2788',
    ...report,
  };
}

function uniqueLines(entries, render) {
  return [...new Set(entries.map(render))];
}

function main(args = process.argv.slice(2)) {
  try {
    for (const arg of args) {
      if (arg !== '--json') throw new Error(`Unknown argument: ${arg}`);
    }
    const result = validate();
    if (args.includes('--json')) {
      console.log(JSON.stringify(result, null, 2));
    } else {
      for (const line of uniqueLines(result.warnings, w => (w.kind === 'package'
        ? `Package import, not shipped in carriers: ${w.file} -> ${w.package}`
        : `Dynamic require, not resolvable statically: ${w.file} -> ${w.expression}`))) {
        console.warn(line);
      }
      for (const line of uniqueLines(result.failures, f => `${f.layout} ${f.profileId}: ${f.file} -> ${f.specifier} (${f.reason})`)) {
        console.error(line);
      }
      console.log(`Carrier closure ${result.status}: ${result.layouts.length} layouts x ${result.profiles.length} profiles = ${result.projectionCount} projections, ${result.plannedFileCount} planned files, ${result.scriptCount} scripts, ${result.resolvedCount}/${result.specifierCount} relative specifiers resolved, ${result.failures.length} escapes, ${result.dynamicCount} dynamic requires, ${result.packageCount} package imports. Load smoke: deferred.`);
    }
    return result.status === 'success' ? 0 : 1;
  } catch (error) {
    console.error(`Carrier closure validation failed: ${error.message}`);
    return 1;
  }
}

if (require.main === module) process.exitCode = main();
module.exports = { extractReferences, main, scanSource, validate };
