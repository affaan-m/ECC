'use strict';

const { stripPluginNamespace } = require('./plugin-namespace');
const { adaptAntigravityAgent } = require('./antigravity-agent');
const { adaptAntigravityRule } = require('./antigravity-rule');
const { adaptCopilotAgent } = require('./copilot-agent');
const { adaptCopilotRule } = require('./copilot-rule');
const { disableOpenCodeHookPluginRegistration, getDisabledOpenCodePluginContent } = require('./hook-consent');

function rewriteCopilotWorkflowPaths(content, sourceRelativePath) {
  if (!/\.md$/i.test(sourceRelativePath)) return content;
  // Commands run from the installed project root. Rewrite only the supported
  // helper entrypoint, leaving unrelated project scripts and URLs untouched.
  const isTddWorkflow = /(?:^|\/)skills\/tdd-workflow\/SKILL\.md$/i.test(sourceRelativePath.replace(/\\/g, '/'));
  let projectedDetector = false;
  let projected = content.replace(/(^[ \t]*```bash\r?\n)([\s\S]*?)(^[ \t]*```)/gm,
    (block, opening, body, closing) => {
      if (!isTddWorkflow || !/^\s*ECC_ROOT=/m.test(body)
        || !/^\s*node "\$ECC_ROOT\/scripts\/setup-package-manager\.js" --detect\s*$/m.test(body)) {
        return block;
      }
      projectedDetector = true;
      const indent = opening.match(/^[ \t]*/)[0];
      const newline = opening.endsWith('\r\n') ? '\r\n' : '\n';
      return `${opening}${indent}node .github/ecc/scripts/setup-package-manager.js --detect${newline}${closing}`;
    });
  if (projectedDetector) {
    projected = projected.replace(/^([ \t]*)The resolution lines (?:locate|use)[^\r\n]*$/gm,
      '$1This Copilot projection runs the detector from the managed .github/ecc/scripts/ closure in the project root. It preserves the project working directory and does not use Claude plugin or home-directory resolution.');
  }
  return projected.replace(/(^|[\s`"'(])scripts\/setup-package-manager\.js\b/g,
    '$1.github/ecc/scripts/setup-package-manager.js');
}

function formatJson(value) {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function parseTransformObject(content, sourceRelativePath) {
  const parsed = JSON.parse(content);
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error(`Invalid JSON object for install transform: ${sourceRelativePath}`);
  }
  return parsed;
}

function transformTextReplace(contract, content) {
  if (typeof contract.search !== 'string' || !contract.search
    || typeof contract.replace !== 'string') {
    throw new Error('Invalid text-replace install content transform contract');
  }
  return content.split(contract.search).join(contract.replace);
}

function transformJsonSet(contract, content, sourceRelativePath) {
  const values = contract.values;
  if (!values || typeof values !== 'object' || Array.isArray(values)) {
    throw new Error('Invalid json-set install content transform contract');
  }
  return formatJson({ ...parseTransformObject(content, sourceRelativePath), ...values });
}

function replaceObjectAtPath(value, objectPath, replacement, index = 0) {
  const key = objectPath[index];
  return index === objectPath.length - 1
    ? { ...value, [key]: replacement }
    : { ...value, [key]: replaceObjectAtPath(value[key], objectPath, replacement, index + 1) };
}

function transformJsonFilterObjectKeys(contract, content, sourceRelativePath) {
  if (!Array.isArray(contract.path) || contract.path.length === 0
    || !contract.path.every(key => typeof key === 'string' && key)
    || !Array.isArray(contract.keys) || !contract.keys.every(key => typeof key === 'string')) {
    throw new Error('Invalid json-filter-object-keys install content transform contract');
  }
  const parsed = parseTransformObject(content, sourceRelativePath);
  let selected = parsed;
  for (const key of contract.path) {
    if (!selected || typeof selected !== 'object' || Array.isArray(selected)
      || !Object.hasOwn(selected, key)) {
      throw new Error(`Invalid JSON object path for install transform: ${sourceRelativePath}`);
    }
    selected = selected[key];
  }
  if (!selected || typeof selected !== 'object' || Array.isArray(selected)) {
    throw new Error(`Invalid JSON object path for install transform: ${sourceRelativePath}`);
  }
  const allowed = new Set(contract.keys);
  const filtered = Object.fromEntries(Object.entries(selected).filter(([key]) => allowed.has(key)));
  return formatJson(replaceObjectAtPath(parsed, contract.path, filtered));
}

function transformByContract(contract, content, sourceRelativePath) {
  if (!contract || typeof contract !== 'object' || Array.isArray(contract)) {
    throw new Error('Invalid install content transform contract');
  }
  const handlers = {
    'text-replace': transformTextReplace,
    'json-set': transformJsonSet,
    'json-filter-object-keys': transformJsonFilterObjectKeys,
  };
  const handler = handlers[contract.type];
  if (!handler) throw new Error(`Unknown install content transform contract: ${contract.type}`);
  return handler(contract, content, sourceRelativePath);
}

function transformInstallContent(operation, content) {
  if (!operation.contentTransform) {
    return content;
  }
  if (typeof operation.contentTransform === 'object') {
    return transformByContract(operation.contentTransform, content, operation.sourceRelativePath);
  }
  if (operation.contentTransform === 'claude-manual-plugin-namespace') {
    return stripPluginNamespace(content);
  }
  if (operation.contentTransform === 'qwen-agent-frontmatter') {
    return require('../../qwen-adapt-agents').adaptFrontmatter(content).text;
  }
  if (operation.contentTransform === 'antigravity-agent-frontmatter') {
    return adaptAntigravityAgent(content, operation.sourceRelativePath);
  }
  if (operation.contentTransform === 'antigravity-rule-frontmatter') {
    return adaptAntigravityRule(content, operation.sourceRelativePath);
  }
  if (operation.contentTransform === 'copilot-agent-frontmatter') {
    return rewriteCopilotWorkflowPaths(adaptCopilotAgent(content, operation.sourceRelativePath), operation.sourceRelativePath);
  }
  if (operation.contentTransform === 'copilot-workflow-paths') {
    return rewriteCopilotWorkflowPaths(content, operation.sourceRelativePath);
  }
  if (operation.contentTransform === 'copilot-rule-frontmatter') {
    return adaptCopilotRule(content, operation.sourceRelativePath);
  }
  if (operation.contentTransform === 'opencode-disable-ecc-hooks') {
    return transformInstallContent({ ...operation, contentTransform: 'opencode-home-skills-path' },
      disableOpenCodeHookPluginRegistration(content, operation.sourceRelativePath));
  }
  if (operation.contentTransform === 'opencode-disable-plugin-entrypoint') {
    return getDisabledOpenCodePluginContent();
  }
  if (operation.contentTransform === 'opencode-home-skills-path') {
    const config = JSON.parse(content);
    if (!Array.isArray(config?.skills?.paths) || !config.skills.paths.includes('../skills')) {
      return content;
    }
    const installedConfig = {
      ...config,
      skills: {
        ...config.skills,
        paths: config.skills.paths.map(skillPath => skillPath === '../skills' ? './skills' : skillPath),
      },
    };
    return `${JSON.stringify(installedConfig, null, 2)}\n`;
  }
  throw new Error(`Unknown install content transform: ${operation.contentTransform}`);
}

module.exports = { transformInstallContent };
