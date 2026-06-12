#!/usr/bin/env node
'use strict';

/**
 * Merge ECC-recommended MCP servers into a Codex config.toml.
 *
 * Strategy: ADD-ONLY by default.
 *   - Parse the TOML to detect which mcp_servers.* sections exist.
 *   - Append raw TOML text for any missing servers (preserves existing file byte-for-byte).
 *   - Log warnings when an existing server's config differs from the ECC recommendation.
 *   - With --update-mcp, also replace existing ECC-managed servers.
 *
 * Uses the repo's package-manager abstraction (scripts/lib/package-manager.js)
 * so MCP launcher commands respect the user's configured package manager.
 *
 * Usage:
 *   node merge-mcp-config.js <config.toml> [--dry-run] [--update-mcp]
 */

const fs = require('fs');
const path = require('path');
const { parseDisabledMcpServers } = require('../lib/mcp-config');

let TOML;
try {
  TOML = require('@iarna/toml');
} catch {
  console.error('[ecc-mcp] Missing dependency: @iarna/toml');
  console.error('[ecc-mcp] Run: npm install   (from the ECC repo root)');
  process.exit(1);
}

// ---------------------------------------------------------------------------
// Package manager detection
// ---------------------------------------------------------------------------

let pmConfig;
try {
  const { getPackageManager } = require(path.join(__dirname, '..', 'lib', 'package-manager.js'));
  pmConfig = getPackageManager();
} catch {
  // Fallback: if package-manager.js isn't available, default to npx
  pmConfig = { name: 'npm', config: { name: 'npm', execCmd: 'npx' } };
}

// Yarn 1.x doesn't support `yarn dlx` — fall back to npx for classic Yarn.
let resolvedExecCmd = pmConfig.config.execCmd;
if (pmConfig.name === 'yarn' && resolvedExecCmd === 'yarn dlx') {
  try {
    const { execFileSync } = require('child_process');
    const ver = execFileSync('yarn', ['--version'], { encoding: 'utf8', timeout: 5000 }).trim();
    if (ver.startsWith('1.')) {
      resolvedExecCmd = 'npx';
    }
  } catch {
    // Can't detect version — keep yarn dlx and let it fail visibly
  }
}

const PM_NAME = pmConfig.config.name || pmConfig.name;
const PM_EXEC = resolvedExecCmd; // e.g. "pnpm dlx", "npx", "bunx", "yarn dlx"
const PM_EXEC_PARTS = PM_EXEC.split(/\s+/); // ["pnpm", "dlx"] or ["npx"] or ["bunx"]

// ---------------------------------------------------------------------------
// ECC-recommended MCP servers
// ---------------------------------------------------------------------------

/**
 * Build a server spec with the detected package manager.
 * Returns { fields, toml } where fields is for drift detection and
 * toml is the raw text appended to the file.
 *
 * Codex's [mcp_servers.*] TOML schema is stdio-only (command/args) —
 * never emit a `url` key here. The http/url form is valid only for
 * Claude Code's .mcp.json (#2224).
 */
function dlxServer(name, pkg, extraFields, extraToml) {
  const args = [...PM_EXEC_PARTS.slice(1), pkg];
  const fields = { command: PM_EXEC_PARTS[0], args, ...extraFields };
  const argsStr = JSON.stringify(args).replace(/,/g, ', ');
  let toml = `[mcp_servers.${name}]\ncommand = "${PM_EXEC_PARTS[0]}"\nargs = ${argsStr}`;
  if (extraToml) toml += '\n' + extraToml;
  return { fields, toml };
}

/** Each entry: key = section name under mcp_servers, value = { toml, fields } */
const DEFAULT_MCP_STARTUP_TIMEOUT_SEC = 30;
const DEFAULT_MCP_STARTUP_TIMEOUT_TOML = `startup_timeout_sec = ${DEFAULT_MCP_STARTUP_TIMEOUT_SEC}`;

// Current default connector set (docs/MCP-CONNECTOR-POLICY.md): exactly one
// connector. The former defaults (supabase, playwright, context7, exa,
// github, memory, sequential-thinking) were retired in the June 2026 audit
// and must not be re-emitted; they remain opt-in via
// mcp-configs/mcp-servers.json. Existing user-managed entries are never
// touched by the merge (add-only), except the known-invalid repair below.
const ECC_SERVERS = {
  'chrome-devtools': dlxServer('chrome-devtools', 'chrome-devtools-mcp@latest', { startup_timeout_sec: DEFAULT_MCP_STARTUP_TIMEOUT_SEC }, DEFAULT_MCP_STARTUP_TIMEOUT_TOML)
};

// ECC <= 2.0.0 emitted [mcp_servers.exa] with a `url` key. Codex rejects
// `url` for stdio servers, which makes the *entire* config.toml fail to
// load (#2224). Repair exactly that ECC-emitted form on every merge so
// re-running the installer fixes broken configs instead of preserving
// them. A user-managed stdio exa entry (command/args) is left untouched.
const RETIRED_INVALID_URL_SERVERS = {
  exa: 'https://mcp.exa.ai/mcp'
};

// Legacy section names that should be treated as an existing ECC server.
// e.g. older configs shipped [mcp_servers.context7-mcp] instead of
// [mcp_servers.context7]. Empty since the June 2026 default-set reduction.
const LEGACY_ALIASES = {};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function log(msg) {
  console.log(`[ecc-mcp] ${msg}`);
}

function warn(msg) {
  console.warn(`[ecc-mcp] WARNING: ${msg}`);
}

/** Shallow-compare two objects (one level deep, arrays by JSON). */
function configDiffers(existing, recommended) {
  for (const key of Object.keys(recommended)) {
    const a = existing[key];
    const b = recommended[key];
    if (Array.isArray(b)) {
      if (JSON.stringify(a) !== JSON.stringify(b)) return true;
    } else if (a !== b) {
      return true;
    }
  }
  return false;
}

/**
 * Remove a TOML section and its key-value pairs from raw text.
 * Matches the section header even if followed by inline comments or whitespace
 * (e.g. `[mcp_servers.github] # comment`).
 * Returns the text with the section removed.
 */
function removeSectionFromText(text, sectionHeader) {
  const escaped = sectionHeader.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const headerPattern = new RegExp(`^${escaped}(\\s*(#.*)?)?$`);
  const lines = text.split('\n');
  const result = [];
  let skipping = false;
  for (const line of lines) {
    const trimmed = line.replace(/\r$/, '');
    if (headerPattern.test(trimmed)) {
      skipping = true;
      continue;
    }
    if (skipping && /^\[/.test(trimmed)) {
      skipping = false;
    }
    if (!skipping) {
      result.push(line);
    }
  }
  return result.join('\n');
}

/**
 * Collect all TOML sub-section headers for a given server name.
 * @iarna/toml nests subtables, so `[mcp_servers.supabase.env]` appears as
 * `parsed.mcp_servers.supabase.env` (nested), NOT as a flat dotted key.
 * Walk the nested object to find sub-objects that represent TOML sub-tables.
 */
function findSubSections(serverObj, prefix) {
  const sections = [];
  if (!serverObj || typeof serverObj !== 'object') return sections;
  for (const key of Object.keys(serverObj)) {
    const val = serverObj[key];
    if (val && typeof val === 'object' && !Array.isArray(val)) {
      const subPath = `${prefix}.${key}`;
      sections.push(subPath);
      sections.push(...findSubSections(val, subPath));
    }
  }
  return sections;
}

/**
 * Remove a server and all its sub-sections from raw TOML text.
 * Uses findSubSections to walk the parsed nested object (not flat keys).
 */
function removeServerFromText(raw, serverName, existing) {
  let result = removeSectionFromText(raw, `[mcp_servers.${serverName}]`);
  const serverObj = existing[serverName];
  if (serverObj) {
    for (const sub of findSubSections(serverObj, serverName)) {
      result = removeSectionFromText(result, `[mcp_servers.${sub}]`);
    }
  }
  return result;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

function main() {
  const args = process.argv.slice(2);
  const configPath = args.find(a => !a.startsWith('-'));
  const dryRun = args.includes('--dry-run');
  const updateMcp = args.includes('--update-mcp');
  const disabledServers = new Set(parseDisabledMcpServers(process.env.ECC_DISABLED_MCPS));

  if (!configPath) {
    console.error('Usage: merge-mcp-config.js <config.toml> [--dry-run] [--update-mcp]');
    process.exit(1);
  }

  if (!fs.existsSync(configPath)) {
    console.error(`[ecc-mcp] Config file not found: ${configPath}`);
    process.exit(1);
  }

  log(`Package manager: ${PM_NAME} (exec: ${PM_EXEC})`);
  if (disabledServers.size > 0) {
    log(`Disabled via ECC_DISABLED_MCPS: ${[...disabledServers].join(', ')}`);
  }

  let raw = fs.readFileSync(configPath, 'utf8');
  let parsed;
  try {
    parsed = TOML.parse(raw);
  } catch (err) {
    console.error(`[ecc-mcp] Failed to parse ${configPath}: ${err.message}`);
    process.exit(1);
  }

  const existing = parsed.mcp_servers || {};
  const toAppend = [];
  const toRemoveLog = [];

  // Repair schema-invalid entries emitted by earlier ECC versions (#2224).
  for (const [name, invalidUrl] of Object.entries(RETIRED_INVALID_URL_SERVERS)) {
    const entry = existing[name];
    const isBrokenEccForm =
      entry &&
      typeof entry.url === 'string' &&
      entry.url === invalidUrl &&
      typeof entry.command !== 'string';
    if (isBrokenEccForm) {
      toRemoveLog.push(`mcp_servers.${name} (invalid url entry from earlier ECC versions)`);
      raw = removeServerFromText(raw, name, existing);
      log(`  [repair] mcp_servers.${name} — url is not valid for Codex stdio servers, removing`);
    }
  }

  for (const [name, spec] of Object.entries(ECC_SERVERS)) {
    const entry = existing[name];
    const aliases = LEGACY_ALIASES[name] || [];
    const legacyName = aliases.find(a => existing[a] && typeof existing[a].command === 'string');

    // Prefer canonical entry over legacy alias
    const hasCanonical = entry && typeof entry.command === 'string';
    const resolvedEntry = hasCanonical ? entry : legacyName ? existing[legacyName] : null;
    // Recognize url-form entries as existing so they are never duplicated.
    // (Codex itself rejects url-form stdio servers; ECC only ever emits
    // command/args, but a user-managed entry must still count as present.)
    const urlEntry = !resolvedEntry && entry && typeof entry.url === 'string' ? entry : null;
    const finalEntry = resolvedEntry || urlEntry;
    const resolvedLabel = hasCanonical ? name : legacyName || name;

    if (disabledServers.has(name)) {
      if (finalEntry) {
        toRemoveLog.push(`mcp_servers.${resolvedLabel} (disabled)`);
        raw = removeServerFromText(raw, resolvedLabel, existing);
        if (resolvedLabel !== name) {
          raw = removeServerFromText(raw, name, existing);
        }
      }
      log(`  [skip] mcp_servers.${name} (disabled)`);
      continue;
    }

    if (finalEntry) {
      if (updateMcp) {
        // --update-mcp: remove existing section (and legacy alias), will re-add below
        toRemoveLog.push(`mcp_servers.${resolvedLabel}`);
        raw = removeServerFromText(raw, resolvedLabel, existing);
        if (resolvedLabel !== name) {
          raw = removeServerFromText(raw, name, existing);
        }
        if (legacyName && hasCanonical) {
          toRemoveLog.push(`mcp_servers.${legacyName}`);
          raw = removeServerFromText(raw, legacyName, existing);
        }
        toAppend.push(spec.toml);
      } else {
        // Add-only mode: skip, but warn about drift
        if (legacyName && !hasCanonical) {
          warn(`mcp_servers.${legacyName} is a legacy name for ${name} (run with --update-mcp to migrate)`);
        } else if (configDiffers(finalEntry, spec.fields)) {
          warn(`mcp_servers.${name} differs from ECC recommendation (run with --update-mcp to refresh)`);
        } else {
          log(`  [ok] mcp_servers.${name}`);
        }
      }
    } else {
      log(`  [add] mcp_servers.${name}`);
      toAppend.push(spec.toml);
    }
  }

  const hasRemovals = toRemoveLog.length > 0;

  if (toAppend.length === 0 && !hasRemovals) {
    log('All ECC MCP servers already present. Nothing to do.');
    return;
  }

  const appendText = '\n' + toAppend.join('\n\n') + '\n';

  if (dryRun) {
    if (toRemoveLog.length > 0) {
      log('Dry run — would remove:');
      for (const label of toRemoveLog) log(`  [remove] ${label}`);
    }
    if (toAppend.length > 0) {
      log('Dry run — would append:');
      console.log(appendText);
    }
    return;
  }

  // Write: for add-only, append to preserve existing content byte-for-byte.
  // For --update-mcp, we modified `raw` above, so write the full file + appended sections.
  if (updateMcp || hasRemovals) {
    for (const label of toRemoveLog) log(`  [update] ${label}`);
    const cleaned = raw.replace(/\n+$/, '\n');
    fs.writeFileSync(configPath, cleaned + (toAppend.length > 0 ? appendText : ''), 'utf8');
  } else {
    fs.appendFileSync(configPath, appendText, 'utf8');
  }

  if (hasRemovals && toAppend.length === 0) {
    log(`Done. Removed ${toRemoveLog.length} server section(s).`);
    return;
  }

  log(`Done. ${toAppend.length} server(s) ${updateMcp ? 'updated' : 'added'}.`);
}

main();
