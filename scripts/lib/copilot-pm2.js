'use strict';

const fs = require('fs');
const path = require('path');
const { workspacePath, readJson, flagArgs } = require('./copilot-runtime-tools');

function validateService(root, service) {
  if (!service || typeof service !== 'object' || !/^[a-z][a-z0-9-]{0,47}$/.test(service.name) || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/.test(service.name)) throw new Error('Invalid PM2 service name.');
  const cwd = service.cwd === undefined || service.cwd === '.' ? root : workspacePath(root, service.cwd);
  if (!fs.statSync(cwd).isDirectory()) throw new Error('PM2 service cwd must be a directory.');
  if (typeof service.command !== 'string' || !/^[a-zA-Z0-9_./\\: -]+$/.test(service.command) || (!path.isAbsolute(service.command) && /\s/.test(service.command))) throw new Error('PM2 command must be a single executable, not a shell expression.');
  const args = service.args || [];
  if (!Array.isArray(args) || args.length > 64 || args.some(arg => typeof arg !== 'string' || arg.length > 4096 || /[\0\r\n]/.test(arg))) throw new Error('Invalid PM2 argv.');
  return { name: service.name, cwd, script: service.command, args, interpreter: 'none' };
}
function detectServices(root) {
  const pkg = readJson(path.join(root, 'package.json'), {});
  const deps = { ...pkg.dependencies, ...pkg.devDependencies };
  if (deps.vite) return [{ name: 'web', cwd: '.', command: process.execPath, args: ['node_modules/vite/bin/vite.js', '--port', '5173'] }];
  if (deps.next) return [{ name: 'web', cwd: '.', command: process.execPath, args: ['node_modules/next/dist/bin/next', 'dev', '-p', '3000'] }];
  if (deps.nuxt) return [{ name: 'web', cwd: '.', command: process.execPath, args: ['node_modules/nuxt/bin/nuxt.mjs', 'dev', '--port', '3000'] }];
  for (const file of ['server.js', 'src/index.js', 'app.js']) if (fs.existsSync(path.join(root, file))) return [{ name: 'api', cwd: '.', command: process.execPath, args: [file] }];
  return [];
}
function skill(name, description, command) {
  return `---\nname: ${name}\ndescription: ${JSON.stringify(description)}\ndisable-model-invocation: true\nuser-invocable: true\n---\n${description}\n\nUse an argv tool from this project root; PM2 must already be installed. Keep normal tool permission checks.\n\n\`\`\`text\n${command}\n\`\`\`\n`;
}
function plan(root, spec) {
  if (!spec || !Array.isArray(spec.services) || !spec.services.length || spec.services.length > 20) throw new Error('Provide 1-20 detected or explicitly reviewed PM2 services.');
  const services = spec.services.map(service => validateService(root, service));
  if (new Set(services.map(service => service.name)).size !== services.length) throw new Error('Duplicate PM2 service name.');
  const config = '.github/ecc/pm2/ecosystem.config.cjs';
  const names = services.map(service => service.name);
  const projectStart = `pm2 start ${config}`;
  const files = [{ path: config, content: `'use strict';\nmodule.exports = ${JSON.stringify({ apps: services }, null, 2)};\n` }];
  for (const service of services) {
    for (const action of ['start', 'stop', 'restart']) {
      const name = `pm2-${service.name}-${action}`;
      const command = action === 'start' ? `${projectStart} --only ${service.name}` : `pm2 ${action} ${service.name}`;
      files.push({ path: `.github/skills/${name}/SKILL.md`, content: skill(name, `${action} only the ${service.name} service for this project.`, command) });
    }
  }
  files.push({ path: '.github/skills/pm2-project-start/SKILL.md', content: skill('pm2-project-start', 'Start the reviewed PM2 services for this project.', projectStart) });
  for (const action of ['stop', 'restart', 'logs', 'status']) {
    const name = `pm2-project-${action}`;
    files.push({ path: `.github/skills/${name}/SKILL.md`, content: skill(name, `${action} the reviewed PM2 project services.`, `pm2 ${action === 'status' ? 'describe' : action} ${names.join(' ')}`) });
  }
  return { services, files };
}
function generate(root, args, stdin) {
  const options = flagArgs(args, [], ['--stdin', '--apply']);
  const spec = options['--stdin'] ? JSON.parse(stdin) : { services: detectServices(root) };
  const proposal = plan(root, spec);
  if (options['--apply']) {
    const destinations = proposal.files.map(file => workspacePath(root, file.path, true));
    if (destinations.some(file => fs.existsSync(file))) throw new Error('PM2 generation preserves existing files; review and remove or rename the generated proposal before applying.');
    for (let index = 0; index < proposal.files.length; index++) {
      fs.mkdirSync(path.dirname(destinations[index]), { recursive: true });
      fs.writeFileSync(destinations[index], proposal.files[index].content, { flag: 'wx', mode: 0o600 });
    }
  }
  return { exitCode: 0, output: { dryRun: !options['--apply'], services: proposal.services.map(service => ({ ...service, command: service.script })), files: proposal.files, processesStarted: false } };
}

module.exports = { generate, detectServices, validateService, plan };
