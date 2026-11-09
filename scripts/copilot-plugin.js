#!/usr/bin/env node
'use strict';
const { buildPlugin, verifyPlugin, previewMigration } = require('./lib/copilot-plugin');
const USAGE = 'Usage: copilot-plugin.js build --output <absolute-path> | verify --artifact <absolute-path> | preview --artifact <absolute-path> --project <absolute-path>';
function main(args = process.argv.slice(2)) {
  if (args.length === 3 && args[0] === 'build' && args[1] === '--output') {
    const report = buildPlugin({ output: args[2] });
    return { schema: report.schema, output: report.output, files: report.files,
      nativeStatus: report.nativeStatus, hooks: report.hooks };
  }
  if (args.length === 3 && args[0] === 'verify' && args[1] === '--artifact') {
    const { paths: _paths, ...verified } = verifyPlugin(args[2]);
    return verified;
  }
  if (args.length === 5 && args[0] === 'preview' && args[1] === '--artifact' && args[3] === '--project') {
    return previewMigration({ artifact: args[2], projectRoot: args[4] });
  }
  throw new Error(USAGE);
}
if (require.main === module) {
  try { process.stdout.write(JSON.stringify(main(), null, 2) + '\n'); }
  catch { process.stderr.write(`ECC Copilot plugin operation failed. Inspect artifact, source and project prerequisites.\n${USAGE}\n`); process.exitCode = 1; }
}
module.exports = { main };
