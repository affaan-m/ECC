#!/usr/bin/env node
/**
 * Carrier runtime-closure validator.
 *
 * Carriers are read-only file projections. Nothing here executes a planned
 * script: literal require/import/export dependencies are parsed statically and checked
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
const ts = require('typescript');

function isAbsoluteSpecifier(value) {
  return value.startsWith('/') || value.startsWith('\\\\') || /^[A-Za-z]:[\\/]/.test(value) || /^file:/i.test(value);
}

/** Parse without evaluating source, and reject incomplete or invalid syntax. */
function scanSource(rawSource) {
  const source = ts.createSourceFile('carrier.js', String(rawSource || ''),
    ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
  if (source.parseDiagnostics.length) {
    const diagnostic = source.parseDiagnostics[0];
    const error = new SyntaxError(ts.flattenDiagnosticMessageText(diagnostic.messageText, ' '));
    error.position = diagnostic.start;
    throw error;
  }
  return source;
}

/** Extract literal dependencies and report dynamic expressions without execution. */
function extractReferences(rawSource) {
  const source = scanSource(rawSource);
  const specifiers = new Set(), imports = new Set(), packages = new Set(), dynamic = new Set();
  const record = (value, viaImport) => {
    if (value.startsWith('.') || isAbsoluteSpecifier(value)) {
      specifiers.add(value);
      if (viaImport) imports.add(value);
    } else if (!value.startsWith('node:') && !BUILTINS.has(value.split('/')[0])) {
      packages.add(value.startsWith('@') ? value.split('/').slice(0, 2).join('/') : value.split('/')[0]);
    }
  };
  const identifier = (node, name) => ts.isIdentifier(node) && node.text === name;
  const member = (node, receiver, name) => ts.isPropertyAccessExpression(node)
    && identifier(node.expression, receiver) && node.name.text === name;
  const literal = node => ts.isStringLiteralLike(node) ? node.text : null;
  const staticJoin = node => {
    if (!ts.isCallExpression(node) || !member(node.expression, 'path', 'join')
      || !node.arguments.length || !identifier(node.arguments[0], '__dirname')) return null;
    const parts = node.arguments.slice(1).map(literal);
    return parts.every(value => value !== null) ? `./${parts.join('/')}` : null;
  };
  const visit = node => {
    if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier) {
      record(node.moduleSpecifier.text, true);
    } else if (ts.isCallExpression(node)) {
      const viaImport = node.expression.kind === ts.SyntaxKind.ImportKeyword;
      if (viaImport || identifier(node.expression, 'require') || member(node.expression, 'module', 'require')) {
        const argument = node.arguments[0];
        if (argument) {
          const value = literal(argument);
          const joined = viaImport ? null : staticJoin(argument);
          if (value !== null) record(value, viaImport);
          else if (joined !== null) record(joined, false);
          else dynamic.add(argument.getText(source));
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return { specifiers: [...specifiers], imports: [...imports], packages: [...packages], dynamic: [...dynamic] };
}

function candidateDestinations(destinationPath, specifier, exact) {
  if (exact && !isAbsoluteSpecifier(specifier)) {
    // ESM resolves file URLs: query/fragment change identity, not the file path.
    // Node rejects encoded separators; never normalize them into a safe path.
    if (/%2f|%5c/i.test(specifier)) return { base: specifier, candidates: null, reason: 'invalid-url-separator' };
    try { specifier = decodeURIComponent(specifier.split(/[?#]/)[0]); }
    catch (_error) { return { base: specifier, candidates: null, reason: 'invalid-url-encoding' }; }
  }
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
    let references;
    try { references = extractReferences(read(file)); }
    catch (error) {
      report.failures.push({ target: carrier.target, layout: carrier.layout.id, profileId,
        file: file.destinationPath, source: file.sourcePath || null, reason: 'parse-error', diagnostic: error.message });
      continue;
    }
    const { specifiers, imports, packages, dynamic } = references;
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
    limitations: ['Dynamic dependency expressions and arbitrary aliases are warnings or outside this literal-dependency gate.',
      'Parsing does not execute scripts or certify provider-native runtime behavior.'],
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
