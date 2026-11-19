#!/usr/bin/env node
'use strict';

/**
 * Install ECC into the Continue CLI (`cn`).
 *
 *   node scripts/install-continue.js                    # global install, core skills
 *   node scripts/install-continue.js --langs python,typescript --skills developer
 *   node scripts/install-continue.js --scope project --project ~/code/app
 *   node scripts/install-continue.js --mcp github,context7
 *   node scripts/install-continue.js --subagents core --subagent-model anthropic/claude-sonnet-4-6
 *   node scripts/install-continue.js --uninstall
 *
 * See CONTINUE-CLI.md for the full guide.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const lib = require('./lib/continue-cli');

const REPO_ROOT = path.resolve(__dirname, '..');
const DEFAULT_MODEL = 'anthropic/claude-sonnet-4-6';

const HELP = `ECC -> Continue CLI installer

Usage: node scripts/install-continue.js [options]

Where things go
  --scope <global|project>   global: ~/.continue (default). project: <dir>/.continue
                             (rules, skills, agents, hooks). Slash commands, MCP and
                             subagents always go in the global config.yaml.
  --project <dir>            Project directory for --scope project (default: cwd)
  --continue-home <dir>      Override ~/.continue (also honours CONTINUE_GLOBAL_DIR)

What to install
  --langs <list|auto|none>   Language rule packs, e.g. python,typescript
                             (default: auto for project scope, none for global)
  --skills <profile>         core | developer | security | research | full | all | none
                             (default: core)
  --add-skills <list>        Extra skills on top of the profile
  --mcp <list|none>          MCP servers from mcp-configs/ to add (default: none)
  --subagents <core|all|list|none>
                             Expose ECC agents to cn's Subagent tool (default: none)
  --subagent-model <p/model> Model for subagents, e.g. anthropic/claude-sonnet-4-6
  --api-key-secret <NAME>    Secret/env var for subagent API key (default per provider)
  --api-base <url>           apiBase for subagent models (Ollama, LM Studio, proxies)
  --model <p/model>          Model for a NEW config.yaml only (default: ${DEFAULT_MODEL})
  --no-guardrails            Do not add ECC's git-hook-bypass denials to permissions.yaml
  --hooks                    Also write ECC hooks to settings.json (cn 1.5.x loads but
                             does not fire hooks yet; this is forward-compatible)
  --hook-profile <p>         minimal | standard | strict (default: standard)
  --no-prompts --no-agents --no-rules
  --no-config                Do not edit config.yaml; print the lines to add instead

Other
  --list                     Show languages, skill profiles and MCP servers
  --dry-run                  Show what would change without writing
  --force                    Overwrite skills that exist but were not installed by ECC
  --uninstall                Remove everything this installer added
  -h, --help
`;

const VALUE_FLAGS = {
  '--scope': (o, v) => { o.scope = v; },
  '--project': (o, v) => { o.project = path.resolve(expandHome(v)); },
  '--continue-home': (o, v) => { o.continueHome = path.resolve(expandHome(v)); },
  '--langs': (o, v) => { o.langs = v; },
  '--skills': (o, v) => { o.skills = v; },
  '--add-skills': (o, v) => { o.addSkills = splitList(v); },
  '--mcp': (o, v) => { o.mcp = v === 'none' ? [] : splitList(v); },
  '--subagents': (o, v) => { o.subagents = v; },
  '--subagent-model': (o, v) => { o.subagentModel = v; },
  '--api-key-secret': (o, v) => { o.apiKeySecret = v; },
  '--api-base': (o, v) => { o.apiBase = v; },
  '--model': (o, v) => { o.model = v; },
  '--hook-profile': (o, v) => { o.hookProfile = v; },
};

const BOOLEAN_FLAGS = {
  '--hooks': ['hooks', true],
  '--no-hooks': ['hooks', false],
  '--no-guardrails': ['guardrails', false],
  '--no-prompts': ['prompts', false],
  '--no-agents': ['agents', false],
  '--no-rules': ['rules', false],
  '--no-config': ['config', false],
  '--list': ['list', true],
  '--dry-run': ['dryRun', true],
  '--force': ['force', true],
  '--uninstall': ['uninstall', true],
  '--help': ['help', true],
  '-h': ['help', true],
};

function splitList(v) {
  return String(v || '').split(',').map(s => s.trim()).filter(Boolean);
}

function parseArgs(argv) {
  const opts = {
    scope: 'global', project: process.cwd(), langs: undefined, skills: 'core', addSkills: [],
    mcp: [], subagents: 'none', subagentModel: undefined, apiKeySecret: undefined, apiBase: undefined,
    model: DEFAULT_MODEL, hookProfile: undefined, hooks: false, guardrails: true, prompts: true,
    agents: true, rules: true, config: true, list: false, dryRun: false, force: false,
    uninstall: false, help: false, continueHome: undefined,
  };
  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i];
    if (BOOLEAN_FLAGS[flag]) {
      const [key, value] = BOOLEAN_FLAGS[flag];
      opts[key] = value;
    } else if (VALUE_FLAGS[flag]) {
      const value = argv[++i];
      if (value === undefined || value.startsWith('--')) throw new Error(`${flag} needs a value`);
      VALUE_FLAGS[flag](opts, value);
    } else {
      throw new Error(`Unknown option ${flag} (see --help)`);
    }
  }
  return opts;
}

/**
 * Check every option before anything is written, so a typo never leaves a
 * half-finished install behind.
 */
function validateOptions(opts) {
  if (!['global', 'project'].includes(opts.scope)) throw new Error('--scope must be global or project');
  if (opts.hookProfile && !['minimal', 'standard', 'strict'].includes(opts.hookProfile)) {
    throw new Error('--hook-profile must be minimal, standard or strict');
  }
  if (opts.uninstall) return;
  if (opts.scope === 'project' && (opts.mcp.length || opts.subagents !== 'none')) {
    throw new Error('--mcp and --subagents live in the global config; run them with --scope global');
  }
  const servers = lib.loadMcpServers(REPO_ROOT);
  for (const name of opts.mcp) {
    if (!servers.has(name)) throw new Error(`Unknown MCP server "${name}" (see --list)`);
  }
  if (opts.subagents !== 'none') {
    if (!opts.subagentModel) throw new Error('--subagents needs --subagent-model provider/model');
    lib.parseModelSpec(opts.subagentModel);
    if (!opts.agents) throw new Error('--subagents needs the agent files; drop --no-agents');
    const known = new Set(lib.buildAgents(REPO_ROOT).map(a => a.name));
    for (const name of resolveSubagentNames(opts, [...known])) {
      if (!known.has(name)) throw new Error(`Unknown agent "${name}"`);
    }
  }
  lib.parseModelSpec(opts.model);
  lib.resolveSkills(REPO_ROOT, opts.skills, opts.addSkills);
  const langs = resolveLangs(opts);
  const available = lib.listRuleLanguages(REPO_ROOT);
  for (const l of langs) if (!available.includes(l)) throw new Error(`Unknown rule language "${l}" (see --list)`);
}

function resolveSubagentNames(opts, allNames) {
  if (opts.subagents === 'all') return allNames;
  if (opts.subagents === 'core') return [...lib.CORE_SUBAGENTS];
  return splitList(opts.subagents);
}

function resolveLangs(opts) {
  if (!opts.rules) return [];
  const spec = opts.langs ?? (opts.scope === 'project' ? 'auto' : 'none');
  if (spec === 'auto') return lib.detectLanguages(opts.project, lib.listRuleLanguages(REPO_ROOT));
  return spec === 'none' ? [] : splitList(spec);
}

function expandHome(p) {
  return p === '~' ? os.homedir() : p.replace(/^~(?=[/\\])/, os.homedir());
}

function resolvePaths(opts) {
  const home = opts.continueHome || (process.env.CONTINUE_GLOBAL_DIR ? path.resolve(process.env.CONTINUE_GLOBAL_DIR) : path.join(os.homedir(), '.continue'));
  const base = opts.scope === 'project' ? path.join(opts.project, '.continue') : home;
  return {
    home,
    base,
    rules: path.join(base, 'rules', 'ecc'),
    skills: path.join(base, 'skills'),
    ecc: path.join(base, 'ecc'),
    agents: path.join(base, 'ecc', 'agents'),
    bin: path.join(base, 'ecc', 'bin'),
    manifest: path.join(base, 'ecc', 'install-manifest.json'),
    settings: path.join(base, 'settings.json'),
    permissions: path.join(home, 'permissions.yaml'),
    blocks: path.join(home, 'ecc', 'blocks'),
    promptFiles: path.join(home, 'ecc', 'prompts'),
    config: path.join(home, 'config.yaml'),
  };
}

class Writer {
  constructor(dryRun) { this.dryRun = dryRun; this.files = []; this.dirs = []; }
  file(p, content, mode) {
    this.files.push(p);
    if (this.dryRun) return;
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, content, mode ? { mode } : undefined);
  }
  copyDir(src, dest) {
    this.dirs.push(dest);
    if (this.dryRun) return;
    fs.rmSync(dest, { recursive: true, force: true });
    fs.cpSync(src, dest, { recursive: true, dereference: false, filter: s => !/(^|[/\\])(node_modules|\.git)([/\\]|$)/.test(s) });
  }
}

function readManifest(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return null; }
}

function removePath(p, dryRun) {
  if (!dryRun) fs.rmSync(p, { recursive: true, force: true });
}

function editConfig(paths, sections, opts, log) {
  const uris = Object.fromEntries(Object.entries(sections).map(([k, files]) => [k, files.map(lib.fileUri)]));
  const total = Object.values(uris).reduce((n, u) => n + u.length, 0);
  if (!opts.config) {
    log('\n--no-config: add these entries to your config.yaml yourself:');
    for (const [k, list] of Object.entries(uris)) {
      if (!list.length) continue;
      log(`${k}:`);
      for (const u of list) log(`  - uses: ${JSON.stringify(u)}`);
    }
    return null;
  }
  const exists = fs.existsSync(paths.config);
  const current = exists ? fs.readFileSync(paths.config, 'utf8') : lib.starterConfig(lib.parseModelSpec(opts.model));
  const merged = total ? lib.mergeConfigYaml(current, uris) : lib.stripManaged(current);
  if (opts.dryRun) return { created: !exists };
  if (exists && merged !== current) {
    fs.copyFileSync(paths.config, `${paths.config}.ecc-backup`);
  }
  fs.mkdirSync(path.dirname(paths.config), { recursive: true });
  fs.writeFileSync(paths.config, merged);
  const onboarding = path.join(paths.home, '.onboarding_complete');
  if (!exists && !fs.existsSync(onboarding)) {
    // A model is configured now; skip cn's first-run API key prompt, which
    // would otherwise rewrite this file.
    fs.writeFileSync(onboarding, new Date().toISOString());
  }
  return { created: !exists, onboarded: exists && fs.existsSync(onboarding) };
}

/** Write ECC hooks into settings.json, or strip old ECC hooks when `hooks` is null. */
function editSettings(paths, opts, hooks) {
  const exists = fs.existsSync(paths.settings);
  if (!exists && !hooks) return false;
  let settings = {};
  if (exists) {
    try {
      settings = JSON.parse(fs.readFileSync(paths.settings, 'utf8'));
    } catch (err) {
      if (!hooks) return false;
      throw new Error(`${paths.settings} is not valid JSON (${err.message}); fix it or rerun without --hooks`);
    }
  }
  const next = lib.mergeHookSettings(settings, hooks || {});
  if (JSON.stringify(next) === JSON.stringify(settings)) return false;
  if (!hooks && !Object.keys(next).length) {
    if (!opts.dryRun) fs.rmSync(paths.settings, { force: true });
    return true;
  }
  if (!opts.dryRun) {
    fs.mkdirSync(path.dirname(paths.settings), { recursive: true });
    fs.writeFileSync(paths.settings, `${JSON.stringify(next, null, 2)}\n`);
  }
  return true;
}

/**
 * Shell launchers: `ecc-agent <name>` -> `cn --agent <file>` and
 * `ecc-prompt <name>` -> `cn --prompt <file>`; extra args pass through to cn.
 */
function launcherScripts(dir, kind = 'agent') {
  const flag = kind === 'agent' ? '--agent' : '--prompt';
  const tool = `ecc-${kind}`;
  const sh = `#!/usr/bin/env sh
# ${tool}: run an ECC ${kind} with the Continue CLI.
#   ${tool} list
#   ${tool} <name> [cn options] ["${kind === 'agent' ? 'task' : 'arguments'}"]     e.g. add -p for headless output
DIR=${JSON.stringify(dir)}
if [ -z "$1" ] || [ "$1" = "list" ]; then
  for f in "$DIR"/*.md; do basename "$f" .md; done
  exit 0
fi
name="$1"; shift
file="$DIR/$name.md"
if [ ! -f "$file" ]; then echo "Unknown ECC ${kind}: $name (try: ${tool} list)" >&2; exit 1; fi
exec cn ${flag} "$file" "$@"
`;
  const cmd = `@echo off
rem ${tool}: run an ECC ${kind} with the Continue CLI.  ${tool} list ^| ${tool} <name> [args]
set "DIR=${dir}"
if "%~1"=="" goto list
if /I "%~1"=="list" goto list
if not exist "%DIR%\\%~1.md" (echo Unknown ECC ${kind}: %~1 1>&2 & exit /b 1)
set "FILE=%DIR%\\%~1.md"
shift
cn ${flag} "%FILE%" %1 %2 %3 %4 %5 %6 %7 %8 %9
exit /b %ERRORLEVEL%
:list
for %%f in ("%DIR%\\*.md") do @echo %%~nf
`;
  return { sh, cmd };
}

function uninstall(paths, opts, log) {
  const manifest = readManifest(paths.manifest);
  if (!manifest) {
    log(`Nothing to uninstall: no manifest at ${paths.manifest}`);
    return;
  }
  for (const p of manifest.dirs || []) removePath(p, opts.dryRun);
  removePath(paths.rules, opts.dryRun);
  removePath(paths.ecc, opts.dryRun);
  if (opts.scope === 'global') { removePath(paths.blocks, opts.dryRun); removePath(paths.promptFiles, opts.dryRun); }
  if (manifest.config && fs.existsSync(paths.config) && !opts.dryRun) {
    fs.writeFileSync(paths.config, lib.stripManaged(fs.readFileSync(paths.config, 'utf8')));
  }
  if (manifest.guardrails && fs.existsSync(paths.permissions) && !opts.dryRun) {
    const next = lib.mergePermissions(fs.readFileSync(paths.permissions, 'utf8'), { remove: true });
    if (next) fs.writeFileSync(paths.permissions, next); else fs.rmSync(paths.permissions, { force: true });
  }
  editSettings(paths, opts, null);
  for (const dir of [path.dirname(paths.rules), paths.skills]) {
    try { if (!opts.dryRun && !fs.readdirSync(dir).length) fs.rmdirSync(dir); } catch { /* not empty or absent */ }
  }
  log(`${opts.dryRun ? '[dry-run] Would remove' : 'Removed'} ECC from ${paths.base}`);
}

function printList(log) {
  const profiles = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'manifests', 'install-profiles.json'), 'utf8')).profiles;
  log('Language rule packs (--langs):');
  log(`  ${lib.listRuleLanguages(REPO_ROOT).join(', ')}`);
  log('\nSkill profiles (--skills):');
  for (const name of Object.keys(profiles)) log(`  ${name.padEnd(10)} ${lib.resolveSkills(REPO_ROOT, name).length} skills`);
  log(`  ${'all'.padEnd(10)} ${lib.resolveSkills(REPO_ROOT, 'all').length} skills`);
  log('\nMCP servers (--mcp):');
  for (const [name, { description }] of lib.loadMcpServers(REPO_ROOT)) log(`  ${name.padEnd(28)} ${description.slice(0, 70)}`);
  log(`\nCore subagents (--subagents core): ${lib.CORE_SUBAGENTS.join(', ')}`);
}

function installRules(ctx) {
  const { opts, paths, w } = ctx;
  if (!opts.rules) return;
  ctx.langs = resolveLangs(opts);
  const rules = lib.buildRules(REPO_ROOT, ctx.langs);
  removePath(paths.rules, opts.dryRun);
  w.file(path.join(paths.rules, '00-continue-compat.md'), lib.buildCompatRule({ agentsDir: paths.agents.replace(/\\/g, '/') }));
  for (const r of rules) w.file(path.join(paths.rules, r.relPath), r.content);
  const langs = ctx.langs.length ? ` + ${ctx.langs.join(', ')}` : '';
  ctx.summary.push(`rules     ${rules.length + 1} files (common${langs}) -> ${paths.rules}`);
}

function installSkills(ctx) {
  const { opts, paths, w } = ctx;
  const wanted = lib.resolveSkills(REPO_ROOT, opts.skills, opts.addSkills);
  const owned = new Set(ctx.previous.skills || []);
  for (const old of owned) {
    if (!wanted.includes(old)) removePath(path.join(paths.skills, old), opts.dryRun);
  }
  for (const name of wanted) {
    const dest = path.join(paths.skills, name);
    if (fs.existsSync(dest) && !owned.has(name) && !opts.force) {
      ctx.warnings.push(`skill "${name}" already exists at ${dest} and was not installed by ECC; skipped (use --force)`);
      continue;
    }
    const src = path.join(REPO_ROOT, 'skills', name);
    const text = fs.readFileSync(path.join(src, 'SKILL.md'), 'utf8');
    const converted = lib.convertSkill(name, text);
    w.copyDir(src, dest);
    if (converted !== text) w.file(path.join(dest, 'SKILL.md'), converted);
    ctx.skills.push(name);
  }
  ctx.summary.push(`skills    ${ctx.skills.length} (profile: ${opts.skills}) -> ${paths.skills}`);
}

function installAgents(ctx) {
  const { opts, paths, w } = ctx;
  if (!opts.agents) return;
  removePath(paths.agents, opts.dryRun);
  for (const a of ctx.agents) w.file(path.join(paths.agents, a.file), a.content);
  const { sh, cmd } = launcherScripts(paths.agents, 'agent');
  w.file(path.join(paths.bin, 'ecc-agent'), sh, 0o755);
  w.file(path.join(paths.bin, 'ecc-agent.cmd'), cmd);
  ctx.summary.push(`agents    ${ctx.agents.length} -> ${paths.agents}  (run: ${path.join(paths.bin, 'ecc-agent')} <name>)`);
}

/** Prompts: one config block each, plus plain files for `cn -p --prompt`. */
function writePrompts(ctx, sections) {
  const { opts, paths, w } = ctx;
  if (!opts.prompts) return;
  removePath(paths.promptFiles, opts.dryRun);
  for (const p of lib.buildPrompts(REPO_ROOT)) {
    const file = path.join(paths.blocks, 'prompts', `${p.name}.yaml`);
    w.file(file, lib.blockYaml('prompts', p.name, p));
    sections.prompts.push(file);
    // cn only expands /slash commands in the interactive TUI.
    w.file(path.join(paths.promptFiles, `${p.name}.md`), p.prompt);
  }
  const { sh, cmd } = launcherScripts(paths.promptFiles, 'prompt');
  w.file(path.join(paths.bin, 'ecc-prompt'), sh, 0o755);
  w.file(path.join(paths.bin, 'ecc-prompt.cmd'), cmd);
  ctx.summary.push(`prompts   ${sections.prompts.length} slash commands -> ${paths.config}`);
}

function writeMcp(ctx, sections) {
  const { opts, paths, w } = ctx;
  if (!opts.mcp.length) return;
  const servers = lib.loadMcpServers(REPO_ROOT);
  for (const name of opts.mcp) {
    const { entry } = servers.get(name);
    const file = path.join(paths.blocks, 'mcp', `${name}.yaml`);
    w.file(file, lib.blockYaml('mcpServers', name, entry));
    sections.mcpServers.push(file);
    const secrets = Object.keys(entry.env || {});
    if (secrets.length) ctx.warnings.push(`MCP "${name}" needs ${secrets.join(', ')} in your environment or ${path.join(paths.home, '.env')}`);
    if (/\/path\/to|YOUR_/.test(JSON.stringify(entry))) ctx.warnings.push(`MCP "${name}" has placeholder values; edit ${file}`);
  }
  ctx.summary.push(`mcp       ${opts.mcp.join(', ')}`);
}

function writeSubagents(ctx, sections) {
  const { opts, paths, w } = ctx;
  if (opts.subagents === 'none') return;
  const model = lib.parseModelSpec(opts.subagentModel, { apiKeySecret: opts.apiKeySecret, apiBase: opts.apiBase });
  const names = resolveSubagentNames(opts, ctx.agents.map(a => a.name));
  for (const name of names) {
    const agent = ctx.agents.find(a => a.name === name);
    const agentPath = path.join(paths.agents, agent.file).replace(/\\/g, '/');
    const file = path.join(paths.blocks, 'subagents', `${name}.yaml`);
    w.file(file, lib.blockYaml('models', name, lib.buildSubagentModel(agent, agentPath, model)));
    sections.models.push(file);
  }
  ctx.summary.push(`subagents ${names.length} (${model.provider}/${model.model}); start cn with --beta-subagent-tool`);
}

/** Prompts, MCP and subagents live in the global config.yaml only. */
function installConfig(ctx, log) {
  const { opts, paths } = ctx;
  if (opts.scope !== 'global') {
    ctx.summary.push('note      slash commands, MCP, subagents and guardrails come from a global install');
    return;
  }
  const sections = { prompts: [], mcpServers: [], models: [] };
  removePath(paths.blocks, opts.dryRun);
  writePrompts(ctx, sections);
  writeMcp(ctx, sections);
  writeSubagents(ctx, sections);
  const result = editConfig(paths, sections, opts, log);
  if (result?.created) {
    const secret = lib.parseModelSpec(opts.model).apiKey;
    const name = secret ? secret.replace(/^\$\{\{ secrets\.|\s*\}\}$/g, '') : '';
    ctx.warnings.push(`created ${paths.config} with model ${opts.model}${name ? `; set ${name} in your environment or ${path.join(paths.home, '.env')}` : ''}`);
  } else if (result && !result.onboarded) {
    ctx.warnings.push('cn has not finished first-run setup here; run `cn` once, then rerun this installer');
  }
}

function installGuardrails(ctx) {
  const { opts, paths } = ctx;
  if (!opts.guardrails || opts.scope !== 'global') return;
  const current = fs.existsSync(paths.permissions) ? fs.readFileSync(paths.permissions, 'utf8') : '';
  const next = lib.mergePermissions(current);
  if (!opts.dryRun) {
    fs.mkdirSync(path.dirname(paths.permissions), { recursive: true });
    fs.writeFileSync(paths.permissions, next);
  }
  ctx.summary.push(`guardrails ${lib.GUARDRAIL_EXCLUDES.join(', ')} -> ${paths.permissions}`);
}

function installHooks(ctx) {
  const { opts, paths } = ctx;
  if (!opts.hooks) {
    editSettings(paths, opts, null); // drop hooks from an earlier --hooks install
    return;
  }
  editSettings(paths, opts, lib.buildHooks(REPO_ROOT, opts.hookProfile));
  ctx.summary.push(`hooks     ${lib.CONTINUE_HOOKS.length} -> ${paths.settings} (cn loads these but does not fire hooks yet)`);
  if (!fs.existsSync(path.join(REPO_ROOT, 'node_modules'))) {
    ctx.warnings.push('hooks run from this checkout; run `npm install` here so hook dependencies resolve');
  }
}

function install(opts, log) {
  validateOptions(opts);
  const paths = resolvePaths(opts);
  if (opts.uninstall) return uninstall(paths, opts, log);

  const ctx = {
    opts, paths, w: new Writer(opts.dryRun), previous: readManifest(paths.manifest) || {},
    agents: lib.buildAgents(REPO_ROOT), langs: [], skills: [], warnings: [], summary: [],
  };
  installRules(ctx);
  installSkills(ctx);
  installAgents(ctx);
  installConfig(ctx, log);
  installGuardrails(ctx);
  installHooks(ctx);

  const global = opts.scope === 'global';
  const manifest = {
    version: fs.readFileSync(path.join(REPO_ROOT, 'VERSION'), 'utf8').trim(),
    installedAt: new Date().toISOString(),
    scope: opts.scope,
    eccRoot: REPO_ROOT,
    skills: ctx.skills,
    dirs: ctx.skills.map(n => path.join(paths.skills, n)),
    config: global && Boolean(opts.config),
    hooks: opts.hooks,
    guardrails: global && opts.guardrails,
    langs: ctx.langs,
  };
  ctx.w.file(paths.manifest, `${JSON.stringify(manifest, null, 2)}\n`);

  log(`${opts.dryRun ? '[dry-run] ' : ''}ECC ${manifest.version} -> Continue CLI (${opts.scope} scope)`);
  for (const line of ctx.summary) log(`  ${line}`);
  for (const warning of ctx.warnings) log(`  ! ${warning}`);
  log('\nNext: run `cn` in a project, type / to see ECC commands, /skills to list skills.');
  return { paths, manifest, files: ctx.w.files, warnings: ctx.warnings };
}

function main() {
  let opts;
  try {
    opts = parseArgs(process.argv.slice(2));
  } catch (err) {
    console.error(`Error: ${err.message}`);
    process.exit(2);
  }
  if (opts.help) { process.stdout.write(HELP); return; }
  if (opts.list) { printList(console.log); return; }
  try {
    install(opts, console.log);
  } catch (err) {
    console.error(`Error: ${err.message}`);
    process.exit(1);
  }
}

if (require.main === module) main();

module.exports = { parseArgs, validateOptions, resolvePaths, install, launcherScripts };
