#!/usr/bin/env node
/**
 * Shared hook enable/disable controls.
 *
 * Controls:
 * - ECC_HOOKS_ENABLED=true|false (default: true)
 * - ECC_HOOK_PROFILE=minimal|standard|strict (default: standard)
 * - ECC_DISABLED_HOOKS=comma,separated,hook,ids
 *
 * Claude plugin options are used when their corresponding ECC variable is
 * absent. A managed install can provide ecc/setup.json as the final fallback.
 */

'use strict';

const fs = require('fs');
const path = require('path');

const VALID_PROFILES = new Set(['minimal', 'standard', 'strict']);

function normalizeId(value) {
  return String(value || '').trim().toLowerCase();
}

function parseBoolean(value, fallback = true) {
  if (value === undefined || value === null || String(value).trim() === '') {
    return fallback;
  }
  const normalized = String(value).trim().toLowerCase();
  if (['1', 'true', 'yes', 'on'].includes(normalized)) return true;
  if (['0', 'false', 'no', 'off'].includes(normalized)) return false;
  return fallback;
}

function sanitizeDiagnostic(value) {
  return String(value || '')
    // eslint-disable-next-line no-control-regex
    .replace(/\x1b(?:\[[0-9;?]*[A-Za-z]|\][^\x07\x1b]*(?:\x07|\x1b\\)|\([A-Z]|[A-Z])/g, '')
    .replace(/[^\x20-\x7E]/g, '?');
}

function readClaudePluginConfigOptions(env = process.env) {
  const candidates = [];
  if (env.CLAUDE_CONFIG_DIR && String(env.CLAUDE_CONFIG_DIR).trim()) {
    candidates.push(path.join(String(env.CLAUDE_CONFIG_DIR).trim(), 'settings.json'));
  }
  const home = env.HOME || env.USERPROFILE || require('os').homedir();
  if (home) {
    candidates.push(path.join(home, '.claude', 'settings.json'));
  }
  for (const settingsPath of candidates) {
    try {
      if (!fs.existsSync(settingsPath)) continue;
      const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
      const options = settings && settings.pluginConfigs && (
        settings.pluginConfigs['ecc@ecc']?.options
        || settings.pluginConfigs['everything-claude-code@everything-claude-code']?.options
      );
      if (options && typeof options === 'object' && !Array.isArray(options)) {
        return {
          enabled: typeof options.hooks_enabled === 'boolean' ? options.hooks_enabled : undefined,
          profile: typeof options.hook_profile === 'string' ? options.hook_profile : undefined,
        };
      }
    } catch {
      // Ignore unreadable or invalid settings.json and try next candidate
    }
  }
  return { enabled: undefined, profile: undefined };
}

function readManagedHookConfig(env = process.env) {
  const pluginRoot = [env.CLAUDE_PLUGIN_ROOT, env.ECC_PLUGIN_ROOT]
    .map(value => typeof value === 'string' ? value.trim() : '')
    .find(Boolean) || '';
  const configPath = String(env.ECC_HOOK_CONFIG || '').trim()
    || (pluginRoot ? path.join(pluginRoot, 'ecc', 'setup.json') : '');
  if (!configPath || !fs.existsSync(configPath)) return {};

  try {
    const config = JSON.parse(fs.readFileSync(configPath, 'utf8').replace(/^\uFEFF/, ''));
    return config?.hooks
      && typeof config.hooks === 'object'
      && !Array.isArray(config.hooks)
      ? config.hooks
      : {};
  } catch (error) {
    process.stderr.write(`${sanitizeDiagnostic(
      `Warning: unable to read managed ECC hook config at ${configPath}: ${error.message}`
    )}\n`);
    return {};
  }
}

function areHooksEnabled(env = process.env, managed = readManagedHookConfig(env)) {
  const raw = env.ECC_HOOKS_ENABLED !== undefined
    ? env.ECC_HOOKS_ENABLED
    : (
      env.CLAUDE_PLUGIN_OPTION_HOOKS_ENABLED !== undefined
        ? env.CLAUDE_PLUGIN_OPTION_HOOKS_ENABLED
        : (managed.enabled !== undefined ? managed.enabled : readClaudePluginConfigOptions(env).enabled)
    );
  return parseBoolean(raw, true);
}

function getHookProfile(env = process.env, managed = readManagedHookConfig(env)) {
  const selected = env.ECC_HOOK_PROFILE !== undefined
    ? env.ECC_HOOK_PROFILE
    : (
      env.CLAUDE_PLUGIN_OPTION_HOOK_PROFILE !== undefined
        ? env.CLAUDE_PLUGIN_OPTION_HOOK_PROFILE
        : managed.profile
    );
  const raw = String(selected ?? 'standard').trim().toLowerCase();
  return VALID_PROFILES.has(raw) ? raw : 'standard';
}

function getDisabledHookIds(env = process.env) {
  const raw = String(env.ECC_DISABLED_HOOKS || '');
  if (!raw.trim()) return new Set();

  return new Set(
    raw
      .split(',')
      .map(v => normalizeId(v))
      .filter(Boolean)
  );
}

function parseProfiles(rawProfiles, fallback = ['standard', 'strict']) {
  if (!rawProfiles) return [...fallback];

  if (Array.isArray(rawProfiles)) {
    const parsed = rawProfiles
      .map(v => String(v || '').trim().toLowerCase())
      .filter(v => VALID_PROFILES.has(v));
    return parsed.length > 0 ? parsed : [...fallback];
  }

  const parsed = String(rawProfiles)
    .split(',')
    .map(v => v.trim().toLowerCase())
    .filter(v => VALID_PROFILES.has(v));

  return parsed.length > 0 ? parsed : [...fallback];
}

function isDryRun(env = process.env) {
  return env.ECC_DRY_RUN === '1';
}

function isHookEnabled(hookId, options = {}) {
  const env = options.env || process.env;
  const managed = readManagedHookConfig(env);
  if (!areHooksEnabled(env, managed)) {
    return false;
  }

  const id = normalizeId(hookId);
  if (!id) return true;

  const disabled = getDisabledHookIds(env);
  if (disabled.has(id)) {
    return false;
  }

  const profile = getHookProfile(env, managed);
  const allowedProfiles = parseProfiles(options.profiles);
  return allowedProfiles.includes(profile);
}

module.exports = {
  VALID_PROFILES,
  normalizeId,
  parseBoolean,
  readManagedHookConfig,
  areHooksEnabled,
  getHookProfile,
  getDisabledHookIds,
  parseProfiles,
  isHookEnabled,
  isDryRun,
};
