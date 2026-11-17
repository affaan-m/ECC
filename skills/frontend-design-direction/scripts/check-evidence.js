#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');

const text = value => typeof value === 'string' && value.trim().length > 0;
const viewportKey = value => value.trim().toLowerCase().replace(/\s+/g, '');
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const states = ['loading', 'empty', 'error', 'partial', 'success', 'permission'];

// Checks the evidence record, not the visual quality or truth of observations.
function checkEvidence(report) {
  if (!object(report)) return ['report must be an object'];
  const check = (name, item, allowNotApplicable = false) => {
    if (object(item) && item.status === 'pass' && text(item.evidence)) return [];
    if (allowNotApplicable && object(item) && item.status === 'not-applicable' && text(item.reason)) return [];
    return [`${name} needs a passing observation${allowNotApplicable ? ' or a not-applicable reason' : ''}`];
  };
  const renders = Array.isArray(report.renderedEvidence) ? report.renderedEvidence : [];
  const targets = Array.isArray(report.targetViewports) ? report.targetViewports : [];
  const targetKeys = [...new Set(targets.filter(text).map(viewportKey))];
  return [
    ...(text(report.contract) ? [] : ['contract is required']),
    ...(targets.length && targets.every(text) ? [] : ['targetViewports must contain nonempty viewport strings']),
    ...targetKeys.flatMap(viewport => renders.some(item => object(item) && text(item.viewport) && viewportKey(item.viewport) === viewport)
      ? [] : [`renderedEvidence is missing target viewport ${viewport}`]),
    ...check('accessibility', report.accessibility),
    ...check('responsive', report.responsive),
    ...states.flatMap(state => check(`contentStates.${state}`, report.contentStates?.[state], true)),
    ...(renders.length ? [] : ['renderedEvidence is required']),
    ...renders.flatMap((item, i) => object(item) && text(item.viewport) && text(item.artifact) && text(item.observation)
      ? [] : [`renderedEvidence[${i}] needs viewport, artifact and observation`])
  ];
}

function main(args) {
  try {
    if (args.length !== 1) throw new Error('Usage: node check-evidence.js <local-report.json>');
    const reportPath = path.resolve(args[0]);
    const source = fs.readFileSync(reportPath, 'utf8');
    let report;
    try { report = JSON.parse(source); } catch { throw new Error('Report must contain valid JSON'); }
    const errors = checkEvidence(report);
    if (errors.length) throw new Error(errors.join('\n'));
    const root = fs.realpathSync(path.dirname(reportPath));
    for (const item of report.renderedEvidence) {
      if (path.isAbsolute(item.artifact) || path.win32.isAbsolute(item.artifact)
        || item.artifact.includes(':') || item.artifact.split(/[\\/]/).includes('..')) {
        throw new Error('Evidence artifacts must stay inside the report directory');
      }
      const artifact = path.resolve(root, item.artifact);
      const relative = path.relative(root, fs.realpathSync(artifact));
      if (relative.startsWith(`..${path.sep}`) || relative === '..' || path.isAbsolute(relative)) {
        throw new Error('Evidence artifacts must stay inside the report directory');
      }
      const info = fs.lstatSync(artifact);
      if (!info.isFile() || info.size === 0) throw new Error('Evidence artifact must be a nonempty local file');
    }
    console.log('Evidence record complete; visual correctness still requires rendered inspection.');
    return 0;
  } catch (error) {
    console.error(error.message);
    return 1;
  }
}

if (require.main === module) process.exitCode = main(process.argv.slice(2));
module.exports = { checkEvidence };
