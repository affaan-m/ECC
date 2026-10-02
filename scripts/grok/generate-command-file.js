#!/usr/bin/env node
'use strict';

/**
 * Generate a Grok slash-command markdown file that keeps a YAML description.
 * Codex prompt generation strips frontmatter because ~/.codex/prompts do not
 * use it; Grok command discovery does.
 */

const fs = require('fs');

function readFlag(args, name) {
  const index = args.indexOf(name);
  if (index === -1) return null;
  const value = args[index + 1];
  if (value === undefined || value.startsWith('--')) return null;
  return value;
}

function stripFrontmatter(text) {
  const normalized = String(text).replace(/^\uFEFF/, '');
  if (!normalized.startsWith('---')) {
    return { frontmatter: '', body: normalized };
  }
  const match = normalized.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/);
  if (!match) {
    return { frontmatter: '', body: normalized };
  }
  return {
    frontmatter: match[1],
    body: normalized.slice(match[0].length).replace(/^\r?\n/, ''),
  };
}

function parseDescription(frontmatter) {
  const lines = String(frontmatter).split(/\r?\n/);
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    const simple = line.match(/^description:\s*(.*)$/);
    if (!simple) continue;
    let raw = simple[1].trim();
    if (raw === '|' || raw === '>' || raw === '|-') {
      const block = [];
      for (let j = i + 1; j < lines.length; j += 1) {
        if (!/^\s+/.test(lines[j]) && lines[j] !== '') break;
        block.push(lines[j].replace(/^\s{2}/, ''));
      }
      return block.join(' ').trim();
    }
    if ((raw.startsWith('"') && raw.endsWith('"')) || (raw.startsWith("'") && raw.endsWith("'"))) {
      raw = raw.slice(1, -1);
    }
    return raw;
  }
  return '';
}

function yamlQuoted(value) {
  return JSON.stringify(String(value ?? ''));
}

function renderGrokCommand({ name, description, body }) {
  const desc = description && description.trim()
    ? description.trim()
    : `ECC command /${name}`;
  return [
    '---',
    `name: ${name}`,
    `description: ${yamlQuoted(desc)}`,
    '---',
    '',
    String(body || '').replace(/^\uFEFF/, '').replace(/^\r?\n/, ''),
  ].join('\n');
}

function generateFromSource({ srcPath, outPath, name }) {
  const source = fs.readFileSync(srcPath, 'utf8');
  const parsed = stripFrontmatter(source);
  const content = renderGrokCommand({
    name,
    description: parseDescription(parsed.frontmatter),
    body: parsed.body,
  });
  fs.writeFileSync(outPath, content);
  return content;
}

function generateFromBody({ outPath, name, description, body }) {
  const content = renderGrokCommand({ name, description, body });
  fs.writeFileSync(outPath, content);
  return content;
}

function main(argv = process.argv.slice(2)) {
  const srcPath = readFlag(argv, '--src');
  const outPath = readFlag(argv, '--out');
  const name = readFlag(argv, '--name');
  const description = readFlag(argv, '--description');
  if (!outPath || !name) {
    process.stderr.write(
      'Usage: generate-command-file.js --out <file> --name <name> [--src <file> | --description <text> --body-file <file|- >]\n'
    );
    process.exit(1);
  }
  if (srcPath) {
    generateFromSource({ srcPath, outPath, name });
    return;
  }
  const bodyFile = readFlag(argv, '--body-file');
  const body = bodyFile === '-'
    ? fs.readFileSync(0, 'utf8')
    : bodyFile
      ? fs.readFileSync(bodyFile, 'utf8')
      : '';
  generateFromBody({ outPath, name, description: description || '', body });
}

module.exports = {
  generateFromBody,
  generateFromSource,
  parseDescription,
  renderGrokCommand,
  stripFrontmatter,
  yamlQuoted,
};

if (require.main === module) {
  try {
    main();
  } catch (error) {
    process.stderr.write(`[ecc-commands] ERROR: ${error.message}\n`);
    process.exit(1);
  }
}
