'use strict';

const os = require('os');
const path = require('path');

const PROJECT_HOOK_COMMAND_PREFIX = 'node .cursor/hooks/';
const USER_HOOK_COMMAND_PREFIX = 'node ./hooks/';

function resolveUserCursorHooksJsonPath(homeDir = os.homedir()) {
  return path.resolve(homeDir, '.cursor', 'hooks.json');
}

function isUserCursorHooksJsonDestination(destinationPath, homeDir = os.homedir()) {
  if (!destinationPath) {
    return false;
  }
  return path.resolve(destinationPath) === resolveUserCursorHooksJsonPath(homeDir);
}

function rewriteCursorUserHooksJson(content) {
  return String(content).split(PROJECT_HOOK_COMMAND_PREFIX).join(USER_HOOK_COMMAND_PREFIX);
}

function rewriteCursorUserHooksJsonIfNeeded(operation, content, homeDir = os.homedir()) {
  if (!isUserCursorHooksJsonDestination(operation && operation.destinationPath, homeDir)) {
    return content;
  }
  return rewriteCursorUserHooksJson(content);
}

module.exports = {
  PROJECT_HOOK_COMMAND_PREFIX,
  USER_HOOK_COMMAND_PREFIX,
  resolveUserCursorHooksJsonPath,
  isUserCursorHooksJsonDestination,
  rewriteCursorUserHooksJson,
  rewriteCursorUserHooksJsonIfNeeded,
};
