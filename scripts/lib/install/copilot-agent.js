'use strict';

// Explicit tool lists are mandatory in ECC projections: omission would grant
// every Copilot tool. Aliases follow GitHub's custom-agent reference (2026-11-03).
// MCP names require an operator mapping; Claude's mcp__ namespace is not native.
const SUPPORTED_FRONTMATTER_KEYS = Object.freeze(['name', 'description', 'tools', 'strict-tools-list']);
const { TOOL_ALIASES, READ_ONLY_ROLES, mappings, model } = require('./copilot-agent-policy');

function projectCopilotTools(value, name, options = {}) {
  const configured = mappings(options.toolMappings, options.verifiedTools);
  const values = typeof value === 'string' ? value.split(',').map(tool => tool.trim()) : value;
  const invalid = !Array.isArray(values) || values.some(tool => typeof tool !== 'string' || !tool.trim());
  if (invalid) return { tools: [], status: 'incompatible', reason: value === undefined ? 'missing tools declaration' : 'invalid tools declaration' };
  const unmapped = values.filter(tool => !Object.hasOwn(TOOL_ALIASES, tool.toLowerCase()) && !Object.hasOwn(configured, tool));
  if (unmapped.length) return { tools: [], status: 'incompatible', reason: 'unmapped tools require an explicit reviewed host mapping' };
  const mapped = [...new Set(values.map(tool => Object.hasOwn(TOOL_ALIASES, tool.toLowerCase()) ? TOOL_ALIASES[tool.toLowerCase()] : configured[tool]))];
  // Shell execution and delegation can both write indirectly. Reviewers get
  // only file reads/search; even an MCP/web tool may have remote side effects.
  const tools = READ_ONLY_ROLES.test(name) || READ_ONLY_ROLES.test(options.roleLabel || '')
    ? mapped.filter(tool => ['read', 'search'].includes(tool)) : mapped;
  return { tools, status: tools.length === mapped.length ? 'mapped' : 'restricted',
    reason: tools.length === mapped.length ? null : 'read-only projection removes execution, editing, delegation and remote tools' };
}

const REQUIRED_FRONTMATTER_KEYS = Object.freeze(['name', 'description']);

function splitFrontmatter(source, label) {
  const match = String(source || '').match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n/);
  if (!match) {
    throw new Error(`Cannot adapt Copilot agent ${label}: missing YAML frontmatter`);
  }

  // Keep YAML loading behind the transform boundary. Public help commands load
  // the installer graph without executing a transform, including in hermetic
  // packed-artifact checks where runtime dependencies are intentionally absent.
  const frontmatter = require('js-yaml').load(match[1]);
  if (!frontmatter || typeof frontmatter !== 'object' || Array.isArray(frontmatter)) {
    throw new Error(`Cannot adapt Copilot agent ${label}: frontmatter must be an object`);
  }

  return {
    frontmatter,
    body: source.slice(match[0].length),
  };
}

function prepareAgent(source, label, options) {
  const { frontmatter, body } = splitFrontmatter(source, label);

  for (const key of REQUIRED_FRONTMATTER_KEYS) {
    const value = frontmatter[key];
    if (typeof value !== 'string' || value.trim() === '') {
      throw new Error(`Cannot adapt Copilot agent ${label}: missing required frontmatter "${key}"`);
    }
  }

  const operatorOptions = options.operatorEnvironment
    ? require('./copilot-agent-config').loadAgentOptions(frontmatter.name, options.operatorEnvironment) : options;
  const projection = projectCopilotTools(frontmatter.tools, frontmatter.name, { ...operatorOptions, roleLabel: label });
  if (operatorOptions.model !== undefined && (!model(operatorOptions.model) || !Array.isArray(operatorOptions.verifiedModels)
    || !operatorOptions.verifiedModels.includes(operatorOptions.model))) {
    throw new Error('Copilot model override must be explicitly verified by the operator');
  }
  return { frontmatter, body, operatorOptions, projection };
}

function inspectCopilotAgent(source, label = '<unknown>', options = {}) {
  const { frontmatter, operatorOptions, projection } = prepareAgent(source, label, options);
  return { name: frontmatter.name, ...projection, model: operatorOptions.model || null,
    operatorCliVersion: operatorOptions.cliVersion || null, nativeEnforcement: 'unverified' };
}

function adaptCopilotAgent(source, label = '<unknown>', options = {}) {
  const { frontmatter, body, operatorOptions, projection } = prepareAgent(source, label, options);
  const adapted = {};
  for (const key of SUPPORTED_FRONTMATTER_KEYS) {
    if (Object.hasOwn(frontmatter, key)) {
      adapted[key] = frontmatter[key];
    }
  }

  adapted.tools = projection.tools;
  adapted['strict-tools-list'] = true;
  if (operatorOptions.model !== undefined) {
    adapted.model = operatorOptions.model;
  }
  const notice = projection.status === 'mapped' ? ''
    : `> ECC Copilot tools: ${projection.status} — ${projection.reason}. Native direct/delegated enforcement remains unverified.\n\n`;

  const serialized = require('js-yaml')
    .dump(adapted, { lineWidth: -1, noRefs: true })
    .trimEnd();
  return `---\n${serialized}\n---\n${notice}${body}`;
}

module.exports = {
  adaptCopilotAgent,
  inspectCopilotAgent,
  SUPPORTED_FRONTMATTER_KEYS,
  projectCopilotTools,
  TOOL_ALIASES,
};
