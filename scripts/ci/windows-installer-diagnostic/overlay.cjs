'use strict';

const crypto = require('crypto');

const TEST_SHA256 = '9298f53bfcb02526e81eed132c94b2998bb9497707158dc3f6531558f1b96a63';
const CASES = [
  'installs manifest profiles and writes non-legacy install-state',
  'preserves existing top-level Claude rules and skills during managed install',
];

function verify(source, digest) {
  if (crypto.createHash('sha256').update(source).digest('hex') !== digest) {
    throw new Error('Diagnostic source hash mismatch; refusing a stale overlay');
  }
}

function replace(source, from, to, count = 1) {
  if (source.split(from).length - 1 !== count) {
    throw new Error(`Diagnostic anchor count mismatch: ${from}`);
  }
  return source.split(from).join(to);
}

function selectCases(source) {
  verify(source, TEST_SHA256);
  const begin = source.indexOf("  if (test('");
  const footer = source.indexOf('  console.log(`\\nResults: Passed:');
  const endMarker = '  })) passed++; else failed++;';
  const blocks = CASES.map(name => {
    const start = source.indexOf(`  if (test('${name}', () => {`);
    if (start < begin) throw new Error('Diagnostic case missing');
    const end = source.indexOf(endMarker, start);
    if (end < start || end >= footer) throw new Error('Diagnostic case boundary missing');
    const label = `  globalThis[Symbol.for('ecc.windows-installer-diagnostic.case')] = ${JSON.stringify(name)};\n`;
    return label + source.slice(start, end + endMarker.length);
  });
  // Byte-for-byte original helper, original case blocks (all assertions), and footer.
  return source.slice(0, begin) + blocks.join('\n\n') + '\n\n' + source.slice(footer);
}

const OVERLAYS = {
  'scripts/install-apply.js': {
    sha256: '92e7612d4f6408a53aecfbe9639551bf0c7f824bb0a3ca41c57074bc48cc3dec',
    edits: [
      ['    const rawPlan = createInstallPlanFromRequest(request, {',
        "    __eccTrace('planning:begin');\n    const rawPlan = createInstallPlanFromRequest(request, {"],
      ['    if (options.dryRun) {',
        "    __eccTrace('planning:end', { operations: rawPlan.operations.length });\n    if (options.dryRun) {"],
      ['    let result = applyInstallPlan(rawPlan);',
        "    __eccTrace('apply:begin');\n    let result = applyInstallPlan(rawPlan);\n    __eccTrace('apply:end');"],
      ["    const { projectCanonicalInstallState } = require('./lib/install-state-store-sync');",
        "    __eccTrace('projection:load');\n    const { projectCanonicalInstallState } = require('./lib/install-state-store-sync');\n    __eccTrace('projection:begin');"],
      ['    result = {\n      ...result,',
        "    __eccTrace('projection:end', { status: installStateProjection.status });\n    result = {\n      ...result,"],
    ],
  },
  'scripts/lib/install/apply.js': {
    sha256: 'c224e52a80064c7583abab093ccc3ec9c28d324412128bd2848a047b3f80b00f',
    edits: [
      ['  const migration = prepareHookConsentMigration(',
        "  __eccTrace('ownership:begin');\n  const migration = prepareHookConsentMigration(", 2],
      ['  const appliedPlan = {', "  __eccTrace('ownership:end');\n  const appliedPlan = {", 2],
      ['  const preparedClaudeSettings = preflightClaudeSettingsOperations(appliedPlan);',
        "  __eccTrace('settings-preflight:begin');\n  const preparedClaudeSettings = preflightClaudeSettingsOperations(appliedPlan);\n  __eccTrace('settings-preflight:end');"],
      ['  const linkIndex = buildLinkIndexForPlan(appliedPlan);',
        "  __eccTrace('link-index:begin');\n  const linkIndex = buildLinkIndexForPlan(appliedPlan);\n  __eccTrace('link-index:end');"],
      ['      for (const operation of appliedPlan.operations) {',
        "      for (const operation of appliedPlan.operations) {\n      __eccTrace('operation:path-check', { operation: operation.kind, path: operation.destinationPath });"],
      ['      fs.mkdirSync(path.dirname(operation.destinationPath), { recursive: true });',
        "      __eccTrace('operation:mkdir');\n      fs.mkdirSync(path.dirname(operation.destinationPath), { recursive: true });\n      __eccTrace('operation:path-recheck');"],
      ['      assertNoNewUserOwnedFile(migration, operation);',
        "      __eccTrace('operation:ownership-check');\n      assertNoNewUserOwnedFile(migration, operation);\n      __eccTrace('operation:write');"],
      ['      writtenDestinations.add(operation.destinationPath);',
        "      writtenDestinations.add(operation.destinationPath);\n      __eccTrace('operation:written', { completed: writtenDestinations.size });", 5],
      ['function stateWithContentDigests(state, plan) {',
        "function stateWithContentDigests(state, plan) {\n  __eccTrace('hash:begin', { operations: state.operations.length });"],
      ['      const installedContent = readInstalledFileNoFollow(plan, operation);',
        "      __eccTrace('hash:read-and-path-check', { path: operation.destinationPath });\n      const installedContent = readInstalledFileNoFollow(plan, operation);\n      __eccTrace('hash:digest');"],
      ['      persistInstallState(plan.installStatePath, finalState);',
        "      __eccTrace('state-write:begin');\n      persistInstallState(plan.installStatePath, finalState);\n      __eccTrace('state-write:end');"],
    ],
  },
  'scripts/lib/state-store/index.js': {
    sha256: '180a207c4732daae5ee683f895e0fd2fef0c831e989eb92fa9d7c3fbbdd93b8d',
    edits: [
      ['  const SQL = await initSqlJs();',
        "  __eccTrace('state-store:sql-init-begin');\n  const SQL = await initSqlJs();\n  __eccTrace('state-store:sql-init-end');"],
      ['  const db = await openDatabase(SQL, dbPath);',
        "  __eccTrace('state-store:open-begin');\n  const db = await openDatabase(SQL, dbPath);\n  __eccTrace('state-store:open-end');"],
      ['  const appliedMigrations = applyMigrations(db);',
        "  __eccTrace('state-store:migrate-begin');\n  const appliedMigrations = applyMigrations(db);\n  __eccTrace('state-store:migrate-end');"],
      ['      db.close();', "      __eccTrace('state-store:close-begin');\n      db.close();\n      __eccTrace('state-store:close-end');"],
    ],
  },
};

function overlay(relativePath, source) {
  const spec = OVERLAYS[relativePath];
  if (!spec) return source;
  verify(source, spec.sha256);
  for (const [from, to, count] of spec.edits) source = replace(source, from, to, count);
  // Keep the original shebang and strict-mode directive in place.
  const firstConst = source.indexOf('const ');
  return source.slice(0, firstConst)
    + "const __eccTrace = globalThis[Symbol.for('ecc.windows-installer-diagnostic')];\n"
    + source.slice(firstConst);
}

module.exports = { CASES, OVERLAYS, TEST_SHA256, overlay, selectCases };
