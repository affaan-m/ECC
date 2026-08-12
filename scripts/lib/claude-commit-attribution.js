'use strict';

// Claude Code appends a `Co-Authored-By` trailer to commits and PRs unless the
// user opts out, so ECC-managed installs default that off.
//
// Two settings control the trailer. `attribution: { commit, pr }` is the current
// one and wins when set; `includeCoAuthoredBy` is deprecated as of Claude Code
// 2.1.x but still honored, and is the only one older versions understand. We
// write the deprecated key because unknown keys fail settings validation, so
// writing `attribution` would break users on older Claude Code. Either key being
// present counts as a deliberate user choice that ECC must not overwrite.
const COAUTHOR_SETTING_KEY = 'includeCoAuthoredBy';

function hasExplicitCommitAttributionPreference(settings) {
  if (!settings || typeof settings !== 'object') {
    return false;
  }
  if (typeof settings[COAUTHOR_SETTING_KEY] === 'boolean') {
    return true;
  }

  const attribution = settings.attribution;
  return Boolean(attribution)
    && typeof attribution === 'object'
    && !Array.isArray(attribution)
    && (attribution.commit !== undefined || attribution.pr !== undefined);
}

function withCommitAttributionDisabled(settings) {
  if (hasExplicitCommitAttributionPreference(settings)) {
    return settings;
  }
  return {
    ...settings,
    [COAUTHOR_SETTING_KEY]: false,
  };
}

module.exports = {
  COAUTHOR_SETTING_KEY,
  hasExplicitCommitAttributionPreference,
  withCommitAttributionDisabled,
};
