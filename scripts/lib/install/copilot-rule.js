'use strict';

// GitHub Copilot loads path-specific instructions from
// `.github/instructions/**/*.instructions.md`, where the `applyTo` frontmatter
// key carries a comma-separated glob list. ECC rules express the same scoping
// with the Claude Code convention, a YAML `paths:` list, and rules without
// frontmatter apply to every prompt. The transform maps one model onto the
// other: `paths:` becomes `applyTo:`, and a rule without `paths` becomes
// `applyTo: "**"` so it keeps applying globally.
//
// Relative Markdown links between rules are renamed to their installed
// `.instructions.md` names; links that leave the rule set (docs, README,
// external URLs) are kept as-is.
//
// The transform is an allowlist: only `paths` is read, so frontmatter keys
// added to ECC rules later cannot silently leak into the Copilot copy.

const path = require('path');

const GLOBAL_APPLY_TO = '**';

function splitFrontmatter(source, label) {
  const text = String(source || '');

  // An immediately empty block (`---\n---\n`) never reaches the YAML loader:
  // the delimiters are stripped and the rule is treated as global.
  const emptyBlock = text.match(/^---\r?\n---\r?\n/);
  if (emptyBlock) {
    return { frontmatter: {}, body: text.slice(emptyBlock[0].length) };
  }

  const match = text.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n/);
  if (!match) {
    return null;
  }

  // A whitespace-only block is empty metadata, not a YAML document.
  if (match[1].trim() === '') {
    return { frontmatter: {}, body: text.slice(match[0].length) };
  }

  // Keep YAML loading behind the transform boundary. Public help commands load
  // the installer graph without executing a transform, including in hermetic
  // packed-artifact checks where runtime dependencies are intentionally absent.
  const frontmatter = require('js-yaml').load(match[1]);
  if (!frontmatter || typeof frontmatter !== 'object' || Array.isArray(frontmatter)) {
    throw new Error(`Cannot adapt Copilot rule ${label}: frontmatter must be an object`);
  }

  return {
    frontmatter,
    body: text.slice(match[0].length),
  };
}

function serializeApplyTo(globs) {
  return require('js-yaml')
    .dump({ applyTo: globs }, { lineWidth: -1, noRefs: true })
    .trimEnd();
}

// Markdown links with a compact target (no title), e.g. [text](../a/b.md#x).
const MARKDOWN_LINK_TARGET = /(\]\()([^)\s]+)(\))/g;

// Rewrite relative links that resolve inside the installed rule set to their
// `.instructions.md` names. Everything else — links escaping `rules/`,
// absolute or external targets, anchors, `README.md` (not installed), and
// anything inside fenced code blocks (examples must stay verbatim) — is left
// unchanged.
function rewriteRuleLinks(body, label) {
  const normalizedLabel = String(label || '').replace(/\\/g, '/');
  if (!/\.md$/i.test(normalizedLabel)) {
    return body;
  }
  const sourceDir = path.posix.dirname(normalizedLabel);

  let fence = null;
  return body.split('\n').map(line => {
    const marker = line.match(/^ {0,3}(`{3,}|~{3,})(.*)\r?$/);
    if (fence) {
      if (marker && marker[1][0] === fence.character
        && marker[1].length >= fence.length && marker[2].trim() === '') {
        fence = null;
      }
      return line;
    }
    if (marker && (marker[1][0] !== '`' || !marker[2].includes('`'))) {
      fence = { character: marker[1][0], length: marker[1].length };
      return line;
    }
    return line.replace(MARKDOWN_LINK_TARGET, (link, open, target, close) => {
      const anchorIndex = target.indexOf('#');
      const targetPath = anchorIndex === -1 ? target : target.slice(0, anchorIndex);
      const anchor = anchorIndex === -1 ? '' : target.slice(anchorIndex);

      if (!/\.md$/i.test(targetPath)) {
        return link;
      }
      if (/^[a-z][a-z0-9+.-]*:/i.test(targetPath) || targetPath.startsWith('/')) {
        return link;
      }
      if (/^readme\.md$/i.test(path.posix.basename(targetPath))) {
        return link;
      }

      const resolved = path.posix.normalize(path.posix.join(sourceDir, targetPath));
      if (!resolved.startsWith('rules/')) {
        return link;
      }

      return `${open}${targetPath.replace(/\.md$/i, '.instructions.md')}${anchor}${close}`;
    });
  }).join('\n');
}

function adaptCopilotRule(source, label = '<unknown>') {
  const parsed = splitFrontmatter(source, label);

  if (!parsed) {
    return `---\napplyTo: "${GLOBAL_APPLY_TO}"\n---\n${rewriteRuleLinks(String(source || ''), label)}`;
  }

  const { frontmatter } = parsed;
  const body = rewriteRuleLinks(parsed.body, label);
  const paths = frontmatter.paths;

  if (paths === undefined) {
    return `---\napplyTo: "${GLOBAL_APPLY_TO}"\n---\n${body}`;
  }

  if (!Array.isArray(paths) || paths.length === 0 || paths.some(glob => typeof glob !== 'string' || glob.trim() === '')) {
    throw new Error(`Cannot adapt Copilot rule ${label}: "paths" must be a non-empty list of glob strings`);
  }

  return `---\n${serializeApplyTo(paths.map(glob => glob.trim()).join(','))}\n---\n${body}`;
}

module.exports = {
  adaptCopilotRule,
  GLOBAL_APPLY_TO,
};
