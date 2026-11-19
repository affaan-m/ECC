'use strict';

/**
 * ECC -> Continue CLI (`cn`) converter.
 *
 * Pure functions that turn ECC source content (rules, skills, commands,
 * agents, contexts, MCP configs, hooks) into the formats the Continue CLI
 * actually loads. Everything here is side-effect free except the small
 * helpers at the bottom that read the repo; `scripts/install-continue.js`
 * owns all writes to the user's machine.
 *
 * What cn loads (verified against @continuedev/cli source):
 *   rules     .continue/rules/**.md + ~/.continue/rules/**.md   (always-apply only)
 *   skills    .continue/skills/<n>/SKILL.md, .claude/skills/<n>/SKILL.md,
 *             ~/.continue/skills/<n>/SKILL.md  (name + description required)
 *   prompts   config.yaml `prompts:` only (inline or `uses: file://<block>.yaml`)
 *   agents    `cn --agent <file.md>`  (frontmatter: name, description, tools, rules)
 *   subagents config.yaml `models:` with roles [subagent] + chatOptions.baseSystemMessage
 *   mcp       config.yaml `mcpServers:` only
 *   hooks     ~/.continue/settings.json, .continue/settings.json (Claude Code schema;
 *             parsed by cn 1.5.47 but not yet fired during tool calls)
 *   permissions ~/.continue/permissions.yaml (allow/ask/exclude; `--auto` overrides)
 */

const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');

const MANAGED_TAG = '# ecc-managed';
const MANAGED_KEY_TAG = '# ecc-managed-key';

/** Slash commands built into cn; ECC prompts with these names get an `ecc-` prefix. */
const CN_BUILTIN_COMMANDS = new Set([
  'help', 'clear', 'exit', 'config', 'info', 'model', 'compact', 'mcp', 'resume',
  'fork', 'title', 'rename', 'init', 'update', 'jobs', 'skills', 'import-skill',
  'sessions', 'export', 'import', 'diff', 'apply',
]);

/**
 * Claude Code tool name -> Continue CLI built-in tool name.
 * Security invariant (same as agent-tool-map.js): never map a tool to one with
 * more authority. Task/Agent are NOT mapped to Subagent because cn subagents
 * run with every tool enabled.
 */
const CLAUDE_TO_CONTINUE_TOOLS = Object.freeze({
  Read: 'Read',
  Write: 'Write',
  Edit: 'Edit',
  MultiEdit: 'MultiEdit',
  NotebookEdit: 'Edit',
  Bash: 'Bash',
  Grep: 'Search',
  Glob: 'List',
  LS: 'List',
  WebFetch: 'Fetch',
  TodoWrite: 'Checklist',
  Skill: 'Skills',
});

/** Continue CLI tool name -> Claude Code tool name (used by the hook adapter). */
const CONTINUE_TO_CLAUDE_TOOLS = Object.freeze({
  Search: 'Grep',
  List: 'Glob',
  Fetch: 'WebFetch',
  Checklist: 'TodoWrite',
  Skills: 'Skill',
  Subagent: 'Task',
});

/** Core subagents exposed when `--subagents core` is used. */
const CORE_SUBAGENTS = Object.freeze([
  'planner', 'architect', 'code-reviewer', 'security-reviewer', 'tdd-guide',
  'build-error-resolver', 'refactor-cleaner', 'doc-updater',
]);

/** Language rule directories auto-detected from project marker files. */
const LANGUAGE_MARKERS = Object.freeze([
  ['typescript', ['tsconfig.json', 'package.json']],
  ['python', ['pyproject.toml', 'requirements.txt', 'setup.py', 'Pipfile']],
  ['golang', ['go.mod']],
  ['rust', ['Cargo.toml']],
  ['java', ['pom.xml']],
  ['kotlin', ['build.gradle.kts', 'settings.gradle.kts']],
  ['dart', ['pubspec.yaml']],
  ['swift', ['Package.swift']],
  ['php', ['composer.json']],
  ['ruby', ['Gemfile']],
  ['csharp', ['global.json', 'Directory.Build.props']],
  ['cpp', ['CMakeLists.txt']],
]);

/**
 * Curated ECC hooks that work under cn. Each runs through
 * scripts/hooks/continue-hook-adapter.js, which normalizes cn payloads to the
 * Claude Code shape ECC scripts expect. Transcript-dependent hooks
 * (session summaries, cost tracking, compaction hints) are intentionally left
 * out because cn transcripts use a different format.
 */
const CONTINUE_HOOKS = Object.freeze([
  { event: 'PreToolUse', matcher: '^Bash$', mode: 'direct', script: 'scripts/hooks/pre-bash-dispatcher.js' },
  { event: 'PreToolUse', matcher: '^Write$', mode: 'run', id: 'pre:write:doc-file-warning', script: 'scripts/hooks/doc-file-warning.js', profiles: 'standard,strict' },
  { event: 'PreToolUse', matcher: '^(Edit|MultiEdit|Write)$', mode: 'run', id: 'pre:config-protection', script: 'scripts/hooks/config-protection.js', profiles: 'standard,strict' },
  { event: 'PostToolUse', matcher: '^(Edit|MultiEdit|Write)$', mode: 'run', id: 'post:edit:accumulator', script: 'scripts/hooks/post-edit-accumulator.js', profiles: 'standard,strict' },
  { event: 'PostToolUse', matcher: '^Edit$', mode: 'run', id: 'post:edit:console-warn', script: 'scripts/hooks/post-edit-console-warn.js', profiles: 'standard,strict' },
  { event: 'Stop', mode: 'run', id: 'stop:format-typecheck', script: 'scripts/hooks/stop-format-typecheck.js', profiles: 'standard,strict', timeout: 300 },
  { event: 'Stop', mode: 'run', id: 'stop:check-console-log', script: 'scripts/hooks/check-console-log.js', profiles: 'standard,strict', timeout: 30 },
]);

// ---------------------------------------------------------------------------
// Markdown / YAML helpers
// ---------------------------------------------------------------------------

/**
 * Split a markdown document into YAML frontmatter and body.
 * @param {string} text
 * @returns {{ data: Record<string, unknown>, body: string }}
 */
function parseFrontmatter(text) {
  const source = String(text).replace(/^\uFEFF/, '');
  const match = source.match(/^---\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/);
  if (!match) return { data: {}, body: source };
  let data = {};
  try {
    const parsed = yaml.load(match[1]);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) data = parsed;
  } catch {
    data = {};
  }
  return { data, body: source.slice(match[0].length) };
}

/**
 * Serialize frontmatter + body back to markdown.
 * @param {Record<string, unknown>} data
 * @param {string} body
 */
function toMarkdown(data, body) {
  const clean = Object.fromEntries(Object.entries(data).filter(([, v]) => v !== undefined && v !== null && v !== ''));
  const front = yaml.dump(clean, { lineWidth: -1, noRefs: true }).trimEnd();
  return `---\n${front}\n---\n\n${String(body).replace(/^\s+/, '')}`;
}

function dumpYaml(value) {
  return yaml.dump(value, { lineWidth: -1, noRefs: true });
}

function firstHeading(body) {
  const m = String(body).match(/^#\s+(.+)$/m);
  return m ? m[1].trim() : '';
}

function listMarkdown(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).filter(f => f.endsWith('.md') && f.toLowerCase() !== 'readme.md').sort();
}

// ---------------------------------------------------------------------------
// Rules
// ---------------------------------------------------------------------------

/**
 * The always-on rule that teaches the model how ECC's Claude Code vocabulary
 * maps onto Continue CLI. Cheap (~1.5 KB) and lets every other file stay
 * byte-identical to upstream.
 * @param {{ agentsDir: string }} opts
 */
function buildCompatRule({ agentsDir }) {
  const toolRows = Object.entries(CLAUDE_TO_CONTINUE_TOOLS)
    .filter(([claude, cn]) => claude !== cn)
    .map(([claude, cn]) => `| ${claude} | ${cn} |`)
    .join('\n');
  const body = `# ECC on Continue CLI

ECC content was written for Claude Code. When an ECC rule, skill or prompt
names a Claude Code tool or feature, use the Continue CLI equivalent below.
Read, Write, Edit, MultiEdit and Bash keep their names.

| Claude Code tool | Continue CLI tool |
|---|---|
${toolRows}
| WebSearch | A search MCP server if one is configured; otherwise say web search is unavailable |
| Task / Agent | Subagent (only if listed), otherwise see "ECC agents" |

## ECC agents

Instructions such as "delegate to the code-reviewer agent", "use
\`ecc:planner\`" or \`Agent(subagent_type: "...")\` refer to ECC agents.

1. If the Subagent tool is available and lists that agent, call it.
2. Otherwise Read \`${agentsDir}/<agent-name>.md\` (drop any \`ecc:\` prefix) and
   follow those instructions yourself, inline.

## Paths and skills

- \`~/.claude/skills/<name>\` means the Continue skill \`<name>\`: load it with the
  Skills tool rather than reading the path.
- Project working files that ECC writes under \`.claude/\` (plans, PRDs, session
  notes) are plain files; keep using those paths.
- \`$ARGUMENTS\` in an ECC prompt means the text after \`ARGUMENTS:\` at the end of
  the message.
`;
  return toMarkdown({ name: 'ECC: Continue CLI compatibility', alwaysApply: true }, body);
}

/**
 * Convert ECC rules for the requested languages.
 * @param {string} repoRoot
 * @param {string[]} langs language directory names under rules/
 * @returns {{ relPath: string, content: string }[]} paths relative to the rules dir
 */
function buildRules(repoRoot, langs) {
  const rulesRoot = path.join(repoRoot, 'rules');
  const out = [];
  for (const dir of ['common', ...langs]) {
    const abs = path.join(rulesRoot, dir);
    if (!fs.existsSync(abs)) throw new Error(`Unknown rule language "${dir}" (no rules/${dir}/)`);
    for (const file of listMarkdown(abs)) {
      const { data, body } = parseFrontmatter(fs.readFileSync(path.join(abs, file), 'utf8'));
      const title = firstHeading(body) || file.replace(/\.md$/, '');
      const front = {
        name: `ECC ${dir}: ${title}`,
        // cn only injects always-apply rules; the user opted into this language.
        alwaysApply: true,
        globs: Array.isArray(data.paths) && data.paths.length ? data.paths : undefined,
        description: data.description,
      };
      out.push({ relPath: `${dir}-${file}`, content: toMarkdown(front, body) });
    }
  }
  return out;
}

/** @returns {string[]} available language rule directories */
function listRuleLanguages(repoRoot) {
  return fs.readdirSync(path.join(repoRoot, 'rules'), { withFileTypes: true })
    .filter(e => e.isDirectory() && e.name !== 'common')
    .map(e => e.name)
    .sort();
}

/** Guess language rule sets from marker files in a project directory. */
function detectLanguages(projectDir, available) {
  const found = new Set();
  for (const [lang, markers] of LANGUAGE_MARKERS) {
    if (markers.some(m => fs.existsSync(path.join(projectDir, m)))) found.add(lang);
  }
  return [...found].filter(l => available.includes(l)).sort();
}

// ---------------------------------------------------------------------------
// Skills
// ---------------------------------------------------------------------------

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

/**
 * Resolve skill directory names for an ECC install profile (manifests/).
 * @param {string} repoRoot
 * @param {string} profile e.g. core | developer | security | research | full | all
 * @param {string[]} [extra] additional skill names
 */
function resolveSkills(repoRoot, profile, extra = []) {
  const skillsRoot = path.join(repoRoot, 'skills');
  const all = fs.readdirSync(skillsRoot, { withFileTypes: true })
    .filter(e => e.isDirectory() && fs.existsSync(path.join(skillsRoot, e.name, 'SKILL.md')))
    .map(e => e.name);
  let selected;
  if (profile === 'all') {
    selected = all;
  } else if (profile === 'none') {
    selected = [];
  } else {
    const profiles = readJson(path.join(repoRoot, 'manifests', 'install-profiles.json')).profiles;
    if (!profiles[profile]) {
      throw new Error(`Unknown skill profile "${profile}". Use one of: ${[...Object.keys(profiles), 'all', 'none'].join(', ')}`);
    }
    const modules = new Map(readJson(path.join(repoRoot, 'manifests', 'install-modules.json')).modules.map(m => [m.id, m]));
    selected = [];
    for (const id of profiles[profile].modules) {
      for (const p of (modules.get(id)?.paths || [])) {
        const m = p.match(/^skills\/([^/]+)$/);
        if (m) selected.push(m[1]);
      }
    }
  }
  for (const name of extra) {
    if (!all.includes(name)) throw new Error(`Unknown skill "${name}"`);
    selected.push(name);
  }
  return [...new Set(selected)].filter(n => all.includes(n)).sort();
}

/**
 * Validate a SKILL.md for cn (name + description must be non-empty strings).
 * Returns the content to write: unchanged when valid, or with `name` filled
 * from the directory name when missing.
 */
function convertSkill(skillName, text) {
  const { data, body } = parseFrontmatter(text);
  const description = typeof data.description === 'string' ? data.description.trim() : '';
  if (!description) throw new Error(`skills/${skillName}/SKILL.md has no description`);
  if (typeof data.name === 'string' && data.name.trim()) return text;
  return toMarkdown({ ...data, name: skillName, description }, body);
}

// ---------------------------------------------------------------------------
// Commands -> prompts
// ---------------------------------------------------------------------------

const ARGS_FOOTER = '\n\n---\nARGUMENTS (text the user typed after the slash command; may be empty): ';

function promptName(base) {
  const name = base.toLowerCase().replace(/[^a-z0-9-]/g, '-');
  return CN_BUILTIN_COMMANDS.has(name) ? `ecc-${name}` : name;
}

/**
 * Convert one ECC command (or context) into a cn prompt object.
 * cn appends the user's arguments directly after the prompt text, so every
 * prompt ends with an ARGUMENTS label and `$ARGUMENTS` references point to it.
 */
function convertCommand(fileBase, text) {
  const { data, body } = parseFrontmatter(text);
  const description = String(data.description || firstHeading(body) || fileBase).trim();
  const prompt = body
    .replace(/\$ARGUMENTS\b/g, '(the ARGUMENTS at the end of this message)')
    .trim() + ARGS_FOOTER;
  return { name: promptName(fileBase), description, prompt };
}

/** @returns {{ name: string, description: string, prompt: string }[]} */
function buildPrompts(repoRoot) {
  const prompts = [];
  for (const file of listMarkdown(path.join(repoRoot, 'commands'))) {
    const base = file.replace(/\.md$/, '');
    prompts.push(convertCommand(base, fs.readFileSync(path.join(repoRoot, 'commands', file), 'utf8')));
  }
  for (const file of listMarkdown(path.join(repoRoot, 'contexts'))) {
    const base = file.replace(/\.md$/, '');
    const p = convertCommand(`ctx-${base}`, fs.readFileSync(path.join(repoRoot, 'contexts', file), 'utf8'));
    p.description = `Switch to the ECC ${base} working context`;
    prompts.push(p);
  }
  const seen = new Set();
  for (const p of prompts) {
    if (seen.has(p.name)) throw new Error(`Duplicate prompt name "${p.name}"`);
    seen.add(p.name);
  }
  return prompts;
}

/** A standalone config block holding exactly one entry (cn only reads entry [0]). */
function blockYaml(section, name, entry) {
  return dumpYaml({ name: `ECC ${name}`, version: '1.0.0', schema: 'v1', [section]: [entry] });
}

// ---------------------------------------------------------------------------
// Agents
// ---------------------------------------------------------------------------

/** Map a Claude Code `tools:` value to a cn comma-separated tool list. */
function mapTools(tools) {
  const list = Array.isArray(tools) ? tools : String(tools || '').split(',');
  const mapped = [];
  const unsupported = [];
  for (const raw of list) {
    const name = String(raw).trim();
    if (!name) continue;
    if (Object.prototype.hasOwnProperty.call(CLAUDE_TO_CONTINUE_TOOLS, name)) {
      mapped.push(CLAUDE_TO_CONTINUE_TOOLS[name]);
    } else {
      unsupported.push(name);
    }
  }
  return { tools: [...new Set(mapped)], unsupported };
}

/**
 * Convert an ECC agent into a cn agent file. `model` is dropped because cn
 * resolves agent-file models from the Continue Hub, which would fail for
 * ECC's `sonnet`/`opus` aliases; the session's configured model is used.
 */
function convertAgent(fileBase, text) {
  const { data, body } = parseFrontmatter(text);
  const { tools, unsupported } = mapTools(data.tools);
  const front = {
    name: String(data.name || fileBase),
    description: data.description ? String(data.description) : undefined,
    tools: tools.length ? tools.join(', ') : undefined,
  };
  return { name: front.name, description: front.description || '', content: toMarkdown(front, body), unsupported };
}

/** @returns {{ file: string, name: string, description: string, content: string, unsupported: string[] }[]} */
function buildAgents(repoRoot) {
  return listMarkdown(path.join(repoRoot, 'agents')).map(file => {
    const base = file.replace(/\.md$/, '');
    return { file, ...convertAgent(base, fs.readFileSync(path.join(repoRoot, 'agents', file), 'utf8')) };
  });
}

/**
 * Subagent model entry. The system message is a short pointer to the full
 * agent file because cn embeds every subagent's baseSystemMessage in the
 * Subagent tool description on every request.
 */
function buildSubagentModel(agent, agentPath, model) {
  const entry = {
    name: agent.name,
    provider: model.provider,
    model: model.model,
    apiKey: model.apiKey,
    apiBase: model.apiBase,
    roles: ['subagent'],
    chatOptions: {
      baseSystemMessage: `${agent.description.split('\n')[0].slice(0, 280)} Before doing anything else, use the Read tool on ${agentPath} and follow those instructions exactly.`,
    },
  };
  for (const k of Object.keys(entry)) if (entry[k] === undefined) delete entry[k];
  return entry;
}

/** Parse `provider/model` (e.g. anthropic/claude-sonnet-4-6) into a model spec. */
function parseModelSpec(spec, { apiKeySecret, apiBase } = {}) {
  const m = String(spec || '').match(/^([a-z0-9_-]+)[/:](.+)$/i);
  if (!m) throw new Error(`Model must look like provider/model, got "${spec}"`);
  const provider = m[1].toLowerCase();
  const defaults = { anthropic: 'ANTHROPIC_API_KEY', openai: 'OPENAI_API_KEY', gemini: 'GEMINI_API_KEY', mistral: 'MISTRAL_API_KEY', deepseek: 'DEEPSEEK_API_KEY', openrouter: 'OPENROUTER_API_KEY' };
  const secret = apiKeySecret || defaults[provider];
  return {
    provider,
    model: m[2],
    apiKey: secret ? `\${{ secrets.${secret} }}` : undefined,
    apiBase: apiBase || undefined,
  };
}

// ---------------------------------------------------------------------------
// MCP servers
// ---------------------------------------------------------------------------

/** Convert one Claude-style MCP server entry to a cn mcpServers entry. */
function convertMcpServer(name, server) {
  const entry = { name };
  if (server.url) {
    entry.type = /\/sse\/?$/.test(server.url) || server.type === 'sse' ? 'sse' : 'streamable-http';
    entry.url = server.url;
  } else {
    entry.command = server.command;
    if (Array.isArray(server.args) && server.args.length) entry.args = server.args.map(String);
  }
  if (server.env && Object.keys(server.env).length) {
    entry.env = Object.fromEntries(Object.keys(server.env).map(k => [k, `\${{ secrets.${k} }}`]));
  }
  if (server.headers && Object.keys(server.headers).length) {
    entry.requestOptions = { headers: server.headers };
  }
  return entry;
}

/** @returns {Map<string, { entry: object, description: string }>} */
function loadMcpServers(repoRoot) {
  const servers = readJson(path.join(repoRoot, 'mcp-configs', 'mcp-servers.json')).mcpServers || {};
  return new Map(Object.entries(servers).map(([name, s]) => [name, { entry: convertMcpServer(name, s), description: s.description || '' }]));
}

// ---------------------------------------------------------------------------
// Hooks
// ---------------------------------------------------------------------------

function shellQuote(value) {
  const s = String(value);
  return /^[\w@%+=:,./\\-]+$/.test(s) ? s : `"${s.replace(/(["\\$`])/g, '\\$1')}"`;
}

/**
 * Build the `hooks` object for ~/.continue/settings.json.
 * @param {string} repoRoot absolute path of the ECC checkout the hooks run from
 * @param {string} [profile] ECC_HOOK_PROFILE default baked into each command
 */
function buildHooks(repoRoot, profile) {
  const adapter = path.join(repoRoot, 'scripts', 'hooks', 'continue-hook-adapter.js');
  const hooks = {};
  for (const h of CONTINUE_HOOKS) {
    const args = h.mode === 'direct' ? ['direct', h.script] : ['run', h.id, h.script, h.profiles];
    if (profile) args.unshift('--profile', profile);
    const handler = {
      type: 'command',
      command: ['node', adapter, ...args].map(shellQuote).join(' '),
      timeout: h.timeout || 30,
    };
    const group = { hooks: [handler] };
    if (h.matcher) group.matcher = h.matcher;
    (hooks[h.event] = hooks[h.event] || []).push(group);
  }
  return hooks;
}

function isEccHookGroup(group) {
  return Array.isArray(group?.hooks) && group.hooks.some(h => String(h?.command || '').includes('continue-hook-adapter.js'));
}

/**
 * Merge ECC hooks into an existing settings object, replacing any previous
 * ECC-managed groups and leaving everything else untouched.
 */
function mergeHookSettings(settings, eccHooks) {
  const next = { ...(settings || {}) };
  const hooks = {};
  for (const [event, groups] of Object.entries(next.hooks || {})) {
    const kept = (groups || []).filter(g => !isEccHookGroup(g));
    if (kept.length) hooks[event] = kept;
  }
  for (const [event, groups] of Object.entries(eccHooks || {})) {
    hooks[event] = [...(hooks[event] || []), ...groups];
  }
  if (Object.keys(hooks).length) next.hooks = hooks; else delete next.hooks;
  return next;
}

// ---------------------------------------------------------------------------
// permissions.yaml guardrails
// ---------------------------------------------------------------------------

/**
 * Bash patterns denied through ~/.continue/permissions.yaml. They mirror the
 * intent of ECC's block-no-verify hook (never bypass git hooks) because cn
 * does not fire hooks yet. cn applies them in normal and headless runs; the
 * `--auto` flag overrides every policy, including these.
 */
const GUARDRAIL_EXCLUDES = Object.freeze([
  'Bash(*--no-verify*)',
  'Bash(*core.hooksPath*)',
]);

/**
 * Add (or with `remove: true`, take away) ECC guardrails in a permissions.yaml.
 * @param {string} text existing file content ('' when absent)
 * @returns {string} new content
 */
function mergePermissions(text, { remove = false } = {}) {
  const parsed = String(text || '').trim() ? yaml.load(text) : {};
  if (parsed && (typeof parsed !== 'object' || Array.isArray(parsed))) {
    throw new Error('permissions.yaml must be a mapping with allow/ask/exclude lists');
  }
  const doc = { ...(parsed || {}) };
  const current = Array.isArray(doc.exclude) ? doc.exclude.filter(e => !GUARDRAIL_EXCLUDES.includes(e)) : [];
  doc.exclude = remove ? current : [...current, ...GUARDRAIL_EXCLUDES];
  if (!doc.exclude.length) delete doc.exclude;
  return Object.keys(doc).length ? dumpYaml(doc) : '';
}

// ---------------------------------------------------------------------------
// config.yaml merge (line based, preserves the user's comments and layout)
// ---------------------------------------------------------------------------

/** Remove every ECC-managed line; drop keys ECC created once they are empty. */
const ECC_BLOCK_USES = /^\s*-\s+uses:\s*["']?file:\/\/.*\/ecc\/blocks\//;

const MANAGED_SECTIONS = ['prompts', 'mcpServers', 'models'];

function stripManaged(text) {
  // Tagged lines, plus untagged ones pointing at ECC blocks (a tool that
  // rewrites config.yaml, such as cn onboarding, drops YAML comments).
  const lines = String(text).split(/\r?\n/)
    .filter(l => !l.trimEnd().endsWith(MANAGED_TAG) && !ECC_BLOCK_USES.test(l));
  const out = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const keyMatch = line.replace(/\s+#.*$/, '').match(/^([A-Za-z]+):\s*$/);
    if (keyMatch && (line.trimEnd().endsWith(MANAGED_KEY_TAG) || MANAGED_SECTIONS.includes(keyMatch[1]))) {
      let j = i + 1;
      while (j < lines.length && (lines[j].trim() === '' || lines[j].trim().startsWith('#'))) j++;
      const hasChildren = j < lines.length && /^\s+\S|^-\s/.test(lines[j]);
      if (!hasChildren) continue; // an empty key would parse as null
      out.push(line.replace(/\s*# ecc-managed-key\s*$/, ''));
      continue;
    }
    out.push(line);
  }
  return `${out.join('\n').replace(/\s+$/, '')}\n`;
}

/**
 * Find (or create) a top-level `section:` key and return its index and the
 * indentation used by its list items.
 */
function locateSection(lines, section) {
  const keyRe = new RegExp(`^${section}:\\s*(.*?)\\s*$`);
  const keyIdx = lines.findIndex(l => keyRe.test(l.replace(/\s+#.*$/, '')));
  if (keyIdx < 0) {
    if (lines.length && lines[lines.length - 1].trim() !== '') lines.push('');
    lines.push(`${section}: ${MANAGED_KEY_TAG}`);
    return { keyIdx: lines.length - 1, indent: '  ' };
  }
  const rest = lines[keyIdx].replace(/\s+#.*$/, '').match(keyRe)[1];
  if (['[]', 'null', '~'].includes(rest)) {
    lines[keyIdx] = `${section}:`;
  } else if (rest !== '') {
    throw new Error(`config.yaml uses inline/flow style for "${section}:"; convert it to a block list or add the ECC entries by hand`);
  }
  const next = lines.slice(keyIdx + 1).find(l => l.trim() !== '' && !l.trim().startsWith('#'));
  const m = next && next.match(/^(\s*)-\s/);
  return { keyIdx, indent: m ? m[1] : '  ' };
}

/** Index just after the last entry of the list that starts below `keyIdx`. */
function sectionEnd(lines, keyIdx) {
  let end = keyIdx + 1;
  while (end < lines.length && !/^[^\s#-]/.test(lines[end])) end++;
  while (end > keyIdx + 1 && (lines[end - 1].trim() === '' || /^#/.test(lines[end - 1]))) end--;
  return end;
}

/**
 * Insert `uses:` entries for each section into a config.yaml string.
 * Entries go after the user's own, so their first model stays the default.
 * @param {string} text existing config.yaml content
 * @param {Record<string, string[]>} sections e.g. { prompts: [fileUri, ...] }
 */
function mergeConfigYaml(text, sections) {
  let lines = stripManaged(text).split('\n');
  for (const [section, uris] of Object.entries(sections)) {
    if (!uris.length) continue;
    const { keyIdx, indent } = locateSection(lines, section);
    const end = sectionEnd(lines, keyIdx);
    const entries = uris.map(u => `${indent}- uses: ${JSON.stringify(u)} ${MANAGED_TAG}`);
    lines = [...lines.slice(0, end), ...entries, ...lines.slice(end)];
  }
  const merged = lines.join('\n').replace(/\n*$/, '\n');
  const parsed = yaml.load(merged);
  for (const [section, uris] of Object.entries(sections)) {
    const list = parsed?.[section];
    const ok = Array.isArray(list) && uris.every(u => list.some(i => i && i.uses === u));
    if (uris.length && !ok) throw new Error(`Merged config.yaml failed validation for "${section}"`);
  }
  return merged;
}

/** cn-style file URI (Continue builds these as `file://` + absolute path). */
function fileUri(absPath) {
  return `file://${path.resolve(absPath).replace(/\\/g, '/')}`;
}

/** Minimal starter config used only when the user has no config.yaml yet. */
function starterConfig(model) {
  return dumpYaml({
    name: 'Local Config',
    version: '1.0.0',
    schema: 'v1',
    models: [{
      name: model.model,
      provider: model.provider,
      model: model.model,
      apiKey: model.apiKey,
      apiBase: model.apiBase,
      roles: ['chat', 'edit', 'apply', 'summarize'],
    }].map(m => Object.fromEntries(Object.entries(m).filter(([, v]) => v !== undefined))),
  });
}

module.exports = {
  MANAGED_TAG,
  CN_BUILTIN_COMMANDS,
  CLAUDE_TO_CONTINUE_TOOLS,
  CONTINUE_TO_CLAUDE_TOOLS,
  CORE_SUBAGENTS,
  CONTINUE_HOOKS,
  parseFrontmatter,
  toMarkdown,
  dumpYaml,
  buildCompatRule,
  buildRules,
  listRuleLanguages,
  detectLanguages,
  resolveSkills,
  convertSkill,
  convertCommand,
  buildPrompts,
  blockYaml,
  mapTools,
  convertAgent,
  buildAgents,
  buildSubagentModel,
  parseModelSpec,
  convertMcpServer,
  loadMcpServers,
  buildHooks,
  mergeHookSettings,
  GUARDRAIL_EXCLUDES,
  mergePermissions,
  stripManaged,
  mergeConfigYaml,
  fileUri,
  starterConfig,
};
