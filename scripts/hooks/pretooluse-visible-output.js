#!/usr/bin/env node
'use strict';

function normalizeAdditionalContext(value) {
  if (Array.isArray(value)) {
    return value
      .map(item => String(item || '').trim())
      .filter(Boolean)
      .join('\n');
  }

  return String(value || '').trim();
}

function combineAdditionalContext(current, next) {
  const currentText = normalizeAdditionalContext(current);
  const nextText = normalizeAdditionalContext(next);

  if (!currentText) return nextText;
  if (!nextText) return currentText;

  return `${currentText}\n${nextText}`;
}

function buildPreToolUseAdditionalContext(value) {
  const additionalContext = normalizeAdditionalContext(value);
  if (!additionalContext) return '';

  return JSON.stringify({
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      additionalContext,
    },
  });
}

/**
 * Translate Claude Code PreToolUse stdout into Cursor preToolUse JSON.
 * Cursor expects { permission, user_message?, agent_message?, updated_input? }.
 */
function adaptPreToolUseStdoutForCursor(stdout, options = {}) {
  if (!options.isCursorRuntime) {
    return typeof stdout === 'string' ? stdout : '';
  }

  const text = typeof stdout === 'string' ? stdout.trim() : '';
  if (!text) {
    return '';
  }

  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    return '';
  }

  if (parsed && typeof parsed === 'object' && parsed.permission) {
    return text;
  }

  const hookOutput = parsed && parsed.hookSpecificOutput;
  if (hookOutput && typeof hookOutput === 'object') {
    if (hookOutput.permissionDecision === 'deny') {
      const reason = String(hookOutput.permissionDecisionReason || 'Blocked by ECC hook');
      return JSON.stringify({
        permission: 'deny',
        user_message: reason,
        agent_message: reason,
      });
    }

    if (hookOutput.additionalContext) {
      const context = normalizeAdditionalContext(hookOutput.additionalContext);
      if (!context) {
        return JSON.stringify({ permission: 'allow' });
      }
      return JSON.stringify({
        permission: 'allow',
        agent_message: context,
      });
    }
  }

  if (parsed && typeof parsed === 'object' && (parsed.tool_name || parsed.tool)) {
    return JSON.stringify({ permission: 'allow' });
  }

  return '';
}

module.exports = {
  adaptPreToolUseStdoutForCursor,
  buildPreToolUseAdditionalContext,
  combineAdditionalContext,
  normalizeAdditionalContext,
};
