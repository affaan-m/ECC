'use strict';

const assert = require('assert/strict');
const os = require('os');
const path = require('path');
const { compareDiscovery, fixtureEnvironment, plannedSkills } = require('../../scripts/copilot-native-discovery');

const fixture = path.join(os.tmpdir(), 'ecc native discovery');
const installed = path.join(fixture, 'project', '.github', 'skills');
const expected = new Map(['alpha', 'beta', 'gamma'].map(name => [name, path.join(installed, name)]));
const item = (name, extra = {}) => ({ name, path: path.join(installed, name), source: 'project', enabled: true, ...extra });

assert.deepEqual(compareDiscovery(expected, [item('alpha'), item('beta'), item('gamma'), item('builtin', { source: 'builtin' })]),
  { expected: 3, matched: 3, missing: [] });
console.log('PASS offline discovery matches exact installed project paths');

assert.deepEqual(compareDiscovery(expected, [item('alpha'), item('beta', { source: 'user' }),
  item('gamma', { enabled: false }), item('gamma', { path: path.join(fixture, 'other', 'gamma') })]),
{ expected: 3, matched: 1, missing: ['beta', 'gamma'] });
assert.throws(() => compareDiscovery(expected, { skills: [] }), /skill list shape/);
console.log('PASS shadowed, disabled and foreign skills cannot certify discovery');

const env = fixtureEnvironment(fixture, { Path: '/bin', GH_TOKEN: 'secret', GITHUB_TOKEN: 'secret',
  COPILOT_HOME: '/other/profile', HOME: '/other/home', GIT_DIR: '/other/repo', COPILOT_AUTO_UPDATE: 'true' });
assert.equal(env.Path, '/bin');
assert.equal(env.COPILOT_HOME, path.join(fixture, 'copilot'));
assert.equal(env.HOME, fixture);
assert.equal(env.COPILOT_AUTO_UPDATE, 'false');
for (const key of ['GH_TOKEN', 'GITHUB_TOKEN', 'GIT_DIR']) assert.equal(Object.hasOwn(env, key), false);
console.log('PASS native fixture excludes ambient credentials and configuration');
const project = path.join(fixture, 'project');
const destinations = [...expected.values()].map(dir => path.join(dir, 'SKILL.md'));
destinations.push(path.join(installed, 'alpha', 'references', 'SKILL.md'), path.join(project, 'foreign', 'SKILL.md'));
assert.deepEqual(plannedSkills(destinations.map(destinationPath => ({ destinationPath })), project), expected);
console.log('PASS expectations come from planned project skill destinations, independent of installed files');
console.log('Passed: 4, Failed: 0');
