#!/usr/bin/env node
/**
 * Lint curated skills for host-portable frontmatter and substitutions.
 *
 * Checks:
 *   1. Claude-only substitutions in executable bash/sh/zsh fences
 *      (${CLAUDE_SESSION_ID}, ${CLAUDE_SKILL_DIR}, ${CLAUDE_PLUGIN_ROOT},
 *      ${CLAUDE_PROJECT_DIR}, $ARGUMENTS). Codex and a bare shell leave
 *      those tokens literal. Rewrite ${CLAUDE_PROJECT_DIR} in Codex copies
 *      to $(pwd) or an explicit path.
 *   2. Codex-copy frontmatter allowlist on .agents/skills/<name>/SKILL.md
 *      (name, description, metadata, license, allowed-tools). origin/version
 *      may remain on the canonical skills/ copy.
 *   3. Subset drift: agents/openai.yaml names a skill that is missing from
 *      .agents/skills/, or a Codex/Cursor copy name: does not match its
 *      directory.
 *   4. CONTRIBUTING checklist (WARN unless --strict-checklist): When to
 *      Activate, Anti-Patterns, name matches directory, 500/800 line caps.
 *
 * Default invocation is fail-closed on (1)-(3). Pass --inventory to print
 * JSON counts and exit 0. Do not flip validate-skills.js to --strict;
 * that file's WARN default is load-bearing for #1663.
 *
 * Scope: curated skills/ plus Codex/Cursor copies. If skills/ is absent,
 * exit 0 (nothing to validate).
 */

'use strict';

const fs = require('fs');
const path = require('path');

const { extractFrontmatter, inspectFrontmatter } = require('./validate-skills');

const DEFAULT_ROOT = path.join(__dirname, '../..');

const ALLOWED_CODEX_FRONTMATTER_KEYS = new Set([
  'allowed-tools',
  'description',
  'license',
  'metadata',
  'name',
]);

const CLAUDE_SUBSTITUTION_PATTERNS = [
  { token: '${CLAUDE_SESSION_ID}', regex: /\$\{CLAUDE_SESSION_ID\}/g },
  { token: '$CLAUDE_SESSION_ID', regex: /\$CLAUDE_SESSION_ID\b/g },
  { token: '${CLAUDE_SKILL_DIR}', regex: /\$\{CLAUDE_SKILL_DIR\}/g },
  { token: '$CLAUDE_SKILL_DIR', regex: /\$CLAUDE_SKILL_DIR\b/g },
  { token: '${CLAUDE_PLUGIN_ROOT}', regex: /\$\{CLAUDE_PLUGIN_ROOT\}/g },
  { token: '$CLAUDE_PLUGIN_ROOT', regex: /\$CLAUDE_PLUGIN_ROOT\b/g },
  { token: '${CLAUDE_PROJECT_DIR}', regex: /\$\{CLAUDE_PROJECT_DIR\}/g },
  { token: '$CLAUDE_PROJECT_DIR', regex: /\$CLAUDE_PROJECT_DIR\b/g },
  { token: '$ARGUMENTS', regex: /\$ARGUMENTS\b|\$\{ARGUMENTS\}/g },
  // Claude skill form ${1}. Bare $1 is handled in findSubstitutionTokens so
  // POSIX `VAR=$1` and Perl/awk `$1 < 80` are not treated as Claude args.
  { token: '$1', regex: /\$\{1\}|(?<![\w$])\$1(?!\d)/g },
];

const EXECUTABLE_FENCE_LANGS = new Set(['bash', 'sh', 'zsh']);
const CHECKLIST_CODES = new Set([
  'missing-when-to-activate',
  'missing-anti-patterns',
  'name-mismatch',
  'line-cap-500',
  'line-cap-800',
]);

function parseArgs(argv) {
  const args = {
    root: DEFAULT_ROOT,
    inventory: false,
    strictChecklist: false,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--inventory') {
      args.inventory = true;
    } else if (arg === '--strict-checklist') {
      args.strictChecklist = true;
    } else if (arg === '--root') {
      const value = argv[i + 1];
      if (!value) {
        throw new Error('--root requires a directory path');
      }
      args.root = value;
      i += 1;
    }
  }

  return args;
}

function listSkillDirs(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true })
    .filter(entry => entry.isDirectory() && !entry.name.startsWith('.'))
    .map(entry => entry.name)
    .sort();
}

function readFileIfPresent(filePath) {
  if (!fs.existsSync(filePath)) return null;
  return fs.readFileSync(filePath, 'utf8');
}

function unquoteYamlScalar(value) {
  if (value === undefined || value === null) return '';
  const trimmed = String(value).trim();
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"'))
    || (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

function extractTopLevelList(yamlSource, key) {
  const lines = String(yamlSource).replace(/^\uFEFF/, '').split(/\r?\n/);
  const results = [];
  let collecting = false;

  for (const line of lines) {
    if (!collecting) {
      if (line.trim() === `${key}:`) {
        collecting = true;
      }
      continue;
    }

    if (/^[A-Za-z0-9_-]+:\s*/.test(line)) {
      break;
    }

    const match = line.match(/^\s*-\s+(.+?)\s*$/);
    if (match) {
      results.push(unquoteYamlScalar(match[1]));
    }
  }

  return results;
}

function listOpenaiYamlSkills(root) {
  const filePath = path.join(root, 'agents', 'openai.yaml');
  const source = readFileIfPresent(filePath);
  if (source === null) return [];
  return extractTopLevelList(source, 'skills');
}

function stripFrontmatter(content) {
  const fm = extractFrontmatter(content);
  if (!fm.present) {
    return { frontmatter: fm, body: content.replace(/^\uFEFF/, ''), bodyOffset: 0 };
  }
  const match = content.replace(/^\uFEFF/, '').match(/^---\r?\n[\s\S]*?\r?\n---(?:\r?\n|$)/);
  const bodyOffset = match ? match[0].length : 0;
  return {
    frontmatter: fm,
    body: content.replace(/^\uFEFF/, '').slice(bodyOffset),
    bodyOffset,
  };
}

function findExecutableFences(body) {
  const fences = [];
  const fenceRe = /^```([^\r\n]*)\r?\n([\s\S]*?)^```[ \t]*(?:\r?\n|$)/gm;
  let match = fenceRe.exec(body);
  while (match) {
    const info = (match[1] || '').trim();
    const lang = info === '' ? '' : info.split(/\s+/)[0].toLowerCase();
    const content = match[2];
    const executable = EXECUTABLE_FENCE_LANGS.has(lang)
      || (lang === '' && /^\s*#!/.test(content));
    if (executable) {
      fences.push({
        lang: lang || 'shebang',
        content,
        start: match.index,
      });
    }
    match = fenceRe.exec(body);
  }
  return fences;
}

function precedingAllowsToken(body, fenceStart) {
  const prefix = body.slice(0, fenceStart).replace(/\s+$/, '');
  const lines = prefix.split(/\r?\n/);
  const window = lines.slice(-3).join('\n');
  return /anti-pattern/i.test(window) || /do not/i.test(window);
}

function isPortableBareDollarOne(fenceContent, index) {
  const before = fenceContent.slice(0, index);
  const after = fenceContent.slice(index + 2);
  // Perl/awk numeric compare: `$1 < 80`, `$1>=0`.
  if (/^\s*[<>=]/.test(after)) return true;
  // POSIX assignment of a function positional: `VAR=$1` or `VAR="$1"`.
  if (/=\s*["']?$/.test(before)) return true;
  return false;
}

function findSubstitutionTokens(fenceContent) {
  const found = [];
  for (const pattern of CLAUDE_SUBSTITUTION_PATTERNS) {
    pattern.regex.lastIndex = 0;
    let match = pattern.regex.exec(fenceContent);
    while (match !== null) {
      const skipBarePositional = pattern.token === '$1'
        && match[0] === '$1'
        && isPortableBareDollarOne(fenceContent, match.index);
      if (!skipBarePositional) {
        found.push(pattern.token);
        break;
      }
      match = pattern.regex.exec(fenceContent);
    }
  }
  return found;
}

function countLines(content) {
  if (content.length === 0) return 0;
  return content.replace(/^\uFEFF/, '').split(/\r?\n/).length;
}

function relSkillMd(skillName) {
  return `${skillName}/SKILL.md`;
}

function pushFinding(findings, finding) {
  findings.push(finding);
}

function substitutionMessage(skillName, fenceLang, token) {
  const base = `${relSkillMd(skillName)} - ${fenceLang} fence contains Claude-only substitution ${token}`;
  if (token === '${CLAUDE_PROJECT_DIR}' || token === '$CLAUDE_PROJECT_DIR') {
    return `${base}; rewrite to $(pwd) or an explicit path`;
  }
  return base;
}

function inspectCanonicalSkill(skillName, content, findings) {
  const { frontmatter, body } = stripFrontmatter(content);
  const values = frontmatter.present ? inspectFrontmatter(frontmatter.lines).values : {};
  const declaredName = unquoteYamlScalar(values.name || '');
  const lineCount = countLines(content);

  if (declaredName && declaredName !== skillName) {
    pushFinding(findings, {
      severity: 'warn',
      code: 'name-mismatch',
      skill: skillName,
      message: `${relSkillMd(skillName)} - frontmatter name '${declaredName}' does not match directory '${skillName}'`,
    });
  }

  if (!/^##\s+When to Activate\b/m.test(body)) {
    pushFinding(findings, {
      severity: 'warn',
      code: 'missing-when-to-activate',
      skill: skillName,
      message: `${relSkillMd(skillName)} - missing '## When to Activate' section`,
    });
  }

  if (!/^##\s+Anti-Patterns\b/m.test(body)) {
    pushFinding(findings, {
      severity: 'warn',
      code: 'missing-anti-patterns',
      skill: skillName,
      message: `${relSkillMd(skillName)} - missing '## Anti-Patterns' section`,
    });
  }

  if (lineCount > 800) {
    pushFinding(findings, {
      severity: 'warn',
      code: 'line-cap-800',
      skill: skillName,
      message: `${relSkillMd(skillName)} - body is ${lineCount} lines (CONTRIBUTING max 800)`,
    });
  } else if (lineCount > 500) {
    pushFinding(findings, {
      severity: 'warn',
      code: 'line-cap-500',
      skill: skillName,
      message: `${relSkillMd(skillName)} - body is ${lineCount} lines (CONTRIBUTING target 500)`,
    });
  }

  for (const fence of findExecutableFences(body)) {
    if (precedingAllowsToken(body, fence.start)) continue;
    const tokens = findSubstitutionTokens(fence.content);
    for (const token of tokens) {
      pushFinding(findings, {
        severity: 'error',
        code: 'substitution',
        skill: skillName,
        token,
        message: substitutionMessage(skillName, fence.lang, token),
      });
    }
  }
}

function inspectCopyName(skillName, content, treeLabel, findings) {
  const { frontmatter } = stripFrontmatter(content);
  if (!frontmatter.present) return;
  const declaredName = unquoteYamlScalar(inspectFrontmatter(frontmatter.lines).values.name || '');
  if (declaredName && declaredName !== skillName) {
    pushFinding(findings, {
      severity: 'error',
      code: 'copy-name-mismatch',
      skill: skillName,
      message: `${treeLabel}/${relSkillMd(skillName)} - frontmatter name '${declaredName}' does not match directory '${skillName}'`,
    });
  }
}

function inspectCodexCopy(skillName, content, findings) {
  const { frontmatter } = stripFrontmatter(content);
  inspectCopyName(skillName, content, '.agents/skills', findings);
  if (!frontmatter.present) return;

  const keys = Object.keys(inspectFrontmatter(frontmatter.lines).values);
  const unexpected = keys.filter(key => !ALLOWED_CODEX_FRONTMATTER_KEYS.has(key));
  if (unexpected.length > 0) {
    pushFinding(findings, {
      severity: 'error',
      code: 'codex-key',
      skill: skillName,
      message: `.agents/skills/${relSkillMd(skillName)} - Codex-forbidden frontmatter key${unexpected.length === 1 ? '' : 's'}: ${unexpected.join(', ')}`,
    });
  }
}

function validateSkillHostCompat(options = {}) {
  const root = options.root || DEFAULT_ROOT;
  const inventory = Boolean(options.inventory);
  const strictChecklist = Boolean(options.strictChecklist);
  const skillsDir = path.join(root, 'skills');
  const codexDir = path.join(root, '.agents', 'skills');
  const cursorDir = path.join(root, '.cursor', 'skills');
  const findings = [];

  if (!fs.existsSync(skillsDir)) {
    return {
      ok: true,
      skipped: true,
      message: 'No curated skills directory (skills/), skipping',
      findings: [],
      counts: emptyCounts(),
    };
  }

  const canonicalSkills = listSkillDirs(skillsDir);
  const codexSkills = listSkillDirs(codexDir);
  const cursorSkills = listSkillDirs(cursorDir);
  const openaiListed = listOpenaiYamlSkills(root);
  const skillsWithCanonical = new Set(canonicalSkills);

  for (const skillName of canonicalSkills) {
    const skillMd = path.join(skillsDir, skillName, 'SKILL.md');
    const content = readFileIfPresent(skillMd);
    if (content === null) continue;
    inspectCanonicalSkill(skillName, content, findings);
  }

  for (const skillName of openaiListed) {
    if (!skillsWithCanonical.has(skillName)) continue;
    const copyMd = path.join(codexDir, skillName, 'SKILL.md');
    if (!fs.existsSync(copyMd)) {
      pushFinding(findings, {
        severity: 'error',
        code: 'missing-codex-copy',
        skill: skillName,
        message: `agents/openai.yaml lists '${skillName}' but .agents/skills/${skillName}/ is missing`,
      });
    }
  }

  for (const skillName of codexSkills) {
    const copyMd = path.join(codexDir, skillName, 'SKILL.md');
    const content = readFileIfPresent(copyMd);
    if (content === null) continue;
    inspectCodexCopy(skillName, content, findings);
  }

  for (const skillName of cursorSkills) {
    const copyMd = path.join(cursorDir, skillName, 'SKILL.md');
    const content = readFileIfPresent(copyMd);
    if (content === null) continue;
    inspectCopyName(skillName, content, '.cursor/skills', findings);
  }

  const resolved = findings.map(finding => {
    if (strictChecklist && CHECKLIST_CODES.has(finding.code) && finding.severity === 'warn') {
      return { ...finding, severity: 'error' };
    }
    return finding;
  });

  const counts = summarizeCounts(canonicalSkills.length, resolved);
  const errorCount = resolved.filter(finding => finding.severity === 'error').length;

  return {
    ok: inventory || errorCount === 0,
    skipped: false,
    inventory,
    findings: resolved,
    counts,
    message: inventory
      ? JSON.stringify(counts)
      : formatSummary(canonicalSkills.length, counts),
  };
}

function emptyCounts() {
  return {
    skillsScanned: 0,
    errors: 0,
    warnings: 0,
    substitutions: 0,
    codexKeys: 0,
    missingCodexCopies: 0,
    copyNameMismatches: 0,
    checklistWarnings: 0,
  };
}

function summarizeCounts(skillsScanned, findings) {
  const counts = emptyCounts();
  counts.skillsScanned = skillsScanned;
  for (const finding of findings) {
    if (finding.severity === 'error') counts.errors += 1;
    if (finding.severity === 'warn') counts.warnings += 1;
    if (finding.code === 'substitution') counts.substitutions += 1;
    if (finding.code === 'codex-key') counts.codexKeys += 1;
    if (finding.code === 'missing-codex-copy') counts.missingCodexCopies += 1;
    if (finding.code === 'copy-name-mismatch') counts.copyNameMismatches += 1;
    if (CHECKLIST_CODES.has(finding.code)) counts.checklistWarnings += 1;
  }
  return counts;
}

function formatSummary(skillCount, counts) {
  let msg = `Validated host compatibility for ${skillCount} skill directories`;
  const extras = [];
  if (counts.errors > 0) extras.push(`${counts.errors} error${counts.errors === 1 ? '' : 's'}`);
  if (counts.warnings > 0) extras.push(`${counts.warnings} warning${counts.warnings === 1 ? '' : 's'}`);
  if (extras.length > 0) msg += ` (${extras.join(', ')})`;
  return msg;
}

function reportFindings(result, stdout, stderr) {
  if (result.skipped) {
    stdout.write(`${result.message}\n`);
    return;
  }

  if (result.inventory) {
    stdout.write(`${result.message}\n`);
    return;
  }

  for (const finding of result.findings) {
    const line = `${finding.severity === 'error' ? 'ERROR' : 'WARN'}: ${finding.message}\n`;
    if (finding.severity === 'error') stderr.write(line);
    else stderr.write(line);
  }
  stdout.write(`${result.message}\n`);
}

function run(argv = process.argv.slice(2), options = {}) {
  const stdout = options.stdout || process.stdout;
  const stderr = options.stderr || process.stderr;

  try {
    const args = parseArgs(argv);
    const result = validateSkillHostCompat({
      root: options.root || args.root,
      inventory: args.inventory,
      strictChecklist: args.strictChecklist,
    });
    reportFindings(result, stdout, stderr);
    return result.ok ? 0 : 1;
  } catch (error) {
    stderr.write(`ERROR: ${error.message}\n`);
    return 1;
  }
}

if (require.main === module) {
  process.exit(run());
}

module.exports = {
  ALLOWED_CODEX_FRONTMATTER_KEYS,
  CLAUDE_SUBSTITUTION_PATTERNS,
  extractTopLevelList,
  findExecutableFences,
  parseArgs,
  run,
  validateSkillHostCompat,
};
