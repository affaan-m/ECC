const { spawnSync } = require('node:child_process');
const path = require('node:path');

const suite = path.join(__dirname, '../../skills/yoruba-localization-testing/examples/localization.test.mjs');
const result = spawnSync(process.execPath, [suite], { encoding: 'utf8' });

if (result.stdout) process.stdout.write(result.stdout);
if (result.stderr) process.stderr.write(result.stderr);

// ECC's parent runner counts TAP-style "Passed: N, Failed: N" summaries.
// Node 24 uses its spec reporter by default, while Node 18 prints TAP.
// Translate either native summary into ECC's established reporting format.
const passCount = result.stdout?.match(/^(?:#|\u2139)\s+pass\s+(\d+)\s*$/m);
const failCount = result.stdout?.match(/^(?:#|\u2139)\s+fail\s+(\d+)\s*$/m);
if (passCount && failCount) {
  console.log(`Passed: ${passCount[1]}, Failed: ${failCount[1]}`);
}
if (result.error) throw result.error;
if (result.status !== 0) process.exitCode = result.status || 1;
