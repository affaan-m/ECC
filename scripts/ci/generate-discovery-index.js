#!/usr/bin/env node
/**
 * Publish the discovery artifacts that make every ECC surface discoverable.
 *
 * ECC ships hundreds of skills, agents, and commands but exposes only a
 * handful of URLs, so search engines and answer engines never see them. This
 * generator emits the files the website and LLM crawlers need:
 *
 *   docs/DISCOVERY-INDEX.json              index the site builds one page per entry from
 *   llms.txt                       short agent-readable overview (llmstxt.org)
 *   docs/discovery/llms-full.txt     every surface, one line each
 *   docs/discovery/sitemap-discovery.xml  sitemap fragment for the generated pages
 *
 * Usage:
 *   node scripts/ci/generate-discovery-index.js            print a summary
 *   node scripts/ci/generate-discovery-index.js --json     print the index
 *   node scripts/ci/generate-discovery-index.js --write    write the artifacts
 *   node scripts/ci/generate-discovery-index.js --check    fail if stale
 */

'use strict';

const fs = require('fs');
const path = require('path');

const {
  ROOT,
  SITE_ORIGIN,
  buildCatalog,
  countByType,
} = require('../lib/discovery-index');

const OUTPUTS = Object.freeze({
  catalog: path.join(ROOT, 'docs', 'DISCOVERY-INDEX.json'),
  llms: path.join(ROOT, 'llms.txt'),
  llmsFull: path.join(ROOT, 'docs', 'discovery', 'llms-full.txt'),
  sitemap: path.join(ROOT, 'docs', 'discovery', 'sitemap-discovery.xml'),
});

const SECTIONS = Object.freeze([
  { type: 'skill', title: 'Skills', blurb: 'Task playbooks the agent loads on demand.' },
  { type: 'agent', title: 'Agents', blurb: 'Specialist subagents for delegated work.' },
  { type: 'command', title: 'Commands', blurb: 'Slash-command entry points.' },
]);

function showHelp(exitCode = 0) {
  console.log(`
Generate the ECC discovery artifacts (index, llms.txt, sitemap fragment)

Usage:
  node scripts/ci/generate-discovery-index.js [--json|--write|--check]
`);

  process.exit(exitCode);
}

function parseArgs(argv) {
  return argv.slice(2).reduce((parsed, arg) => {
    if (arg === '--json') return { ...parsed, json: true };
    if (arg === '--write') return { ...parsed, write: true };
    if (arg === '--check') return { ...parsed, check: true };
    if (arg === '--help' || arg === '-h') return { ...parsed, help: true };
    throw new Error(`Unknown argument: ${arg}`);
  }, { json: false, write: false, check: false, help: false });
}

function escapeXml(value) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function renderCatalogJson(entries) {
  return `${JSON.stringify({
    generator: 'scripts/ci/generate-discovery-index.js',
    origin: SITE_ORIGIN,
    counts: countByType(entries),
    total: entries.length,
    entries,
  }, null, 2)}\n`;
}

function renderEntryLine(entry) {
  return `- [${entry.slug}](${entry.url}): ${entry.summary}`;
}

function renderLlmsTxt(entries) {
  const counts = countByType(entries);

  return `# ECC

> ECC is an MIT-licensed agent harness operating system for Claude Code, Codex,
> Cursor, OpenCode, and other coding agents. It installs a repeatable engineering
> loop - plan, test, implement, review, verify, remember, improve - as skills,
> agents, commands, hooks, and rules instead of ad-hoc prompting.

Install: \`npx ecc-universal setup\`

## Overview

- [Repository](https://github.com/affaan-m/ECC): source, ${counts.skill} skills, ${counts.agent} agents, ${counts.command} commands.
- [Website](${SITE_ORIGIN}): install paths, pricing, and platform support.
- [Full catalog](${SITE_ORIGIN}/llms-full.txt): every skill, agent, and command with a one-line summary.
- [Machine index](https://github.com/affaan-m/ECC/blob/main/docs/DISCOVERY-INDEX.json): the same catalog as JSON.

## Getting started

- [Install guide](https://github.com/affaan-m/ECC#install-ecc): npm setup and native plugin paths.
- [Command reference](https://github.com/affaan-m/ECC/blob/main/COMMANDS-QUICK-REF.md): every command in one table.
- [Troubleshooting](https://github.com/affaan-m/ECC/blob/main/TROUBLESHOOTING.md): install and runtime problems.
- [Contributing](https://github.com/affaan-m/ECC/blob/main/CONTRIBUTING.md): file formats and review process.

## Surfaces

${SECTIONS.map(section => `- ${section.title} (${counts[section.type] || 0}): ${section.blurb}`).join('\n')}

## Optional

- [Security policy](https://github.com/affaan-m/ECC/blob/main/SECURITY.md): reporting and AgentShield scanning.
- [Roadmap](https://github.com/affaan-m/ECC/blob/main/ROADMAP.md): what ships next.
- [Adopters](https://github.com/affaan-m/ECC/blob/main/ADOPTERS.md): teams running ECC.
`;
}

function renderLlmsFull(entries) {
  const sections = SECTIONS.map(section => {
    const lines = entries
      .filter(entry => entry.type === section.type)
      .map(renderEntryLine)
      .join('\n');

    return `## ${section.title}\n\n${section.blurb}\n\n${lines}\n`;
  });

  return `# ECC full catalog\n\n> Every ECC skill, agent, and command with a one-line summary.\n\n${sections.join('\n')}`;
}

function renderSitemap(entries) {
  const urls = entries
    .map(entry => `  <url>\n    <loc>${escapeXml(entry.url)}</loc>\n    <changefreq>monthly</changefreq>\n    <priority>0.6</priority>\n  </url>`)
    .join('\n');

  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>\n`;
}

function buildArtifacts(entries) {
  return Object.freeze({
    [OUTPUTS.catalog]: renderCatalogJson(entries),
    [OUTPUTS.llms]: renderLlmsTxt(entries),
    [OUTPUTS.llmsFull]: renderLlmsFull(entries),
    [OUTPUTS.sitemap]: renderSitemap(entries),
  });
}

function writeArtifacts(artifacts) {
  Object.entries(artifacts).forEach(([filePath, contents]) => {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, contents, 'utf8');
  });
}

function findStale(artifacts) {
  return Object.entries(artifacts)
    .filter(([filePath, contents]) => (
      !fs.existsSync(filePath) || fs.readFileSync(filePath, 'utf8') !== contents
    ))
    .map(([filePath]) => path.relative(ROOT, filePath));
}

function main() {
  const args = parseArgs(process.argv);
  if (args.help) {
    showHelp();
  }

  const entries = buildCatalog();
  const artifacts = buildArtifacts(entries);

  if (args.json) {
    console.log(renderCatalogJson(entries).trimEnd());
    return;
  }

  if (args.write) {
    writeArtifacts(artifacts);
    console.log(`Wrote ${Object.keys(artifacts).length} discovery artifacts for ${entries.length} surfaces.`);
    return;
  }

  if (args.check) {
    const stale = findStale(artifacts);
    if (stale.length > 0) {
      console.error('[discovery] Stale artifacts. Run: node scripts/ci/generate-discovery-index.js --write');
      stale.forEach(file => console.error(`  - ${file}`));
      process.exit(1);
    }

    console.log('[discovery] Catalog artifacts are up to date.');
    return;
  }

  const counts = countByType(entries);
  console.log(`ECC discovery index: ${entries.length} surfaces`);
  SECTIONS.forEach(section => console.log(`  ${section.title}: ${counts[section.type] || 0}`));
}

if (require.main === module) {
  try {
    main();
  } catch (error) {
    console.error(`[discovery] ${error.message}`);
    process.exit(1);
  }
}

module.exports = {
  OUTPUTS,
  buildArtifacts,
  renderLlmsTxt,
  renderLlmsFull,
  renderSitemap,
  findStale,
};
