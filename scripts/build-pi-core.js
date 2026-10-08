#!/usr/bin/env node
/**
 * Regenerate pi/core/ deterministically from manifests/pi-core.json.
 *
 * The profile is a curated, Pi-native, skills+prompts-only package:
 *   pi/core/package.json  - { name: "ecc-pi-core", version: <root VERSION>, license: MIT,
 *                             keywords: ["pi-package", "skills"],
 *                             pi: { skills: ["./skills"], prompts: ["./commands"] } }
 *   pi/core/LICENSE       - copy of the root LICENSE
 *   pi/core/README.md     - short generated overview
 *   pi/core/CURATION.md   - every excluded skill/command with its reason
 *   pi/core/skills/       - curated skill directories (council renamed to ecc-council)
 *   pi/core/commands/     - curated prompt command files
 *
 * Safety checks (build fails if violated; semantics documented in
 * manifests/pi-core.json safety.semantics):
 *   - no callable http(s) endpoints (documentation links allowed via the host
 *     allowlist in manifests/pi-core.json, plus localhost/example placeholders
 *     and non-FQDN internal hostnames)
 *   - no runtime download-and-run forms: pipe-to-shell (curl|sh, wget|sh) or
 *     fetch-and-run npx (-y/--yes, pkg@version, create-*, degit, skills add);
 *     skills whose own operation downloads tooling are excluded in the manifest
 *   - no secrets or tokens
 *   - no absolute per-user home paths (/Users/..., /home/..., C:\Users\...)
 *   - no symlinks
 *   - every SKILL.md has frontmatter with name == directory name and a description
 *   - no duplicate skill names
 *
 * Scoped exceptions for incidental mentions (anti-pattern warnings, detection
 * examples) live in manifests/pi-core.json safety.scanAllowlist with a reason.
 *
 * Usage: node scripts/build-pi-core.js [--check]
 *   --check   rebuild and verify pi/core is already up to date (exit 1 on drift)
 */

'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const MANIFEST_PATH = path.join(ROOT, 'manifests', 'pi-core.json');
const manifest = JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf8'));

const PROFILE_DIR = path.join(ROOT, manifest.profile.dir);
const SKILLS_SRC = path.join(ROOT, 'skills');
const COMMANDS_SRC = path.join(ROOT, 'commands');
const VERSION = fs.readFileSync(path.join(ROOT, 'VERSION'), 'utf8').trim();
const CHECK_MODE = process.argv.includes('--check');

const violations = [];
function fail(msg) {
  violations.push(msg);
}

// ---------- partition completeness -----------------------------------------
// Every on-disk skill dir and command file must be classified exactly once in
// the manifest, so new content cannot silently bypass curation.
{
  const onDiskSkills = fs.readdirSync(SKILLS_SRC, { withFileTypes: true })
    .filter(e => e.isDirectory()).map(e => e.name);
  const known = new Set([...manifest.skills.include, ...Object.keys(manifest.skills.exclude)]);
  for (const dir of onDiskSkills) {
    if (!known.has(dir)) fail(`skills/${dir} is not classified in manifests/pi-core.json`);
  }
  for (const name of known) {
    if (!onDiskSkills.includes(name)) fail(`manifests/pi-core.json references missing skills/${name}`);
  }
  const onDiskCommands = fs.readdirSync(COMMANDS_SRC).filter(f => f.endsWith('.md'));
  const knownCmd = new Set([...manifest.commands.include, ...Object.keys(manifest.commands.exclude)]);
  for (const f of onDiskCommands) {
    if (!knownCmd.has(f)) fail(`commands/${f} is not classified in manifests/pi-core.json`);
  }
  for (const f of knownCmd) {
    if (!onDiskCommands.includes(f)) fail(`manifests/pi-core.json references missing commands/${f}`);
  }
}

// ---------- deterministic copy ----------------------------------------------
/** Recursively list files under dir, sorted; reject symlinks. */
function listFiles(dir, base) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    const full = path.join(dir, entry.name);
    const rel = base ? `${base}/${entry.name}` : entry.name;
    if (entry.isSymbolicLink()) {
      fail(`symlink found in profile source: ${rel}`);
    } else if (entry.isDirectory()) {
      out.push(...listFiles(full, rel));
    } else if (entry.isFile()) {
      out.push({ full, rel });
    }
  }
  return out;
}

function copyFile(src, dest) {
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.copyFileSync(src, dest);
}

/** Parse YAML frontmatter minimally: returns { name, description } or null. */
function parseFrontmatter(text) {
  const m = text.replace(/^\uFEFF/, '').match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/);
  if (!m) return null;
  const name = (m[1].match(/^name:\s*["']?(.+?)["']?\s*$/m) || [])[1];
  const description = (m[1].match(/^description:\s*["']?([\s\S]+?)["']?\s*$/m) || [])[1];
  return { name: name || '', description: description || '', raw: m[1] };
}

// ---------- rebuild pi/core --------------------------------------------------
const tmpDir = path.join(ROOT, 'pi', '.core-build-tmp');
fs.rmSync(tmpDir, { recursive: true, force: true });
fs.mkdirSync(tmpDir, { recursive: true });

const rename = manifest.skills.rename || {};
const skillDescriptions = [];
const seenNames = new Map();

for (const dirName of manifest.skills.include) {
  const srcDir = path.join(SKILLS_SRC, dirName);
  const outName = rename[dirName] || dirName;
  const destDir = path.join(tmpDir, 'skills', outName);
  const skillMd = path.join(srcDir, 'SKILL.md');
  if (!fs.existsSync(skillMd)) {
    fail(`skills/${dirName}/SKILL.md is missing`);
    continue;
  }
  const text = fs.readFileSync(skillMd, 'utf8');
  const fm = parseFrontmatter(text);
  if (!fm) {
    fail(`skills/${dirName}/SKILL.md has no parseable frontmatter`);
  } else {
    if (fm.name !== dirName) fail(`skills/${dirName}/SKILL.md frontmatter name "${fm.name}" != directory name`);
    if (!fm.description) fail(`skills/${dirName}/SKILL.md frontmatter has no description`);
    skillDescriptions.push(fm.description);
    if (seenNames.has(outName)) fail(`duplicate skill name in profile: ${outName} (skills/${dirName} and skills/${seenNames.get(outName)})`);
    seenNames.set(outName, dirName);
  }
  for (const f of listFiles(srcDir, '')) {
    let content = null;
    if (rename[dirName] && f.rel === 'SKILL.md') {
      // Rename the skill inside pi/core only; the root skill keeps its name.
      content = fs.readFileSync(f.full, 'utf8')
        .replace(/^name:\s*["']?[^\n"']+["']?\s*$/m, `name: ${outName}`);
      fs.mkdirSync(path.dirname(path.join(destDir, f.rel)), { recursive: true });
      fs.writeFileSync(path.join(destDir, f.rel), content);
    } else {
      copyFile(f.full, path.join(destDir, f.rel));
    }
  }
}

for (const file of manifest.commands.include) {
  copyFile(path.join(COMMANDS_SRC, file), path.join(tmpDir, 'commands', file));
}

copyFile(path.join(ROOT, 'LICENSE'), path.join(tmpDir, 'LICENSE'));

const profilePackage = {
  name: manifest.profile.packageName,
  version: VERSION,
  license: manifest.profile.license,
  keywords: manifest.profile.keywords,
  pi: { skills: ['./skills'], prompts: ['./commands'] },
};
fs.writeFileSync(path.join(tmpDir, 'package.json'), JSON.stringify(profilePackage, null, 2) + '\n');

const skillCount = manifest.skills.include.length;
const commandCount = manifest.commands.include.length;
const descChars = skillDescriptions.reduce((n, d) => n + d.length, 0);

fs.writeFileSync(path.join(tmpDir, 'README.md'), `# ecc-pi-core

A curated, Pi-native profile of ECC: ${skillCount} portable
engineering skills and ${commandCount} pure prompt-workflow commands, with no extensions,
no hooks, no runtime downloads, and no network or SaaS dependencies.

## Contents

- \`skills/\` - language, framework, testing/TDD, code review, security review,
  planning, refactoring, docs, and git/PR workflow skills.
- \`commands/\` - prompt commands that are pure prompt workflows.
- \`CURATION.md\` - every excluded skill and command with its reason.

## Use

Copy this directory into your project (or pin a release tarball) and load it with the
Pi coding agent:

\`\`\`sh
pi --no-extensions --extension pi/core
\`\`\`

From the ECC repository root, run the offline load test used in CI
(requires the Pi CLI on PATH):

\`\`\`sh
node scripts/ci/pi-core-load-test.js
\`\`\`

The test loads skills and prompt templates explicitly, sends the RPC
\`get_commands\` request, and verifies that all ${commandCount} curated commands load.

## Regenerate

\`pi/core\` is generated from \`manifests/pi-core.json\` and committed so release
tarballs contain it verbatim. After changing the manifest or any included source
content, run:

\`\`\`sh
node scripts/build-pi-core.js
\`\`\`

and commit the result. CI verifies the committed profile is up to date.
`);

{
  const lines = [];
  lines.push('# Curation');
  lines.push('');
  lines.push(`pi/core includes ${skillCount} of ${Object.keys(manifest.skills.exclude).length + skillCount} skills ` +
    `and ${commandCount} of ${Object.keys(manifest.commands.exclude).length + commandCount} commands from the root of ECC.`);
  lines.push('Everything excluded is listed here with its reason.');
  lines.push('');
  lines.push('## Rules');
  lines.push('');
  lines.push('Include: ' + manifest.curationRules.include.join('; ') + '.');
  lines.push('');
  lines.push('Exclude anything that:');
  for (const rule of manifest.curationRules.exclude) lines.push(`- ${rule}`);
  lines.push('');
  lines.push('## Excluded skills');
  lines.push('');
  lines.push('| Skill | Reason |');
  lines.push('|---|---|');
  for (const [name, reason] of Object.entries(manifest.skills.exclude)) {
    lines.push(`| \`${name}\` | ${reason.replace(/\|/g, '\\|')} |`);
  }
  lines.push('');
  lines.push('## Excluded commands');
  lines.push('');
  lines.push('| Command | Reason |');
  lines.push('|---|---|');
  for (const [file, reason] of Object.entries(manifest.commands.exclude)) {
    lines.push(`| \`${file.replace(/\.md$/, '')}\` | ${reason.replace(/\|/g, '\\|')} |`);
  }
  lines.push('');
  lines.push('## Renames');
  lines.push('');
  for (const [from, to] of Object.entries(rename)) {
    lines.push(`- \`${from}\` is shipped as \`${to}\` inside pi/core (the root skill keeps its original name).`);
  }
  lines.push('');
  fs.writeFileSync(path.join(tmpDir, 'CURATION.md'), lines.join('\n'));
}

// ---------- safety scans -----------------------------------------------------
//
// Scanner semantics (mirrors the curation rules in manifests/pi-core.json):
//   - URLs: documentation links are allowed via safety.urlAllowlistHosts.
//     Placeholder hosts (example.com/org/net and subdomains) and non-FQDN
//     internal hostnames (localhost, docker service names like "api" or "db")
//     are always allowed; they are not callable endpoints.
//   - Runtime downloads: pipe-to-shell (curl|sh, wget|sh) and fetch-and-run
//     npx forms (-y/--yes, pkg@version, create-*, degit, "skills add") fail.
//     Local-first `npx <tool>` (jest, tsc, playwright, prisma, ...) and
//     standard project dependency installation (pip install <dep>, npm i) are
//     the reader's own project workflow, not the profile downloading code to
//     run itself, so they are allowed; skills whose own operation downloads
//     tooling are excluded in the manifest instead (see CURATION.md).
//   - Home paths: absolute per-user paths (/Users/..., /home/..., C:\Users\...)
//     fail. Portable tilde references (~/.cache/...) are user-agnostic and OK.
const defaultHosts = new Set(manifest.safety.defaultAllowedHosts || []);
const allowHosts = new Set([...(manifest.safety.urlAllowlistHosts || []), ...defaultHosts]);
const scanAllowlist = manifest.safety.scanAllowlist || [];
const PLACEHOLDER_SUFFIXES = ['.example.com', '.example.org', '.example.net'];

function isAllowlisted(relPath, line) {
  return scanAllowlist.some(e => relPath === e.path && line.includes(e.contains));
}

function hostAllowed(hostname) {
  if (!hostname) return false;
  if (allowHosts.has(hostname)) return true;
  if (!hostname.includes('.')) return true; // localhost, docker service names, placeholders
  return PLACEHOLDER_SUFFIXES.some(s => hostname.endsWith(s));
}

const URL_RE = /https?:\/\/([A-Za-z0-9._-]+)(?::\d+)?[^\s)\]"'`<>}]*/g;
const SECRET_RES = [
  { re: /AKIA[0-9A-Z]{16}/, label: 'AWS access key' },
  { re: /ghp_[A-Za-z0-9]{20,}/, label: 'GitHub PAT' },
  { re: /github_pat_[A-Za-z0-9_]{22,}/, label: 'GitHub fine-grained PAT' },
  { re: /sk-[A-Za-z0-9_-]{20,}/, label: 'OpenAI-style key' },
  { re: /xox[baprs]-[A-Za-z0-9-]{10,}/, label: 'Slack token' },
  { re: /AIza[0-9A-Za-z_-]{35}/, label: 'Google API key' },
  { re: /-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----/, label: 'private key block' },
  { re: /eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/, label: 'JWT' },
];
const INSTALL_RES = [
  { re: /\b(?:curl|wget)\b[^\n|]*\|\s*(?:sudo\s+)?(?:ba|z|fi)?sh\b/, label: 'pipe-to-shell (curl|sh / wget|sh)' },
  { re: /\bnpx\s+(?:-y\b|--yes\b)/, label: 'npx -y/--yes (fetch-and-run)' },
  { re: /\bnpx\s+(?:--\S+\s+)*[A-Za-z@][^\s]*@\d/, label: 'npx pkg@version (fetch-and-run)' },
  { re: /\bnpx\s+(?:--\S+\s+)*(?:create-[a-z-]+|degit\b|skills\s+add\b)/, label: 'npx scaffold/fetch form' },
  { re: /\bpipx\s+install\b/, label: 'pipx install' },
];
const HOME_RES = [
  { re: /\/Users\/[^\s)"'`\]<>|]+/, label: 'macOS home path' },
  { re: /\/home\/[^\s)"'`\]<>|]+/, label: 'Linux home path' },
  { re: /[A-Za-z]:\\Users\\[^\s)"'`\]<>|]+/, label: 'Windows home path' },
];
const GENERATED_FILES = new Set(['package.json', 'README.md', 'CURATION.md']);

function scanTextFile(relPath, text) {
  if (GENERATED_FILES.has(relPath)) return; // generated from the manifest itself
  const lines = text.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const at = `${relPath}:${i + 1}`;
    const allowlisted = isAllowlisted(relPath, line);
    for (const m of line.matchAll(URL_RE)) {
      if (!hostAllowed(m[1]) && !allowlisted) {
        fail(`${at}: non-allowlisted URL host ${m[1]} (${m[0].slice(0, 100)})`);
      }
    }
    if (allowlisted) continue;
    for (const { re, label } of SECRET_RES) {
      if (re.test(line)) fail(`${at}: possible secret (${label})`);
    }
    for (const { re, label } of INSTALL_RES) {
      if (re.test(line)) fail(`${at}: runtime download pattern (${label})`);
    }
    for (const { re, label } of HOME_RES) {
      if (re.test(line)) fail(`${at}: absolute home path (${label})`);
    }
  }
}

for (const f of listFiles(tmpDir, '')) {
  const rel = f.rel;
  const buf = fs.readFileSync(f.full);
  if (buf.includes(0)) continue; // binary file: nothing textual to scan
  scanTextFile(rel, buf.toString('utf8'));
}

// ---------- emit report -------------------------------------------------------
const report = [
  `pi/core: ${skillCount} skills, ${commandCount} commands`,
  `skill description text: ${descChars} characters (target: under ~40000)`,
];
if (descChars > 42000) fail(`skill description text too large: ${descChars} characters`);

if (violations.length) {
  fs.rmSync(tmpDir, { recursive: true, force: true });
  console.error('pi/core build FAILED:');
  for (const v of violations) console.error('  - ' + v);
  console.error(report.join('\n'));
  process.exit(1);
}

if (CHECK_MODE) {
  // Compare tmpDir against the committed profile without touching it.
  const committed = listFiles(PROFILE_DIR, '').map(f => f.rel).sort();
  const built = listFiles(tmpDir, '').map(f => f.rel).sort();
  let drift = false;
  if (committed.join('\n') !== built.join('\n')) {
    console.error('pi/core file list drift:');
    const cSet = new Set(committed), bSet = new Set(built);
    for (const f of committed) if (!bSet.has(f)) console.error('  only committed: ' + f);
    for (const f of built) if (!cSet.has(f)) console.error('  only built: ' + f);
    drift = true;
  } else {
    for (const rel of committed) {
      const a = fs.readFileSync(path.join(PROFILE_DIR, rel));
      const b = fs.readFileSync(path.join(tmpDir, rel));
      if (!a.equals(b)) { console.error('pi/core content drift: ' + rel); drift = true; }
    }
  }
  fs.rmSync(tmpDir, { recursive: true, force: true });
  if (drift) {
    console.error('Run: node scripts/build-pi-core.js');
    process.exit(1);
  }
  console.log('pi/core is up to date.');
  console.log(report.join('\n'));
  process.exit(0);
}

fs.rmSync(PROFILE_DIR, { recursive: true, force: true });
fs.renameSync(tmpDir, PROFILE_DIR);
console.log(report.join('\n'));
console.log(`wrote ${manifest.profile.dir}/`);
