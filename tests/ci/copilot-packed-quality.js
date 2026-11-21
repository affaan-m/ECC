'use strict';

const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const {
  assertDownloadedArtifact,
  assertHash,
  createLifecycleEnvironment,
  hashFile,
  parseEnvironment,
} = require('./packed-artifact-lifecycle');

const launcher = '.github/ecc/scripts/quality/copilot-quality.cjs';
const skill = '.github/skills/plankton-code-quality/SKILL.md';

function run(command, args, cwd, env, { input, status = 0 } = {}) {
  const result = spawnSync(command, args, { cwd, env, input, encoding: 'utf8', timeout: 120000 });
  assert.ifError(result.error);
  assert.equal(result.status, status, `${command} ${args[0]}\n${result.stderr}\n${result.stdout}`);
  return result;
}

function installPackage(project, env, artifact) {
  fs.writeFileSync(path.join(project, 'package.json'), JSON.stringify({
    name: 'copilot-packed-quality-fixture',
    version: '1.0.0',
    private: true,
    dependencies: { 'ecc-universal': pathToFileURL(artifact).href },
  }));
  const args = ['install', '--ignore-scripts', '--no-audit', '--no-fund'];
  if (process.platform === 'win32') {
    run(env.ComSpec || 'cmd.exe', ['/d', '/s', '/c', `npm ${args.join(' ')}`], project, env);
  } else {
    run('npm', args, project, env);
  }
  return path.join(project, 'node_modules', 'ecc-universal');
}

function formatterFixture(project, formatter, concurrentFile, { pnpm = false } = {}) {
  const name = formatter === 'biome' ? '@biomejs/biome' : 'prettier';
  const modules = path.join(project, 'node_modules');
  const parts = name.split('/');
  const localPackage = path.join(modules, ...parts);
  const pkg = pnpm
    ? path.join(modules, '.pnpm', name.replace('/', '+') + '@1.0.0', 'node_modules', ...parts)
    : localPackage;
  fs.mkdirSync(path.join(pkg, 'bin'), { recursive: true });
  const manifest = path.join(pkg, 'package.json');
  fs.writeFileSync(manifest, JSON.stringify({ name, bin: { [formatter]: 'bin/fixture.cjs' } }));
  fs.writeFileSync(path.join(pkg, 'bin', 'fixture.cjs'), `
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const input = fs.readFileSync(0, 'utf8');
const args = process.argv.slice(2);
assert.equal(process.env.NODE_OPTIONS, undefined);
assert.equal(process.env.NODE_PATH, undefined);
assert.equal(process.env.BIOME_CONFIG_PATH, undefined);
assert.notEqual(process.cwd(), ${JSON.stringify(project)});
if (${JSON.stringify(formatter)} === 'biome') {
  assert.equal(args[0], 'format');
  const config = args.find(arg => arg.startsWith('--config-path=')).slice('--config-path='.length);
  assert.equal(fs.readFileSync(config, 'utf8'), '{}\\n');
  assert.match(args.at(-1), /^--stdin-file-path=ecc-quality\\./);
} else {
  assert.deepEqual(args.slice(0, 3), ['--no-config', '--no-editorconfig', '--stdin-filepath']);
  assert.match(args[3], /^ecc-quality\\./);
}
assert.ok(!args.includes('--write'));
if (input === 'fixture failure') {
  process.stderr.write('private formatter fixture diagnostic\\n');
  process.exitCode = 2;
} else if (input === 'fixture output limit') {
  process.stdout.write('x'.repeat(3 * 1024 * 1024));
} else if (input === 'fixture empty output') {
  process.exitCode = 0;
} else if (input === 'fixture concurrent edit') {
  fs.writeFileSync(${JSON.stringify(concurrentFile)}, 'editor fixture update');
  process.stdout.write('replacement fixture');
} else if (input === 'fixture moved source directory') {
  const sourceDirectory = path.join(${JSON.stringify(project)}, 'source directory');
  const previousDirectory = path.join(${JSON.stringify(project)}, 'previous directory');
  fs.renameSync(sourceDirectory, previousDirectory);
  fs.mkdirSync(sourceDirectory);
  fs.renameSync(path.join(previousDirectory, 'nested'), path.join(sourceDirectory, 'nested'));
  process.stdout.write('replacement fixture');
} else {
  process.stdout.write(input.replace('const x=1;', 'const x = 1;'));
}
`);
  if (pnpm) {
    fs.mkdirSync(path.dirname(localPackage), { recursive: true });
    if (process.platform === 'win32') {
      fs.symlinkSync(pkg, localPackage, 'junction');
    } else {
      fs.symlinkSync(path.relative(path.dirname(localPackage), pkg), localPackage, 'dir');
    }
    const contentStore = path.join(project, 'fixture-content-store', formatter);
    fs.mkdirSync(contentStore, { recursive: true });
    fs.linkSync(manifest, path.join(contentStore, 'package.json'));
    fs.linkSync(path.join(pkg, 'bin', 'fixture.cjs'), path.join(contentStore, 'fixture.cjs'));
    assert.equal(fs.statSync(manifest).nlink, 2);
  }
  return { manifest, localPackage };
}

function verifyInstalledQuality(root, packageRoot, env) {
  const projects = ['Prettier project café', 'Biome project'].map(name => path.join(root, name));
  const cli = path.join(packageRoot, 'scripts', 'ecc.js');
  for (const project of projects) {
    fs.mkdirSync(project);
    const metadata = '{"type":"module","private":true}\n';
    fs.writeFileSync(path.join(project, 'package.json'), metadata);
    run(process.execPath, [cli, 'install', '--target', 'copilot', '--skills', 'plankton-code-quality', '--json'], project, env);
    const guidance = fs.readFileSync(path.join(project, skill), 'utf8');
    assert.ok(guidance.includes(launcher));
    assert.equal(fs.readFileSync(path.join(project, 'package.json'), 'utf8'), metadata);
    assert.equal(fs.existsSync(path.join(project, '.github/ecc/scripts/quality/package.json')), false);
    assert.equal(fs.existsSync(path.join(project, '.github/hooks')), false);
  }
  const [project, biomeProject] = projects;
  const file = 'source file.js';
  const target = path.join(project, file);
  const invoke = (args, status = 0, cwd = project) => {
    const result = run(process.execPath, [launcher, ...args], cwd, {
      ...env,
      NODE_OPTIONS: '--no-warnings',
      NODE_PATH: path.join(root, 'external fixture modules'),
      BIOME_CONFIG_PATH: path.join(root, 'external fixture config'),
    }, { status });
    assert.equal(result.stderr, '');
    assert.doesNotMatch(result.stdout, /private formatter fixture diagnostic|editor fixture update|replacement fixture/);
    return JSON.parse(result.stdout);
  };

  fs.writeFileSync(target, 'const x=1;\n', { mode: 0o640 });
  const mode = fs.statSync(target).mode & 0o777;
  const unavailable = invoke(['--file', file], 2);
  assert.equal(unavailable.status, 'unavailable');
  assert.equal(unavailable.reason, 'formatter-not-installed');
  assert.equal(unavailable.fixed, false);
  const { manifest, localPackage } = formatterFixture(project, 'prettier', target);

  const mismatch = invoke(['--file', file], 1);
  assert.equal(mismatch.reason, 'formatting-difference');
  assert.equal(mismatch.coverage, 'formatter-defaults');
  assert.equal(mismatch.fixed, false);
  assert.equal(fs.readFileSync(target, 'utf8'), 'const x=1;\n');
  const fixed = invoke(['--file', file, '--fix']);
  assert.equal(fixed.status, 'passed');
  assert.equal(fixed.fixed, true);
  assert.equal(fs.readFileSync(target, 'utf8'), 'const x = 1;\n');
  assert.equal(fs.statSync(target).mode & 0o777, mode);
  assert.equal(invoke(['--file', file, '--fix']).fixed, false);

  for (const [contents, status, reason] of [
    ['fixture failure', 1, 'formatter-failed'],
    ['fixture output limit', 2, 'formatter-output-limit'],
    ['fixture empty output', 2, 'invalid-formatter-output'],
  ]) {
    fs.writeFileSync(target, contents);
    const failed = invoke(['--file', file, '--fix'], status);
    assert.equal(failed.reason, reason);
    assert.equal(failed.fixed, false);
    assert.equal(fs.readFileSync(target, 'utf8'), contents);
  }

  fs.writeFileSync(target, 'fixture concurrent edit');
  const changed = invoke(['--file', file, '--fix'], 2);
  assert.equal(changed.reason, 'file-changed');
  assert.equal(changed.fixed, false);
  assert.equal(fs.readFileSync(target, 'utf8'), 'editor fixture update');

  const nested = path.join('source directory', 'nested', 'retained.js');
  const retained = path.join(project, nested);
  fs.mkdirSync(path.dirname(retained), { recursive: true });
  fs.writeFileSync(retained, 'fixture moved source directory');
  const moved = invoke(['--file', nested, '--fix'], 2);
  assert.equal(moved.reason, 'file-changed');
  assert.equal(moved.fixed, false);
  assert.equal(fs.readFileSync(retained, 'utf8'), 'fixture moved source directory');
  assert.deepEqual(fs.readdirSync(path.dirname(retained)), ['retained.js']);

  const yamlManifest = path.join(project, 'source directory', 'package.yaml');
  fs.writeFileSync(yamlManifest, 'prettier:\n  semi: false\n');
  fs.writeFileSync(retained, 'const x=1;\n');
  assert.equal(invoke(['--file', nested, '--fix'], 2).reason, 'project-config-present');
  assert.equal(fs.readFileSync(retained, 'utf8'), 'const x=1;\n');
  assert.equal(invoke(['--file', nested, '--defaults'], 1).projectConfig, 'bypassed');
  fs.writeFileSync(yamlManifest, 'name: example\n');
  assert.equal(invoke(['--file', nested], 2).reason, 'project-config-present');
  fs.unlinkSync(yamlManifest);

  fs.writeFileSync(target, 'const x=1;\n');
  fs.writeFileSync(path.join(project, '.prettierrc.cjs'), 'throw new Error("Never load fixture project config");\n');
  const blocked = invoke(['--file', file, '--fix'], 2);
  assert.equal(blocked.reason, 'project-config-present');
  assert.equal(fs.readFileSync(target, 'utf8'), 'const x=1;\n');
  assert.equal(invoke(['--file', file, '--defaults'], 1).projectConfig, 'bypassed');

  for (const input of ['../outside.js', path.resolve(target), '.']) {
    assert.equal(invoke(['--file', input], 2).fixed, false);
  }
  assert.equal(invoke(['--file', 'source\tfile.js'], 2).reason, 'unsafe-file');
  const linkedDirectory = path.join(project, 'linked');
  const externalDirectory = path.join(root, 'existing linked destination');
  fs.mkdirSync(externalDirectory);
  fs.writeFileSync(path.join(externalDirectory, 'outside.js'), 'const x=1;\n');
  fs.symlinkSync(externalDirectory, linkedDirectory, process.platform === 'win32' ? 'junction' : 'dir');
  assert.equal(invoke(['--file', 'linked/outside.js', '--fix', '--defaults'], 2).fixed, false);
  assert.equal(fs.readFileSync(path.join(externalDirectory, 'outside.js'), 'utf8'), 'const x=1;\n');

  const unowned = path.join(project, 'outside-package.cjs');
  fs.writeFileSync(unowned, 'process.stdout.write("Unexpected formatter fixture");\n');
  fs.writeFileSync(manifest, JSON.stringify({ name: 'prettier', bin: '../..' + '/outside-package.cjs' }));
  assert.equal(invoke(['--file', file, '--defaults'], 2).reason, 'unsafe-formatter');

  fs.rmSync(localPackage, { recursive: true });
  const pnpm = formatterFixture(project, 'prettier', target, { pnpm: true });
  assert.equal(invoke(['--file', file, '--defaults'], 1).reason, 'formatting-difference');
  const hardLinkedSource = path.join(project, 'hard-linked.js');
  fs.linkSync(target, hardLinkedSource);
  assert.equal(invoke(['--file', file, '--defaults', '--fix'], 2).reason, 'unsafe-file');
  fs.unlinkSync(hardLinkedSource);
  fs.writeFileSync(pnpm.manifest, JSON.stringify({ name: 'prettier', bin: '../outside.cjs' }));
  assert.equal(invoke(['--file', file, '--defaults'], 2).reason, 'unsafe-formatter');
  fs.unlinkSync(localPackage);
  for (const invalidPackage of [
    path.join(root, 'external-formatter-package'),
    path.join(project, 'node_modules', '.pnpm', 'another-package@1.0.0', 'node_modules', 'prettier'),
  ]) {
    fs.mkdirSync(invalidPackage, { recursive: true });
    fs.symlinkSync(invalidPackage, localPackage, process.platform === 'win32' ? 'junction' : 'dir');
    assert.equal(invoke(['--file', file, '--defaults'], 2).reason, 'unsafe-formatter');
    fs.unlinkSync(localPackage);
  }

  fs.writeFileSync(path.join(biomeProject, file), 'const x=1;\n');
  formatterFixture(biomeProject, 'biome', path.join(biomeProject, file), { pnpm: true });
  const biomeYaml = path.join(biomeProject, 'package.yaml');
  fs.writeFileSync(biomeYaml, 'name: example\n');
  const fallback = invoke(['--file', file], 1, biomeProject);
  assert.equal(fallback.formatter, 'biome');
  assert.equal(fallback.reason, 'formatting-difference');
  assert.equal(fallback.projectConfig, 'none-detected');
  fs.writeFileSync(biomeYaml, 'prettier:\n  semi: false\n');
  assert.equal(invoke(['--file', file], 1, biomeProject).formatter, 'biome');
  const prettierConfig = path.join(biomeProject, '.prettierrc.json');
  fs.writeFileSync(prettierConfig, '{"semi":false}\n');
  assert.equal(invoke(['--file', file], 2, biomeProject).reason, 'formatter-not-installed');
  fs.unlinkSync(prettierConfig);
  fs.unlinkSync(biomeYaml);

  fs.writeFileSync(path.join(biomeProject, 'biome.json'), '{"formatter":{"indentWidth":4}}\n');
  assert.equal(invoke(['--file', file], 2, biomeProject).reason, 'project-config-present');
  const biomeFixed = invoke(['--file', file, '--defaults', '--fix'], 0, biomeProject);
  assert.equal(biomeFixed.formatter, 'biome');
  assert.equal(biomeFixed.fixed, true);
  assert.equal(fs.readFileSync(path.join(biomeProject, file), 'utf8'), 'const x = 1;\n');
  fs.writeFileSync(path.join(biomeProject, 'review.md'), '# Review\n');
  assert.equal(invoke(['--file', 'review.md'], 2, biomeProject).reason, 'formatter-not-installed');

  run(process.execPath, [cli, 'uninstall', '--target', 'copilot', '--json'], project, env);
  assert.equal(fs.existsSync(path.join(project, launcher)), false);
  assert.equal(fs.readFileSync(target, 'utf8'), 'const x=1;\n');
}

function main() {
  const { packagePath, expectedSha256 } = parseEnvironment();
  assertDownloadedArtifact(packagePath, process.cwd());
  assertHash(hashFile(packagePath), expectedSha256);
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ecc-copilot-quality-'));
  try {
    const packageProject = path.join(root, 'packed package');
    const home = path.join(root, 'home');
    fs.mkdirSync(packageProject);
    fs.mkdirSync(home);
    const env = createLifecycleEnvironment(process.env, home);
    verifyInstalledQuality(root, installPackage(packageProject, env, packagePath), env);
    console.log('Packed Copilot manual quality gate verified');
  } finally {
    fs.rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
}

module.exports = { verifyInstalledQuality };

if (require.main === module) main();
