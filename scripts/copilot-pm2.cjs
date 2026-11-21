#!/usr/bin/env node
'use strict';

const { createHash } = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const MAX_INPUT_BYTES = 1024 * 1024;
const CONFIG = '.github/ecc/pm2/ecosystem.config.cjs';
const SERVICE_NAME = /^[a-z][a-z0-9-]{0,47}$/;
const WINDOWS_RESERVED = /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i;
const CONTROL = /[\u0000-\u001f\u007f]/;

class PlanError extends Error {}

function existing(file) {
  try { return fs.lstatSync(file); }
  catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
}

function directory(parts, root, created) {
  let current = root;
  for (const part of parts) {
    current = path.join(current, part);
    let info = existing(current);
    if (!info && created) {
      fs.mkdirSync(current, { mode: 0o700 });
      info = fs.lstatSync(current);
      created.push({ file: current, info });
    }
    if (info?.isSymbolicLink()) throw new PlanError('Project paths must not contain symbolic links.');
    if (info && !info.isDirectory()) throw new PlanError('Project directory path is occupied by a file.');
  }
  return current;
}

function workspaceParts(value) {
  if (value === '.') return [];
  if (typeof value !== 'string' || CONTROL.test(value) || path.posix.isAbsolute(value)
    || path.win32.isAbsolute(value)) throw new PlanError('Service paths must be workspace-relative.');
  const parts = value.replace(/\\/g, '/').replace(/^\.\//, '').split('/');
  if (parts.some(part => !part || ['.', '..'].includes(part) || /[:<>"|?*]/.test(part)
    || /[. ]$/.test(part) || WINDOWS_RESERVED.test(part))) {
    throw new PlanError('Service paths must stay inside the workspace.');
  }
  return parts;
}

function serviceWorkspace(root, value) {
  const file = directory(workspaceParts(value), root);
  if (!existing(file)?.isDirectory()) throw new PlanError('Service workspace directory is unavailable.');
  return file;
}

function executable(command, cwd) {
  if (typeof command !== 'string' || command.length > 4096 || CONTROL.test(command)) {
    throw new PlanError('Select one executable for the service.');
  }
  if (/^[A-Za-z0-9_][A-Za-z0-9_.-]*$/.test(command) && !WINDOWS_RESERVED.test(command)) return command;
  let candidate;
  if (path.isAbsolute(command)) {
    candidate = command;
  } else if (command.includes('/') || command.includes('\\')) {
    const parts = workspaceParts(command);
    candidate = path.join(directory(parts.slice(0, -1), cwd), parts.at(-1));
    if (existing(candidate)?.isSymbolicLink()) throw new PlanError('A relative executable must be a regular workspace file.');
  }
  if (!candidate || !fs.existsSync(candidate) || !fs.statSync(candidate).isFile()) {
    throw new PlanError('Select one executable or path, without shell syntax.');
  }
  return fs.realpathSync(candidate);
}

function validateService(root, projectId, service) {
  if (!service || typeof service !== 'object' || Array.isArray(service)
    || typeof service.name !== 'string' || !SERVICE_NAME.test(service.name) || WINDOWS_RESERVED.test(service.name)) {
    throw new PlanError('Invalid PM2 service name.');
  }
  const cwd = serviceWorkspace(root, service.cwd === undefined ? '.' : service.cwd);
  const command = executable(service.command, cwd);
  const args = service.args === undefined ? [] : service.args;
  if (!Array.isArray(args) || args.length > 64
    || args.some(arg => typeof arg !== 'string' || arg.length > 4096 || CONTROL.test(arg))) {
    throw new PlanError('Invalid PM2 service argument list.');
  }
  return { name: service.name, appId: `ecc-${projectId}-${service.name}`, cwd, command, args };
}

function readPackage(root) {
  const file = path.join(root, 'package.json');
  const info = existing(file);
  if (!info) return {};
  if (!info.isFile() || info.isSymbolicLink() || info.size > MAX_INPUT_BYTES) {
    throw new PlanError('Project package.json must be a bounded regular file.');
  }
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function detectServices(root) {
  const pkg = readPackage(root);
  const dependencies = { ...pkg?.dependencies, ...pkg?.devDependencies };
  const frameworks = [
    ['vite', ['node_modules/vite/bin/vite.js', '--port', '5173']],
    ['next', ['node_modules/next/dist/bin/next', 'dev', '-p', '3000']],
    ['nuxt', ['node_modules/nuxt/bin/nuxt.mjs', 'dev', '--port', '3000']],
  ];
  const framework = frameworks.find(([name]) => Object.hasOwn(dependencies, name));
  if (framework) return [{ name: 'web', command: process.execPath, args: framework[1] }];
  for (const file of ['server.js', 'src/index.js', 'app.js']) {
    const parts = file.split('/');
    const parent = directory(parts.slice(0, -1), root);
    if (existing(path.join(parent, parts.at(-1)))?.isFile()) {
      return [{ name: 'api', command: process.execPath, args: [file] }];
    }
  }
  return [];
}

function pm2Command(action, id) {
  if (action === 'start') return `pm2 start ${CONFIG} --only ${id}`;
  if (action === 'logs') return `pm2 logs ${id} --nostream`;
  if (action === 'status') return `pm2 describe ${id}`;
  return `pm2 ${action} ${id}`;
}

function skill(name, description, commands) {
  return {
    path: `.github/skills/${name}/SKILL.md`,
    content: [
      '---',
      `name: ${name}`,
      `description: ${JSON.stringify(description)}`,
      'disable-model-invocation: true',
      'user-invocable: true',
      '---',
      '',
      description,
      '',
      'Run each selected line separately as an argument vector from the reviewed project root.',
      'Use an existing PM2 installation and follow the normal tool permission checks.',
      'Regenerate the plan after moving or cloning the project.',
      '',
      '```text',
      ...commands,
      '```',
      '',
    ].join('\n'),
  };
}

function plan(root, spec) {
  if (!spec || !Array.isArray(spec.services) || !spec.services.length || spec.services.length > 20) {
    throw new PlanError('Provide 1-20 detected or explicitly reviewed PM2 services.');
  }
  const projectId = createHash('sha256').update(root).digest('hex').slice(0, 20);
  const services = spec.services.map(service => validateService(root, projectId, service));
  if (new Set(services.map(service => service.name)).size !== services.length) {
    throw new PlanError('Duplicate PM2 service name.');
  }
  const apps = services.map(({ appId, cwd, command, args }) => ({
    name: appId, cwd, script: command, args, interpreter: 'none',
  }));
  const files = [{ path: CONFIG, content: `'use strict';\nmodule.exports = ${JSON.stringify({ apps }, null, 2)};\n` }];
  for (const { name, appId } of services) {
    for (const action of ['start', 'stop', 'restart']) {
      files.push(skill(`pm2-app-${name}-${action}`, `Use PM2 to ${action} the ${name} service for this project.`,
        [pm2Command(action, appId)]));
    }
  }
  for (const action of ['start', 'stop', 'restart', 'logs', 'status']) {
    files.push(skill(`pm2-project-${action}`, `Run the PM2 ${action} workflow for this project's reviewed services.`,
      services.map(service => pm2Command(action, service.appId))));
  }
  return { services, files };
}

function availableOutput(root, file, createdDirs) {
  const parts = file.path.split('/');
  const parent = directory(parts.slice(0, -1), root, createdDirs);
  const destination = path.join(parent, parts.at(-1));
  const info = existing(destination);
  if (info?.isSymbolicLink()) throw new PlanError('Output paths must not contain symbolic links.');
  if (info) throw new PlanError('An existing output prevents applying the plan. Review the collision before retrying.');
  return destination;
}

function sameFile(before, after) {
  return after && !after.isSymbolicLink() && before.dev === after.dev && before.ino === after.ino
    && before.size === after.size && before.mtimeMs === after.mtimeMs && before.ctimeMs === after.ctimeMs;
}

function assertParent(root, file) {
  const relative = path.relative(root, path.dirname(file));
  if (relative) directory(workspaceParts(relative), root);
}

function rollback(root, createdFiles, createdDirs) {
  for (const { file, info } of createdFiles.reverse()) {
    try {
      assertParent(root, file);
      if (sameFile(info, existing(file))) fs.unlinkSync(file);
    } catch { /* Keep files that changed or cannot be safely removed. */ }
  }
  for (const { file, info } of createdDirs.reverse()) {
    try {
      assertParent(root, file);
      const current = existing(file);
      if (current?.isDirectory() && current.dev === info.dev && current.ino === info.ino) fs.rmdirSync(file);
    } catch { /* Preserve directories that are no longer empty or removable. */ }
  }
}

function applyPlan(root, files) {
  for (const file of files) availableOutput(root, file);
  const createdFiles = [];
  const createdDirs = [];
  try {
    for (const file of files) {
      const destination = availableOutput(root, file, createdDirs);
      const handle = fs.openSync(destination, 'wx', 0o600);
      try { fs.writeFileSync(handle, file.content, 'utf8'); }
      finally {
        try { createdFiles.push({ file: destination, info: fs.fstatSync(handle) }); }
        finally { fs.closeSync(handle); }
      }
    }
  } catch (error) {
    rollback(root, createdFiles, createdDirs);
    throw error;
  }
}

async function readSpec() {
  let size = 0;
  const chunks = [];
  for await (const chunk of process.stdin) {
    size += chunk.length;
    if (size > MAX_INPUT_BYTES) throw new PlanError('PM2 service input exceeds 1 MiB.');
    chunks.push(chunk);
  }
  return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks, size)));
}

async function main() {
  const args = process.argv.slice(2);
  if (new Set(args).size !== args.length || args.some(flag => !['--stdin', '--apply'].includes(flag))) {
    throw new PlanError('Usage: copilot-pm2.cjs [--stdin] [--apply]');
  }
  const root = fs.realpathSync.native(process.cwd());
  const spec = args.includes('--stdin') ? await readSpec() : { services: detectServices(root) };
  const proposal = plan(root, spec);
  if (args.includes('--apply')) applyPlan(root, proposal.files);
  return { dryRun: !args.includes('--apply'), ...proposal, processesStarted: false };
}

main().then(output => {
  process.stdout.write(JSON.stringify(output) + '\n');
}).catch(error => {
  const message = error instanceof PlanError ? error.message : 'Unable to parse the service plan or create its files.';
  process.stdout.write(JSON.stringify({ error: message }) + '\n');
  process.exitCode = 1;
});
