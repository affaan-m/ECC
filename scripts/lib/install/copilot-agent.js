'use strict';

// GitHub Copilot CLI custom agents are markdown files with `name` and
// `description` frontmatter. Claude Code's agent files additionally carry
// `model`, `tools`, and `color`, none of which transfer cleanly:
//
//   model  Copilot CLI resolves the session model from user configuration and
//          plan entitlement. Carrying a Claude model id ("opus", "sonnet")
//          makes Copilot emit "specifies model ... which is not available" on
//          every invocation and silently fall back. Dropping the key selects
//          the session default with no warning.
//   tools  Claude tool names (Read, Grep, Bash, ...) are not Copilot CLI tool
//          names. Copilot governs tool access at the session level through
//          --allow-tool/--deny-tool, so carrying the Claude list would assert
//          a restriction Copilot does not actually apply.
//   color  Claude Code presentation only.
//
// The transform is therefore an allowlist rather than a denylist: unknown keys
// added to ECC agents later cannot silently leak into the Copilot copy.
const SUPPORTED_FRONTMATTER_KEYS = Object.freeze(['name', 'description']);

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

function adaptCopilotAgent(source, label = '<unknown>') {
  const { frontmatter, body } = splitFrontmatter(source, label);

  for (const key of REQUIRED_FRONTMATTER_KEYS) {
    const value = frontmatter[key];
    if (typeof value !== 'string' || value.trim() === '') {
      throw new Error(`Cannot adapt Copilot agent ${label}: missing required frontmatter "${key}"`);
    }
  }

  const adapted = {};
  for (const key of SUPPORTED_FRONTMATTER_KEYS) {
    if (Object.hasOwn(frontmatter, key)) {
      adapted[key] = frontmatter[key];
    }
  }

  const serialized = require('js-yaml')
    .dump(adapted, { lineWidth: -1, noRefs: true })
    .trimEnd();
  return `---\n${serialized}\n---\n${body}`;
}

module.exports = {
  adaptCopilotAgent,
  SUPPORTED_FRONTMATTER_KEYS,
};
