'use strict';

/**
 * Kiro adapter generator.
 *
 * Regenerates the committed `.kiro/` adapter tree from canonical ECC sources so
 * the Kiro target reaches parity with the upstream catalog and never drifts:
 *
 *   agents/*.md        -> .kiro/agents/<name>.md   (IDE) + <name>.json (CLI)
 *   skills/<id>/       -> .kiro/skills/<id>/        (SKILL.md format is identical)
 *   rules/<ns>/*.md    -> .kiro/steering/*.md       (+ injected inclusion frontmatter)
 *   mcp-configs/*.json -> .kiro/settings/mcp.json.example
 *
 * Hooks (.kiro/hooks/*.kiro.hook) and docs are curated Kiro-native templates and
 * are preserved (not regenerated), because the canonical hooks.json uses opaque
 * Claude plugin-bootstrap commands that do not translate 1:1 to Kiro's
 * askAgent/runCommand model. This mirrors the documented hook drift other
 * non-Claude adapters (e.g. Codex) already declare.
 */

const fs = require('fs');
const path = require('path');
const { parseFrontmatter } = require('../agent-compress');

// File-glob mapping for language/framework steering files. `common` rules are
// always-on (inclusion: auto); language rules load when matching files are open.
const STEERING_FILE_MATCH = Object.freeze({
  typescript: '*.ts,*.tsx',
  react: '*.jsx,*.tsx',
  python: '*.py',
  golang: '*.go',
  rust: '*.rs',
  kotlin: '*.kt,*.kts',
  java: '*.java',
  swift: '*.swift',
  cpp: '*.cpp,*.hpp,*.h,*.cc,*.cxx',
  csharp: '*.cs',
  fsharp: '*.fs,*.fsx',
  dart: '*.dart',
  perl: '*.pl,*.pm,*.t',
  php: '*.php',
  ruby: '*.rb',
  angular: '*.ts,*.html',
  web: '*.html,*.css,*.scss',
  arkts: '*.ets',
});

// Map ECC/Claude tool names to Kiro CLI allowedTools entries.
const READ_ONLY_TOOLS = new Set(['Read', 'Grep', 'Glob', 'LS', 'WebFetch', 'WebSearch']);
const WRITE_TOOLS = new Set(['Write', 'Edit', 'MultiEdit', 'NotebookEdit']);

function serializeFrontmatter(fields) {
  const lines = ['---'];
  for (const [key, value] of Object.entries(fields)) {
    if (value === undefined || value === null) continue;
    // Always double-quote string values. YAML plain scalars beginning with an
    // indicator char (e.g. `*.py`) are otherwise parsed as aliases and fail.
    const rendered = typeof value === 'string' ? JSON.stringify(value) : value;
    lines.push(`${key}: ${rendered}`);
  }
  lines.push('---');
  return lines.join('\n');
}

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function emptyDir(dir) {
  if (fs.existsSync(dir)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
  ensureDir(dir);
}

function copyDirRecursive(src, dest) {
  ensureDir(dest);
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const from = path.join(src, entry.name);
    const to = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      copyDirRecursive(from, to);
    } else if (entry.isFile()) {
      fs.copyFileSync(from, to);
    }
  }
}

/** rules/ -> .kiro/steering/ with injected inclusion frontmatter. */
function generateSteering(repoRoot, kiroRoot) {
  const rulesDir = path.join(repoRoot, 'rules');
  const steeringDir = path.join(kiroRoot, 'steering');
  emptyDir(steeringDir);
  if (!fs.existsSync(rulesDir)) return 0;

  let count = 0;
  const namespaces = fs.readdirSync(rulesDir, { withFileTypes: true })
    .filter(e => e.isDirectory())
    .map(e => e.name)
    .sort();

  for (const namespace of namespaces) {
    const nsDir = path.join(rulesDir, namespace);
    const files = fs.readdirSync(nsDir, { withFileTypes: true })
      .filter(e => e.isFile() && e.name.endsWith('.md') && e.name.toLowerCase() !== 'readme.md')
      .map(e => e.name)
      .sort();

    for (const file of files) {
      const base = path.basename(file, '.md');
      const isCommon = namespace === 'common';
      const outName = isCommon ? `${base}.md` : `${namespace}-${base}.md`;
      const body = fs.readFileSync(path.join(nsDir, file), 'utf8').replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n/, '');

      const fields = isCommon
        ? { inclusion: 'auto', description: `ECC ${base.replace(/-/g, ' ')} rules (always-on).` }
        : STEERING_FILE_MATCH[namespace]
          ? {
              inclusion: 'fileMatch',
              fileMatchPattern: STEERING_FILE_MATCH[namespace],
              description: `ECC ${namespace} guidance (loaded for matching files).`,
            }
          : { inclusion: 'manual', description: `ECC ${namespace} ${base.replace(/-/g, ' ')} guidance.` };

      const out = `${serializeFrontmatter(fields)}\n\n${body.trimStart()}`;
      fs.writeFileSync(path.join(steeringDir, outName), out);
      count += 1;
    }
  }
  return count;
}

/** skills/<id> -> .kiro/skills/<id> (SKILL.md format is identical in Kiro). */
function generateSkills(repoRoot, kiroRoot) {
  const skillsSrc = path.join(repoRoot, 'skills');
  const skillsDest = path.join(kiroRoot, 'skills');
  emptyDir(skillsDest);
  if (!fs.existsSync(skillsSrc)) return 0;

  let count = 0;
  for (const entry of fs.readdirSync(skillsSrc, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    if (!entry.isDirectory()) continue;
    const src = path.join(skillsSrc, entry.name);
    if (!fs.existsSync(path.join(src, 'SKILL.md'))) continue;
    copyDirRecursive(src, path.join(skillsDest, entry.name));
    count += 1;
  }
  return count;
}

function mapAgentTools(tools) {
  const allowed = new Set();
  const list = Array.isArray(tools) ? tools : [];
  for (const tool of list) {
    if (READ_ONLY_TOOLS.has(tool)) allowed.add('fs_read');
    else if (WRITE_TOOLS.has(tool)) allowed.add('fs_write');
    else if (tool === 'Bash') allowed.add('execute_bash');
  }
  // Default to read-only safe access if no tools were declared.
  if (allowed.size === 0) allowed.add('fs_read');
  return [...allowed];
}

/** agents/*.md -> .kiro/agents/<name>.md (IDE) + <name>.json (CLI). */
function generateAgents(repoRoot, kiroRoot) {
  const agentsSrc = path.join(repoRoot, 'agents');
  const agentsDest = path.join(kiroRoot, 'agents');
  emptyDir(agentsDest);
  if (!fs.existsSync(agentsSrc)) return 0;

  let count = 0;
  const files = fs.readdirSync(agentsSrc, { withFileTypes: true })
    .filter(e => e.isFile() && e.name.endsWith('.md'))
    .map(e => e.name)
    .sort();

  for (const file of files) {
    const raw = fs.readFileSync(path.join(agentsSrc, file), 'utf8');
    const { frontmatter, body } = parseFrontmatter(raw);
    const name = frontmatter.name || path.basename(file, '.md');

    // IDE format: copy the canonical markdown verbatim.
    fs.writeFileSync(path.join(agentsDest, `${name}.md`), raw);

    // CLI format: Kiro agent JSON.
    const json = {
      name,
      description: frontmatter.description || '',
      mcpServers: {},
      tools: ['@builtin'],
      allowedTools: mapAgentTools(frontmatter.tools),
      resources: [],
      hooks: {},
      useLegacyMcpJson: false,
      prompt: body.trim(),
    };
    fs.writeFileSync(path.join(agentsDest, `${name}.json`), `${JSON.stringify(json, null, 2)}\n`);
    count += 1;
  }
  return count;
}

/** mcp-configs/mcp-servers.json -> .kiro/settings/mcp.json.example */
function generateMcpExample(repoRoot, kiroRoot) {
  const src = path.join(repoRoot, 'mcp-configs', 'mcp-servers.json');
  const settingsDir = path.join(kiroRoot, 'settings');
  ensureDir(settingsDir);
  if (!fs.existsSync(src)) return 0;

  const parsed = JSON.parse(fs.readFileSync(src, 'utf8'));
  const servers = parsed.mcpServers || {};
  const out = { mcpServers: {} };
  for (const [name, cfg] of Object.entries(servers)) {
    out.mcpServers[name] = {
      command: cfg.command,
      args: cfg.args || [],
      ...(cfg.env ? { env: cfg.env } : {}),
      disabled: cfg.disabled ?? false,
      autoApprove: cfg.autoApprove || [],
    };
  }
  fs.writeFileSync(
    path.join(settingsDir, 'mcp.json.example'),
    `${JSON.stringify(out, null, 2)}\n`
  );
  return Object.keys(out.mcpServers).length;
}

/** Validate that every committed Kiro hook is well-formed. */
function validateHooks(kiroRoot) {
  const hooksDir = path.join(kiroRoot, 'hooks');
  if (!fs.existsSync(hooksDir)) return { count: 0, errors: [] };
  const errors = [];
  let count = 0;
  const required = ['version', 'enabled', 'name', 'description', 'when', 'then'];
  for (const file of fs.readdirSync(hooksDir)) {
    if (!file.endsWith('.kiro.hook')) continue;
    count += 1;
    try {
      const hook = JSON.parse(fs.readFileSync(path.join(hooksDir, file), 'utf8'));
      for (const key of required) {
        if (!(key in hook)) errors.push(`${file}: missing required field "${key}"`);
      }
    } catch (err) {
      errors.push(`${file}: invalid JSON (${err.message})`);
    }
  }
  return { count, errors };
}

function generateKiroAdapter(options = {}) {
  const repoRoot = options.repoRoot || process.cwd();
  const kiroRoot = options.kiroRoot || path.join(repoRoot, '.kiro');
  ensureDir(kiroRoot);

  const summary = {
    agents: generateAgents(repoRoot, kiroRoot),
    skills: generateSkills(repoRoot, kiroRoot),
    steering: generateSteering(repoRoot, kiroRoot),
    mcpServers: generateMcpExample(repoRoot, kiroRoot),
    hooks: validateHooks(kiroRoot),
  };
  return summary;
}

module.exports = {
  generateKiroAdapter,
  generateAgents,
  generateSkills,
  generateSteering,
  generateMcpExample,
  validateHooks,
  mapAgentTools,
  serializeFrontmatter,
  STEERING_FILE_MATCH,
};
