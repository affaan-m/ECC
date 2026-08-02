'use strict';

const fs = require('fs');
const path = require('path');
const child = require('child_process');

function log(...args) { console.log('[ecc-sync]', ...args); }

function readFileSafe(p) {
  try { return fs.readFileSync(p, 'utf8'); } catch { return null; }
}

function writeFileThrough(pathname, content) {
  // write through (preserve symlink target)
  fs.writeFileSync(pathname, content, 'utf8');
}

function requirePath(p, label) {
  if (!fs.existsSync(p)) {
    throw new Error(`Missing ${label}: ${p}`);
  }
}

function runNodeScript(script, args = []) {
  const res = child.spawnSync(process.execPath, [script, ...args], {
    encoding: 'utf8', stdio: ['pipe','pipe','pipe']
  });
  return res;
}

function copyIfNotExists(src, dest, dryRun) {
  if (dryRun) { log('[dry-run] would copy', src, '=>', dest); return; }
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.copyFileSync(src, dest);
}

function ensureDir(p, dryRun) {
  if (dryRun) { log('[dry-run] mkdir -p', p); return; }
  fs.mkdirSync(p, { recursive: true });
}

function generatePromptFile(src, out, cmdName, dryRun) {
  if (dryRun) { log('[dry-run] generate', out, 'from', src); return; }
  const source = fs.readFileSync(src, 'utf8');
  const lines = source.split(/\r?\n/);
  let fm = false; let idx = 0; const outLines = [];
  // header
  outLines.push(`# ECC Command Prompt: /${cmdName}`);
  outLines.push('');
  outLines.push(`Source: ${src}`);
  outLines.push('');
  outLines.push('Use this prompt to run the ECC `' + cmdName + '` workflow.');
  outLines.push('');
  for (const line of lines) {
    if (idx === 0 && line === '---') { fm = true; idx++; continue; }
    if (fm && line === '---') { fm = false; idx++; continue; }
    if (fm) { idx++; continue; }
    outLines.push(line);
    idx++;
  }
  fs.writeFileSync(out, outLines.join('\n') + '\n', 'utf8');
}

function composeEccBlock(repoRoot, agentsRootSrc, agentsCodeSrc) {
  const begin = '<!-- BEGIN ECC -->';
  const end = '<!-- END ECC -->';
  const rootAgent = readFileSafe(path.join(repoRoot, 'AGENTS.md')) || '';
  const codeSup = readFileSafe(agentsCodeSrc) || '';
  return [begin, rootAgent, '\n\n---\n\n# Codex Supplement (From ECC .codex/AGENTS.md)', '', codeSup, end].join('\n');
}

function replaceEccSection(agentsFile, newBlock) {
  const content = fs.readFileSync(agentsFile, 'utf8');
  const begin = '<!-- BEGIN ECC -->';
  const end = '<!-- END ECC -->';
  if (!content.includes(begin) && !content.includes(end)) {
    fs.appendFileSync(agentsFile, '\n\n' + newBlock + '\n');
    return;
  }
  // Both markers present -> replace between them
  const before = content.split(begin)[0];
  const after = content.split(end).slice(1).join(end);
  const out = before + newBlock + after;
  writeFileThrough(agentsFile, out);
}

function run(options) {
  const repoRoot = path.resolve(__dirname, '..');
  const CODEX_HOME = process.env.CODEX_HOME || (process.env.HOME || process.env.USERPROFILE) + path.sep + '.codex';
  const configFile = path.join(CODEX_HOME, 'config.toml');
  const agentsFile = path.join(CODEX_HOME, 'AGENTS.md');
  const agentsRootSrc = path.join(repoRoot, 'AGENTS.md');
  const agentsCodeSrc = path.join(repoRoot, '.codex', 'AGENTS.md');
  const codeAgentsSrc = path.join(repoRoot, '.codex', 'agents');
  const codeAgentsDest = path.join(CODEX_HOME, 'agents');
  const navSrc = path.join(repoRoot, 'docs', 'CODEX-NAVIGATION-GUIDE.md');
  const navDest = path.join(CODEX_HOME, 'docs', 'CODEX-NAVIGATION-GUIDE.md');
  const mapSrc = path.join(repoRoot, 'docs', 'COMMAND-AGENT-MAP.md');
  const mapDest = path.join(CODEX_HOME, 'docs', 'COMMAND-AGENT-MAP.md');
  const quickSrc = path.join(repoRoot, 'COMMANDS-QUICK-REF.md');
  const quickDest = path.join(CODEX_HOME, 'COMMANDS-QUICK-REF.md');
  const contribSrc = path.join(repoRoot, 'CONTRIBUTING.md');
  const contribDest = path.join(CODEX_HOME, 'CONTRIBUTING.md');
  const prSrc = path.join(repoRoot, '.github', 'PULL_REQUEST_TEMPLATE.md');
  const prDest = path.join(CODEX_HOME, '.github', 'PULL_REQUEST_TEMPLATE.md');
  const promptsSrc = path.join(repoRoot, 'commands');
  const promptsDest = path.join(CODEX_HOME, 'prompts');
  const baselineMergeScript = path.join(repoRoot, 'scripts', 'codex', 'merge-codex-config.js');
  const mcpMergeScript = path.join(repoRoot, 'scripts', 'codex', 'merge-mcp-config.js');

  const dryRun = options.mode === 'dry-run';

  // Preflight requires similar to shell's require_path but be lenient for tests
  for (const [p, label] of [[agentsRootSrc, 'ECC AGENTS.md'], [agentsCodeSrc, 'ECC Codex AGENTS supplement'], [codeAgentsSrc, 'ECC Codex agent roles'], [navSrc, 'ECC Codex navigation guide'], [mapSrc, 'ECC command-agent map'], [quickSrc, 'ECC commands quick reference'], [contribSrc, 'ECC contributing guide'], [prSrc, 'ECC PR template'], [promptsSrc, 'ECC commands directory'], [baselineMergeScript, 'ECC Codex baseline merge script'], [mcpMergeScript, 'ECC MCP merge script']]) {
    if (!fs.existsSync(p)) {
      throw new Error(`Missing ${label}: ${p}`);
    }
  }

  log('Mode:', options.mode);
  log('Repo root:', repoRoot);
  log('Codex home:', CODEX_HOME);

  // Backup
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const backupDir = path.join(CODEX_HOME, 'backups', `ecc-${stamp}`);
  if (!dryRun) ensureDir(backupDir);
  if (!dryRun && fs.existsSync(configFile)) {
    ensureDir(backupDir);
    fs.copyFileSync(configFile, path.join(backupDir, 'config.toml'));
  }
  if (!dryRun && fs.existsSync(agentsFile)) {
    fs.copyFileSync(agentsFile, path.join(backupDir, 'AGENTS.md'));
  }

  // Merge AGENTS
  const eccBlock = composeEccBlock(repoRoot, agentsRootSrc, agentsCodeSrc);
  if (dryRun) {
    log('[dry-run] would merge ECC block into', agentsFile);
  } else {
    ensureDir(path.dirname(agentsFile));
    if (!fs.existsSync(agentsFile)) {
      writeFileThrough(agentsFile, eccBlock + '\n');
    } else {
      replaceEccSection(agentsFile, eccBlock);
    }
  }

  // Merge baseline config via node script
  if (dryRun) {
    log('[dry-run] would run baseline merge script', baselineMergeScript, configFile);
  } else {
    const merged = runNodeScript(baselineMergeScript, [configFile]);
    if (merged.status !== 0) {
      throw new Error(`merge-codex-config failed: ${merged.stderr || merged.stdout}`);
    }
  }

  // Copy nav guide and docs
  ensureDir(path.dirname(navDest), dryRun);
  copyIfNotExists(navSrc, navDest, dryRun);
  copyIfNotExists(mapSrc, mapDest, dryRun);
  copyIfNotExists(quickSrc, quickDest, dryRun);
  copyIfNotExists(contribSrc, contribDest, dryRun);
  ensureDir(path.dirname(prDest), dryRun);
  copyIfNotExists(prSrc, prDest, dryRun);

  // Copy agent role files
  ensureDir(codeAgentsDest, dryRun);
  if (!dryRun) {
    for (const file of fs.readdirSync(codeAgentsSrc)) {
      if (!file.endsWith('.toml')) continue;
      const dest = path.join(codeAgentsDest, file);
      if (!fs.existsSync(dest)) fs.copyFileSync(path.join(codeAgentsSrc, file), dest);
    }
  }

  // Generate prompt files
  ensureDir(promptsDest, dryRun);
  if (!dryRun) {
    const manifest = path.join(promptsDest, 'ecc-prompts-manifest.txt');
    fs.writeFileSync(manifest, '');
    const entries = fs.readdirSync(promptsSrc).filter(f => f.endsWith('.md')).sort();
    for (const entry of entries) {
      const src = path.join(promptsSrc, entry);
      const name = path.basename(entry, '.md');
      const out = path.join(promptsDest, `ecc-${name}.md`);
      generatePromptFile(src, out, name, dryRun);
      fs.appendFileSync(manifest, `ecc-${name}.md\n`);
    }
    // sort -u
    const lines = fs.readFileSync(manifest, 'utf8').split(/\r?\n/).filter(Boolean);
    const uniq = Array.from(new Set(lines)).sort();
    fs.writeFileSync(manifest, uniq.join('\n') + '\n');
  }

  // Run MCP merge when requested (always invoked by baseline merge earlier if needed)
  if (!dryRun && options.updateMcp) {
    const res = runNodeScript(mcpMergeScript, [configFile]);
    if (res.status !== 0) throw new Error(`merge-mcp-config failed: ${res.stderr || res.stdout}`);
  }

  log('Sync complete');
}

if (require.main === module) {
  const args = process.argv.slice(2);
  const options = { mode: 'apply', updateMcp: false };
  for (const arg of args) {
    if (arg === '--dry-run') options.mode = 'dry-run';
    if (arg === '--update-mcp') options.updateMcp = true;
  }
  try {
    run(options);
    process.exit(0);
  } catch (err) {
    console.error(err && err.stack ? err.stack : String(err));
    process.exit(1);
  }
}
