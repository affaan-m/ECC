'use strict';

function normalizeGitHubGitOrigin(value) {
  if (typeof value !== 'string') return null;
  const normalized = value.trim().replace(/\/+$/, '').replace(/\.git$/i, '');
  const match = normalized.match(
    /^(?:https:\/\/github\.com\/|ssh:\/\/git@github\.com\/|git@github\.com:)([^/]+\/[^/]+)$/i
  );
  return match ? match[1].toLowerCase() : null;
}

module.exports = {
  normalizeGitHubGitOrigin,
};
