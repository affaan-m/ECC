#!/usr/bin/env node
/**
 * Regenerate vibe/core/ deterministically from manifests/vibe.json.
 *
 * The payload is a native Mistral Vibe plugin (Agent Plugins 1.0 format):
 *   vibe/core/plugin.json                     - Agent Plugins 1.0 manifest with
 *                                               the ai.mistral.vibe extension
 *   vibe/core/skills/<command>/SKILL.md        - command shims converted to
 *                                               user-invocable skills
 *   vibe/core/ai.mistral.vibe/agents/*.toml    - agents/*.md converted to Vibe
 *                                               subagent TOML
 *   vibe/core/ai.mistral.vibe/knowledge/       - rules/<ns> rule packs as
 *                                               knowledge folders
 *   vibe/core/ai.mistral.vibe/hooks.toml       - curated pre-tool hooks wired
 *                                               through the Vibe hook bridge
 *   vibe/core/scripts/                         - the bridge plus the require()
 *                                               closure of the curated runners
 *   vibe/core/README.md, CURATION.md           - generated overview and the
 *                                               exclusion ledger
 *
 * Canonical skills/ are NOT copied into the payload: the vibe install target
 * installs them straight from the repo, which keeps selective profiles
 * granular and avoids a duplicate 293-skill tree in the repo.
 *
 * Safety checks (build fails if violated; semantics documented in
 * manifests/vibe.json safety.semantics):
 *   - no symlinks in copied runtime sources
 *   - no absolute per-user home paths in payload text files
 *   - generated skills have frontmatter name == directory name and a
 *     non-empty description; no duplicate skill names
 *   - agent instructions never contain TOML multi-line literal delimiters
 *   - knowledge names match ^[a-z0-9][a-z0-9-]*$ with 5-300 char descriptions
 *   - hook runtime scripts resolve dependencies via relative require() or
 *     Node builtins only
 *   - command/skill name collisions must be classified in manifests/vibe.json
 *
 * Usage: node scripts/build-vibe.js [--check]
 *   --check   verify vibe/core is already up to date (exit 1 on drift)
 */

'use strict';

const fs = require('fs');
const path = require('path');
const module_ = require('module');

const ROOT = path.join(__dirname, '..');
const MANIFEST_PATH = path.join(ROOT, 'manifests', 'vibe.json');
const MANIFEST = JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf8'));
const CHECK_MODE = process.argv.includes('--check');

const PROFILE_DIR = path.join(ROOT, MANIFEST.profile.dir);
const SKILLS_SRC = path.join(ROOT, 'skills');
const COMMANDS_SRC = path.join(ROOT, 'commands');
const AGENTS_SRC = path.join(ROOT, 'agents');
const RULES_SRC = path.join(ROOT, MANIFEST.knowledge.rulesRoot);
const VERSION = fs.readFileSync(path.join(ROOT, 'VERSION'), 'utf8').trim();
const CLAUDE_PLUGIN_MANIFEST = JSON.parse(
  fs.readFileSync(path.join(ROOT, '.claude-plugin', 'plugin.json'), 'utf8')
);

const AGENT_NAME_PATTERN = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/;
const KNOWLEDGE_NAME_PATTERN = /^[a-z0-9][a-z0-9-]*$/;
const HOME_PATH_PATTERNS = [
  /\/Users\/[A-Za-z0-9_.-]+/,
  /\/home\/(?!\/)[A-Za-z0-9_.-]+/,
  /C:\\Users\\/,
];
const BUILTIN_MODULES = new Set(module_.builtinModules);

const violations = [];
function fail(message) {
  violations.push(message);
}

function prettifyName(value) {
  return String(value || '')
    .split('-')
    .filter(Boolean)
    .map(part => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

function titleizeFileName(fileName) {
  const stem = fileName.replace(/\.md$/, '');
  return prettifyName(stem);
}

function tomlEscapeString(value) {
  return String(value)
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/\r?\n/g, ' ');
}

function readRelative(relativePath) {
  return fs.readFileSync(path.join(ROOT, relativePath), 'utf8');
}

/** Parse a `key: value` frontmatter block. No nested YAML: the ECC command
 * and agent frontmatter is flat strings, validated by scripts/ci. */
function parseFrontmatter(content, label) {
  if (!content.startsWith('---\n')) {
    fail(`${label}: frontmatter block is missing`);
    return { frontmatter: {}, body: '' };
  }
  const endIndex = content.indexOf('\n---\n', 4);
  if (endIndex === -1) {
    fail(`${label}: frontmatter block is missing a closing --- delimiter`);
    return { frontmatter: {}, body: '' };
  }
  const frontmatter = {};
  const block = content.slice(4, endIndex);
  for (const line of block.split('\n')) {
    if (!line.trim()) continue;
    const separator = line.indexOf(':');
    if (separator === -1) {
      fail(`${label}: invalid frontmatter line: ${line}`);
      continue;
    }
    const key = line.slice(0, separator).trim();
    const value = line.slice(separator + 1).trim();
    if (!(key in frontmatter)) {
      frontmatter[key] = value;
    }
  }
  return { frontmatter, body: content.slice(endIndex + 5) };
}

// ---------- payload staging --------------------------------------------------
// Everything is generated into memory first so --check can diff the desired
// tree against the on-disk tree without mutating anything.

const payloadFiles = new Map(); // repo-relative-to-payload -> Buffer

function stagePayloadFile(relativePath, content) {
  const normalized = String(relativePath).replace(/\\/g, '/');
  if (payloadFiles.has(normalized)) {
    fail(`duplicate payload file: ${normalized}`);
    return;
  }
  payloadFiles.set(normalized, Buffer.isBuffer(content) ? content : Buffer.from(content, 'utf8'));
}

// ---------- plugin.json ------------------------------------------------------

function buildPluginJson(agentCount, commandSkillCount, knowledgeCount) {
  const manifest = {
    $schema: 'https://agent-plugins.org/schemas/1.0.0/plugin.schema.json',
    name: MANIFEST.profile.pluginName,
    version: VERSION,
    description: `Harness-native ECC plugin for Mistral Vibe: ${agentCount} subagents, ${commandSkillCount} user-invocable command skills, ${knowledgeCount} rule knowledge packs, and curated pre-tool hooks, generated from the canonical ECC sources.`,
    author: CLAUDE_PLUGIN_MANIFEST.author,
    homepage: CLAUDE_PLUGIN_MANIFEST.homepage,
    repository: CLAUDE_PLUGIN_MANIFEST.repository,
    license: MANIFEST.profile.license,
    keywords: MANIFEST.profile.keywords,
    extensions: {
      'ai.mistral.vibe': {
        schemaVersion: 1,
        toolNamespace: MANIFEST.profile.toolNamespace,
      },
    },
  };
  stagePayloadFile('plugin.json', `${JSON.stringify(manifest, null, 2)}\n`);
}

// ---------- commands -> skills ----------------------------------------------

const DYNAMIC_INJECTION_PATTERN = /!`/;

function mapAllowedTools(rawValue, commandName) {
  const mapping = MANIFEST.agents.toolMapping;
  const cleaned = String(rawValue || '')
    .replace(/[[\]"']/g, ' ');
  const vibeTools = [];
  for (const token of cleaned.split(',')) {
    const claudeTool = token.trim().split('(')[0].trim();
    if (!claudeTool) continue;
    const vibeTool = mapping[claudeTool];
    if (!vibeTool) {
      fail(`command ${commandName}: allowed-tools entry "${claudeTool}" has no Vibe mapping`);
      continue;
    }
    if (!vibeTools.includes(vibeTool)) {
      vibeTools.push(vibeTool);
    }
  }
  return vibeTools;
}

function buildCommandSkills() {
  const commandFiles = fs.readdirSync(COMMANDS_SRC)
    .filter(name => name.endsWith('.md'))
    .sort();
  const skillDirs = new Set(
    fs.existsSync(SKILLS_SRC)
      ? fs.readdirSync(SKILLS_SRC, { withFileTypes: true })
        .filter(entry => entry.isDirectory())
        .map(entry => entry.name)
      : []
  );
  const excluded = MANIFEST.commands.exclude;
  let converted = 0;

  for (const commandFile of commandFiles) {
    const commandName = commandFile.replace(/\.md$/, '');
    const relativePath = path.join('commands', commandFile);
    const content = readRelative(relativePath);
    const { frontmatter, body } = parseFrontmatter(content, `commands/${commandFile}`);

    const isExcluded = Object.prototype.hasOwnProperty.call(excluded, commandName);
    if (isExcluded) {
      // Exclusion reasons that claim supersession must stay honest: the
      // canonical skill has to exist.
      if (
        String(excluded[commandName]).includes('superseded by the canonical skill')
        && !skillDirs.has(commandName)
      ) {
        fail(`commands/${commandFile} is excluded as superseded by a skill, but skills/${commandName} does not exist`);
      }
      continue;
    }

    if (skillDirs.has(commandName)) {
      fail(
        `commands/${commandFile} collides with skills/${commandName}; classify it in manifests/vibe.json commands.exclude`
      );
      continue;
    }

    if (!frontmatter.description) {
      fail(`commands/${commandFile}: missing frontmatter description`);
      continue;
    }
    if (DYNAMIC_INJECTION_PATTERN.test(body)) {
      fail(
        `commands/${commandFile}: dynamic shell context injection is not supported by the Vibe skill contract; classify it in manifests/vibe.json commands.exclude`
      );
      continue;
    }

    let skillBody = body.replace(
      /\$ARGUMENTS/g,
      '(the text typed after the skill name)'
    );

    const allowedTools = mapAllowedTools(frontmatter['allowed-tools'], commandName);
    const frontmatterLines = [
      '---',
      `name: ${commandName}`,
      `description: ${frontmatter.description}`,
      'user-invocable: true',
      'metadata:',
      '  origin: ECC',
      `  source: commands/${commandFile}`,
    ];
    if (allowedTools.length > 0) {
      frontmatterLines.push(`allowed-tools: ${allowedTools.join(' ')}`);
    }
    frontmatterLines.push('---', '');

    stagePayloadFile(
      path.join('skills', commandName, 'SKILL.md'),
      `${frontmatterLines.join('\n')}\n${skillBody.trim()}\n`
    );
    converted += 1;
  }

  return { converted, excludedCount: Object.keys(excluded).length };
}

// ---------- agents -> subagent TOML ------------------------------------------

function mapAgentTools(rawValue, agentName, droppedToolsByAgent) {
  const mapping = MANIFEST.agents.toolMapping;
  const enabledTools = [];
  const dropped = [];
  for (const token of String(rawValue || '').split(',')) {
    const claudeTool = token.trim();
    if (!claudeTool) continue;
    const vibeTool = mapping[claudeTool];
    if (vibeTool) {
      if (!enabledTools.includes(vibeTool)) {
        enabledTools.push(vibeTool);
      }
    } else {
      dropped.push(claudeTool);
    }
  }
  if (dropped.length > 0) {
    droppedToolsByAgent.set(agentName, dropped);
  }
  return enabledTools;
}

/** Vibe caps subagent descriptions at 300 characters; truncate on a word
 * boundary and mark the truncation so it can be reported in CURATION.md. */
function clampAgentDescription(value, agentName, truncatedByAgent) {
  const text = String(value);
  if (text.length <= 300) {
    return text;
  }
  let cut = text.slice(0, 297);
  const lastSpace = cut.lastIndexOf(' ');
  if (lastSpace > 200) {
    cut = cut.slice(0, lastSpace);
  }
  truncatedByAgent.add(agentName);
  return `${cut.trimEnd()}...`;
}

function buildAgentToml() {
  const agentFiles = fs.readdirSync(AGENTS_SRC)
    .filter(name => name.endsWith('.md'))
    .sort();
  const droppedToolsByAgent = new Map();
  const truncatedDescriptions = new Set();

  for (const agentFile of agentFiles) {
    const agentName = agentFile.replace(/\.md$/, '');
    const label = `agents/${agentFile}`;
    if (!AGENT_NAME_PATTERN.test(agentName)) {
      fail(`${label}: name does not match the Vibe subagent file-name pattern`);
      continue;
    }

    const { frontmatter, body } = parseFrontmatter(readRelative(path.join('agents', agentFile)), label);
    if (frontmatter.name !== agentName) {
      fail(`${label}: frontmatter name "${frontmatter.name}" does not match the file name`);
      continue;
    }
    if (!frontmatter.description) {
      fail(`${label}: missing frontmatter description`);
      continue;
    }

    const instructions = body.trim();
    if (!instructions) {
      fail(`${label}: empty instructions body`);
      continue;
    }
    if (instructions.includes("'''")) {
      fail(`${label}: instructions contain a TOML multi-line literal delimiter`);
      continue;
    }

    const enabledTools = mapAgentTools(frontmatter.tools, agentName, droppedToolsByAgent);
    const needsBashLike = String(frontmatter.tools || '')
      .split(',')
      .map(token => token.trim())
      .some(tool => tool === 'Bash' || tool === 'Write' || tool === 'Edit');
    const safety = needsBashLike ? 'neutral' : 'safe';
    const description = clampAgentDescription(frontmatter.description, agentName, truncatedDescriptions);

    // The Vibe loader's agent schema is strict (extra="forbid") and expects
    // snake_case TOML keys; camelCase keys make every agent fail validation.
    const lines = [
      '# Generated by scripts/build-vibe.js from agents/ — do not edit.',
      'schema_version = 1',
      'agent_type = "subagent"',
      `display_name = "${tomlEscapeString(prettifyName(agentName))}"`,
      `description = "${tomlEscapeString(description)}"`,
      `safety = "${safety}"`,
    ];
    if (enabledTools.length > 0) {
      lines.push(`enabled_tools = [${enabledTools.map(tool => `"${tool}"`).join(', ')}]`);
    }
    lines.push('', "instructions = '''", instructions, "'''", '');

    stagePayloadFile(path.join('ai.mistral.vibe', 'agents', `${agentName}.toml`), lines.join('\n'));
  }

  return { count: agentFiles.length, droppedToolsByAgent, truncatedDescriptions };
}

// ---------- rules -> knowledge ----------------------------------------------

/** Bump every markdown heading one level down, leaving fenced code alone. */
function demoteHeadings(text) {
  let inFence = false;
  return text
    .split('\n')
    .map(line => {
      if (/^\s*(```|~~~)/.test(line)) {
        inFence = !inFence;
        return line;
      }
      if (!inFence && /^#{1,6} /.test(line)) {
        return `#${line}`;
      }
      return line;
    })
    .join('\n');
}

/**
 * Normalize one rules/<ns>/<file>.md into a knowledge section:
 * - strip the file's own YAML frontmatter block if present
 * - lift the file's leading H1 as the section title
 * - demote every remaining heading one level so the section keeps a single H1
 *   and file-internal headings are never siblings of the section titles
 */
function extractRuleSection(content, fallbackTitle) {
  let text = String(content).trim();

  if (text.startsWith('---')) {
    const frontmatterEnd = text.indexOf('\n---\n', 3);
    if (frontmatterEnd !== -1) {
      text = text.slice(frontmatterEnd + 5).trim();
    }
  }

  let title = fallbackTitle;
  if (text.startsWith('# ')) {
    const lineEnd = text.indexOf('\n');
    title = (lineEnd === -1 ? text.slice(2) : text.slice(2, lineEnd)).trim();
    text = lineEnd === -1 ? '' : text.slice(lineEnd + 1).trim();
  }

  return { title, text: demoteHeadings(text) };
}

function buildKnowledge() {
  if (!fs.existsSync(RULES_SRC)) {
    fail(`rules root not found: ${MANIFEST.knowledge.rulesRoot}`);
    return { count: 0 };
  }
  const skipFiles = new Set(MANIFEST.knowledge.skipFiles);
  const namespaces = fs.readdirSync(RULES_SRC, { withFileTypes: true })
    .filter(entry => entry.isDirectory())
    .map(entry => entry.name)
    .sort();

  for (const namespace of namespaces) {
    const name = `rules-${namespace}`;
    if (!KNOWLEDGE_NAME_PATTERN.test(name)) {
      fail(`knowledge name "${name}" is invalid`);
      continue;
    }
    const displayName = `ECC ${prettifyName(namespace)} Rules`;
    const description = `ECC ${namespace} engineering rules for coding style, patterns, security, and testing.`;
    if (description.length < 5 || description.length > 300) {
      fail(`knowledge "${name}": description must be 5-300 characters`);
      continue;
    }

    const ruleFiles = fs.readdirSync(path.join(RULES_SRC, namespace))
      .filter(fileName => fileName.endsWith('.md') && !skipFiles.has(fileName))
      .sort();
    if (ruleFiles.length === 0) {
      fail(`knowledge "${name}": rules/${namespace} has no markdown rule files`);
      continue;
    }

    const sections = [];
    for (const ruleFile of ruleFiles) {
      const raw = readRelative(path.join(MANIFEST.knowledge.rulesRoot, namespace, ruleFile));
      const { title, text } = extractRuleSection(raw, titleizeFileName(ruleFile));
      sections.push(`## ${title}\n\n${text}`);
    }

    const entry = [
      '---',
      `name: ${name}`,
      `description: ${description}`,
      `display_name: "${displayName}"`,
      `icon: ${MANIFEST.knowledge.icon}`,
      '---',
      '',
      `# ${displayName}`,
      '',
      sections.join('\n\n'),
      '',
    ].join('\n');

    stagePayloadFile(path.join('ai.mistral.vibe', 'knowledge', name, 'KNOWLEDGE.md'), entry);
  }

  return { count: namespaces.length };
}

// ---------- hooks + runtime closure -----------------------------------------

function collectRuntimeClosure(entryFiles) {
  const closure = new Map(); // repo-relative -> absolute
  const queue = [...entryFiles];

  while (queue.length > 0) {
    const relative = queue.pop();
    if (closure.has(relative)) continue;

    const absolute = path.join(ROOT, relative);
    let stat;
    try {
      stat = fs.lstatSync(absolute);
    } catch (error) {
      fail(`hook runtime file not found: ${relative} (${error.message})`);
      continue;
    }
    if (stat.isSymbolicLink()) {
      fail(`hook runtime file is a symlink: ${relative}`);
      continue;
    }
    closure.set(relative, absolute);
    if (!relative.endsWith('.js')) continue;

    const source = fs.readFileSync(absolute, 'utf8');
    const requirePattern = /require\(\s*['"]([^'"]+)['"]\s*\)/g;
    let match;
    while ((match = requirePattern.exec(source)) !== null) {
      const spec = match[1];
      if (!spec.startsWith('.')) {
        const bare = spec.replace(/^node:/, '');
        if (!BUILTIN_MODULES.has(bare)) {
          fail(`hook runtime file ${relative} requires non-relative module "${spec}"; only relative require() paths and Node builtins are portable`);
        }
        continue;
      }
      let resolved = null;
      try {
        resolved = require.resolve(spec, { paths: [path.dirname(absolute)] });
      } catch (error) {
        fail(`hook runtime file ${relative}: cannot resolve require("${spec}"): ${error.message}`);
        continue;
      }
      const relativeDependency = path.relative(ROOT, resolved);
      if (!path.isAbsolute(resolved) || relativeDependency.startsWith('..')) {
        fail(`hook runtime file ${relative}: dependency escapes the repo: ${resolved}`);
        continue;
      }
      if (!closure.has(relativeDependency)) {
        queue.push(relativeDependency);
      }
    }
  }

  return closure;
}

function buildHooks() {
  const entries = MANIFEST.hooks.include;
  const seenNames = new Set();
  const hookLines = [
    '# Generated by scripts/build-vibe.js from manifests/vibe.json — do not edit.',
    '# Hook commands run in the plugin root; vibe-hook-bridge.js translates the',
    '# Vibe hook protocol to the Claude Code protocol the ECC runners speak.',
    '',
  ];

  for (const entry of entries) {
    if (seenNames.has(entry.name)) {
      fail(`duplicate hook name: ${entry.name}`);
      continue;
    }
    seenNames.add(entry.name);
    if (!['pre_tool', 'post_tool', 'post_agent'].includes(entry.type)) {
      fail(`hook ${entry.name}: unsupported type "${entry.type}"`);
      continue;
    }
    const runner = String(entry.runner).replace(/\\/g, '/');
    hookLines.push(
      '[[hooks]]',
      `name = "${tomlEscapeString(entry.name)}"`,
      `type = "${entry.type}"`,
      `match = "${tomlEscapeString(entry.match)}"`,
      `command = "node scripts/hooks/vibe-hook-bridge.js ${runner}"`,
      `timeout = ${Number(entry.timeout).toFixed(1)}`,
      `description = "${tomlEscapeString(entry.description)}"`,
      ''
    );
  }

  stagePayloadFile(path.join('ai.mistral.vibe', 'hooks.toml'), hookLines.join('\n'));

  const runtimeEntries = [
    path.join('scripts', 'hooks', 'vibe-hook-bridge.js'),
    ...entries.map(entry => String(entry.runner).replace(/\\/g, '/')),
  ];
  const closure = collectRuntimeClosure(runtimeEntries);
  for (const [relative] of closure) {
    stagePayloadFile(relative, fs.readFileSync(path.join(ROOT, relative)));
  }

  return { hooks: entries.length, runtimeFiles: closure.size };
}

// ---------- README + CURATION ----------------------------------------------

function buildDocs(commandStats, agentStats, knowledgeStats, hookStats) {
  const manifestDir = MANIFEST.profile.dir;
  stagePayloadFile('README.md', [
    `# ECC for Mistral Vibe (${manifestDir})`,
    '',
    `Native Agent Plugins 1.0 payload for Mistral Vibe, generated by \`scripts/build-vibe.js\` from the canonical ECC sources. Version ${VERSION}.`,
    '',
    '## Layout',
    '',
    '- `plugin.json` — Agent Plugins 1.0 manifest with the `ai.mistral.vibe` extension',
    `- \`skills/\` — ${commandStats.converted} command shims converted to user-invocable skills (invoke with \`/<name>\`)`,
    `- \`ai.mistral.vibe/agents/\` — ${agentStats.count} subagents converted from \`agents/\``,
    `- \`ai.mistral.vibe/knowledge/\` — ${knowledgeStats.count} rule packs converted from \`rules/\``,
    `- \`ai.mistral.vibe/hooks.toml\` — ${hookStats.hooks} curated pre-tool hooks (${hookStats.runtimeFiles} runtime files) bridged to the shared ECC hook runners`,
    '',
    'Canonical `skills/` are installed directly from the ECC repository by the vibe install target, so selective install profiles stay granular.',
    '',
    '## Install',
    '',
    '```bash',
    './install.sh --target vibe --profile developer',
    '```',
    '',
    'The payload is copied to `~/.vibe/plugins/ecc/` and picked up by Vibe on the next session start (`/plugins` lists it).',
    '',
    '## Regenerate',
    '',
    '```bash',
    'node scripts/build-vibe.js',
    '```',
    '',
    'See `CURATION.md` for every excluded component and the reason.',
    '',
  ].join('\n'));

  const excludedCommandRows = Object.entries(MANIFEST.commands.exclude)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([name, reason]) => `| \`${name}\` | ${reason} |`)
    .join('\n');
  const droppedToolRows = [...agentStats.droppedToolsByAgent.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([name, tools]) => `| \`${name}\` | ${tools.join(', ')} |`)
    .join('\n');
  const excludedHookRows = MANIFEST.hooks.exclude
    .map(entry => `| ${entry.surface} | ${entry.reason} |`)
    .join('\n');

  const truncatedRows = [...(agentStats.truncatedDescriptions || [])]
    .sort((left, right) => left.localeCompare(right))
    .map(name => `| \`${name}\` | description truncated to the Vibe 300-character subagent limit |`)
    .join('\n');

  stagePayloadFile('CURATION.md', [
    '# Vibe payload curation ledger',
    '',
    'Every component excluded from the Vibe payload, with the reason. Generated by `scripts/build-vibe.js`.',
    '',
    '## Excluded commands',
    '',
    '| Command | Reason |',
    '| --- | --- |',
    excludedCommandRows,
    '',
    '## Dropped agent tool grants',
    '',
    MANIFEST.agents.droppedTools.map(note => `- ${note}`).join('\n'),
    '',
    '| Agent | Dropped Claude Code tools |',
    '| --- | --- |',
    droppedToolRows || '| (none) | |',
    '',
    `## Dropped agent model field`,
    '',
    `- ${MANIFEST.agents.droppedModel}`,
    '',
    '## Truncated agent descriptions',
    '',
    '| Agent | Reason |',
    '| --- | --- |',
    truncatedRows || '| (none) | |',
    '',
    '## Excluded hook surfaces',
    '',
    '| Surface | Reason |',
    '| --- | --- |',
    excludedHookRows,
    '',
    '## Argument substitution',
    '',
    '`$ARGUMENTS` placeholders in command bodies are rewritten to "(the text typed after the skill name)" because Vibe passes the text typed after the skill name as part of the user turn.',
    '',
  ].filter(line => line !== undefined).join('\n'));
}

// ---------- safety scan ------------------------------------------------------

function runSafetyScan() {
  for (const [relative, buffer] of payloadFiles) {
    if (relative.endsWith('.toml') || relative.endsWith('.json')
      || relative.endsWith('.md') || relative.endsWith('.js')) {
      const allowlisted = MANIFEST.safety.scanAllowlist
        .filter(entry => entry.path === relative)
        .map(entry => new RegExp(entry.pattern));
      const text = buffer.toString('utf8');
      for (const pattern of HOME_PATH_PATTERNS) {
        const match = text.match(pattern);
        if (!match) continue;
        if (allowlisted.some(exception => exception.test(match[0]))) {
          continue;
        }
        fail(`${relative}: absolute home path "${match[0]}" is not allowed in the payload`);
      }
    }
  }

  const generatedSkills = [...payloadFiles.keys()]
    .filter(relative => /^skills\/[^/]+\/SKILL\.md$/.test(relative))
    .map(relative => relative.split('/')[1]);
  const seen = new Set();
  for (const skillName of generatedSkills) {
    if (seen.has(skillName)) {
      fail(`duplicate generated skill name: ${skillName}`);
    }
    seen.add(skillName);
  }
}

// ---------- write / check ----------------------------------------------------

function listTreeFiles(dir) {
  if (!fs.existsSync(dir)) return [];
  const files = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    const absolute = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...listTreeFiles(absolute).map(nested => `${entry.name}/${nested}`));
    } else {
      files.push(entry.name);
    }
  }
  return files;
}

function applyOrCheck() {
  const desired = new Map(payloadFiles);
  const onDisk = new Set(listTreeFiles(PROFILE_DIR));
  const drift = [];

  for (const relative of onDisk) {
    if (!desired.has(relative)) {
      drift.push(`unexpected file: ${relative}`);
    }
  }
  for (const [relative, buffer] of desired) {
    const absolute = path.join(PROFILE_DIR, relative);
    let current = null;
    try {
      current = fs.readFileSync(absolute);
    } catch {
      drift.push(`missing file: ${relative}`);
      continue;
    }
    if (!current.equals(buffer)) {
      drift.push(`outdated file: ${relative}`);
    }
  }

  if (CHECK_MODE) {
    if (drift.length > 0) {
      for (const entry of drift) {
        console.error(`drift: ${entry}`);
      }
      fail(`${MANIFEST.profile.dir} is not up to date; run node scripts/build-vibe.js`);
    }
    return;
  }

  fs.rmSync(PROFILE_DIR, { recursive: true, force: true });
  for (const [relative, buffer] of [...desired.entries()].sort(([left], [right]) => left.localeCompare(right))) {
    const absolute = path.join(PROFILE_DIR, relative);
    fs.mkdirSync(path.dirname(absolute), { recursive: true });
    fs.writeFileSync(absolute, buffer);
  }
}

// ---------- main ------------------------------------------------------------

function main() {
  const commandStats = buildCommandSkills();
  const agentStats = buildAgentToml();
  const knowledgeStats = buildKnowledge();
  const hookStats = buildHooks();

  buildPluginJson(agentStats.count, commandStats.converted, knowledgeStats.count);
  buildDocs(commandStats, agentStats, knowledgeStats, hookStats);
  runSafetyScan();

  if (violations.length > 0) {
    for (const violation of violations) {
      console.error(`ERROR: ${violation}`);
    }
    process.exit(1);
  }

  applyOrCheck();

  if (violations.length > 0) {
    for (const violation of violations) {
      console.error(`ERROR: ${violation}`);
    }
    process.exit(1);
  }

  console.log(
    `vibe/core: ${payloadFiles.size} files — ${commandStats.converted} command skills, `
    + `${agentStats.count} agents, ${knowledgeStats.count} knowledge packs, `
    + `${hookStats.hooks} hooks (${hookStats.runtimeFiles} runtime files) — ${MANIFEST.profile.dir}`
  );
}

main();
