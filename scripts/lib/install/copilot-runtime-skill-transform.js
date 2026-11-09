'use strict';

const yaml = require('js-yaml');
const { getCopilotRuntimeSkill } = require('./copilot-runtime-skills');

function adaptCopilotRuntimeSkill(source, sourceRelativePath) {
  const skill = getCopilotRuntimeSkill(sourceRelativePath);
  if (!skill) return source;
  const parts = String(source || '').match(/^(---\r?\n[\s\S]*?\r?\n---(?:\r?\n|$))/);
  if (!parts) throw new Error('Copilot runtime skill is missing frontmatter.');
  const header = yaml.load(parts[1].slice(4).replace(/\r?\n---(?:\r?\n)?$/, ''));
  if (!header || typeof header !== 'object' || header.name !== skill.name) throw new Error('Copilot runtime skill identity does not match its source path.');
  const projected = { ...header, description: skill.description, metadata: {
    ...(header.metadata && typeof header.metadata === 'object' && !Array.isArray(header.metadata) ? header.metadata : {}),
    'ecc-copilot-runtime': { source: `skills/${skill.name}/SKILL.md`, status: skill.noticeOnly ? 'notice-only' : 'partial', native: 'unverified' },
  } };
  return `---\n${yaml.dump(projected, { lineWidth: -1, noRefs: true }).trimEnd()}\n---\n\n${skill.body}`;
}

module.exports = { adaptCopilotRuntimeSkill };
