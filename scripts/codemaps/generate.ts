#!/usr/bin/env node
/**
 * scripts/codemaps/generate.ts
 *
 * Codemap Generator for everything-claude-code (ECC)
 *
 * Scans the current working directory and generates architectural
 * codemap documentation under docs/CODEMAPS/ as specified by the
 * doc-updater agent.
 *
 * Usage:
 *   npx tsx scripts/codemaps/generate.ts [srcDir]
 *
 * Output:
 *   docs/CODEMAPS/INDEX.md
 *   docs/CODEMAPS/frontend.md
 *   docs/CODEMAPS/backend.md
 *   docs/CODEMAPS/database.md
 *   docs/CODEMAPS/integrations.md
 *   docs/CODEMAPS/workers.md
 */

import fs from 'fs';
import path from 'path';

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const ROOT = process.cwd();
const SRC_DIR = process.argv[2] ? path.resolve(process.argv[2]) : ROOT;
const OUTPUT_DIR = path.join(ROOT, 'docs', 'CODEMAPS');
const TODAY = new Date().toISOString().split('T')[0];

// Patterns used to classify files into codemap areas
const AREA_PATTERNS: Record<string, RegExp[]> = {
  frontend: [
    /(?:^|\/)(app|pages|components|hooks|contexts|ui|views|layouts|styles)\//i,
    /\.(tsx|jsx|css|scss|sass|less|vue|svelte)$/i,
  ],
  backend: [
    /(?:^|\/)(api|routes|controllers|middleware|server|services|handlers)\//i,
    /\.(route|controller|handler|middleware|service)\.(ts|js)$/i,
  ],
  database: [
    /(?:^|\/)(models|schemas|migrations|prisma|drizzle|db|database|repositories)\//i,
    /\.(model|schema|migration|seed)\.(ts|js)$/i,
    /prisma\/schema\.prisma$/,
    /schema\.sql$/,
  ],
  integrations: [
    /(?:^|\/)(integrations?|third-party|external|plugins?|adapters?|connectors?)\//i,
    /\.(integration|adapter|connector)\.(ts|js)$/i,
  ],
  workers: [
    /(?:^|\/)(workers?|jobs?|queues?|tasks?|cron|background)\//i,
    /\.(worker|job|queue|task|cron)\.(ts|js)$/i,
  ],
};

// ---------------------------------------------------------------------------
// File System Helpers
// ---------------------------------------------------------------------------

/** Recursively collect all files under a directory, skipping common noise dirs. */
function walkDir(dir: string, results: string[] = []): string[] {
  const SKIP = new Set([
    'node_modules', '.git', '.next', '.nuxt', 'dist', 'build', 'out',
    '.turbo', 'coverage', '.cache', '__pycache__', '.venv', 'venv',
  ]);

  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return results;
  }

  for (const entry of entries) {
    if (SKIP.has(entry.name)) continue;
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walkDir(fullPath, results);
    } else if (entry.isFile()) {
      results.push(fullPath);
    }
  }
  return results;
}

/** Return path relative to ROOT, always using forward slashes. */
function rel(p: string): string {
  return path.relative(ROOT, p).replace(/\\/g, '/');
}

// ---------------------------------------------------------------------------
// Analysis
// ---------------------------------------------------------------------------

interface AreaInfo {
  name: string;
  files: string[];
  entryPoints: string[];
  directories: string[];
}

function classifyFiles(allFiles: string[]): Record<string, AreaInfo> {
  const areas: Record<string, AreaInfo> = {
    frontend:     { name: 'Frontend', files: [], entryPoints: [], directories: [] },
    backend:      { name: 'Backend/API', files: [], entryPoints: [], directories: [] },
    database:     { name: 'Database', files: [], entryPoints: [], directories: [] },
    integrations: { name: 'Integrations', files: [], entryPoints: [], directories: [] },
    workers:      { name: 'Workers', files: [], entryPoints: [], directories: [] },
  };

  for (const file of allFiles) {
    const relPath = rel(file);
    for (const [area, patterns] of Object.entries(AREA_PATTERNS)) {
      if (patterns.some((p) => p.test(relPath))) {
        areas[area].files.push(relPath);
        break;
      }
    }
  }

  // Derive unique directories and entry points per area
  for (const area of Object.values(areas)) {
    const dirs = new Set(area.files.map((f) => path.dirname(f)));
    area.directories = [...dirs].sort();

    area.entryPoints = area.files
      .filter((f) => /index\.(ts|tsx|js|jsx)$/.test(f) || /main\.(ts|tsx|js|jsx)$/.test(f))
      .slice(0, 10);
  }

  return areas;
}

/** Count lines in a file (returns 0 on error). */
function lineCount(p: string): number {
  try {
    const content = fs.readFileSync(p, 'utf8');
    return content.split('\n').length;
  } catch {
    return 0;
  }
}

/** Build a simple directory tree ASCII diagram (max 3 levels deep). */
function buildTree(dir: string, prefix = '', depth = 0): string {
  if (depth > 2) return '';
  const SKIP = new Set(['node_modules', '.git', 'dist', 'build', '.next', 'coverage']);

  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return '';
  }

  const dirs = entries.filter((e) => e.isDirectory() && !SKIP.has(e.name));
  const files = entries.filter((e) => e.isFile());

  let result = '';
  const items = [...dirs, ...files];
  items.forEach((entry, i) => {
    const isLast = i === items.length - 1;
    const connector = isLast ? '└── ' : '├── ';
    result += `${prefix}${connector}${entry.name}\n`;
    if (entry.isDirectory()) {
      const newPrefix = prefix + (isLast ? '    ' : '│   ');
      result += buildTree(path.join(dir, entry.name), newPrefix, depth + 1);
    }
  });
  return result;
}

// ---------------------------------------------------------------------------
// Markdown Generators
// ---------------------------------------------------------------------------

function generateAreaDoc(areaKey: string, area: AreaInfo, allFiles: string[]): string {
  const fileCount = area.files.length;
  const totalLines = area.files.reduce((sum, f) => sum + lineCount(path.join(ROOT, f)), 0);

  const entrySection = area.entryPoints.length > 0
    ? area.entryPoints.map((e) => `- \`${e}\``).join('\n')
    : '- *(no index/main entry points detected)*';

  const dirSection = area.directories.slice(0, 20)
    .map((d) => `- \`${d}/\``)
    .join('\n') || '- *(no dedicated directories detected)*';

  const fileSection = area.files.slice(0, 30)
    .map((f) => `| \`${f}\` | ${lineCount(path.join(ROOT, f))} |`)
    .join('\n');

  const moreFiles = area.files.length > 30
    ? `\n*...and ${area.files.length - 30} more files*`
    : '';

  return `# ${area.name} Codemap

**Last Updated:** ${TODAY}
**Total Files:** ${fileCount}
**Total Lines:** ${totalLines}

## Entry Points

${entrySection}

## Architecture

\`\`\`
${area.name} Directory Structure
${dirSection.replace(/- `/g, '').replace(/`\/$/gm, '/')}
\`\`\`

## Key Modules

| File | Lines |
|------|-------|
${fileSection}${moreFiles}

## Data Flow

> Detected from file patterns. Review individual files for detailed data flow.

## External Dependencies

> Run \`npx jsdoc2md src/**/*.ts\` to extract JSDoc and identify external dependencies.

## Related Areas

- [INDEX](./INDEX.md) — Full overview
- [Frontend](./frontend.md)
- [Backend/API](./backend.md)
- [Database](./database.md)
- [Integrations](./integrations.md)
- [Workers](./workers.md)
`;
}

function generateIndex(areas: Record<string, AreaInfo>, allFiles: string[]): string {
  const totalFiles = allFiles.length;
  const areaRows = Object.entries(areas)
    .map(([key, area]) => `| [${area.name}](./${key}.md) | ${area.files.length} files | ${area.directories.slice(0, 3).map((d) => `\`${d}\``).join(', ') || '—'} |`)
    .join('\n');

  const topLevelTree = buildTree(SRC_DIR);

  return `# Codebase Overview — CODEMAPS Index

**Last Updated:** ${TODAY}
**Root:** \`${rel(SRC_DIR) || '.'}\`
**Total Files Scanned:** ${totalFiles}

## Areas

| Area | Size | Key Directories |
|------|------|-----------------|
${areaRows}

## Repository Structure

\`\`\`
${rel(SRC_DIR) || path.basename(SRC_DIR)}/
${topLevelTree}\`\`\`

## How to Regenerate

\`\`\`bash
npx tsx scripts/codemaps/generate.ts        # Regenerate codemaps
npx madge --image graph.svg src/            # Dependency graph (requires graphviz)
npx jsdoc2md src/**/*.ts                    # Extract JSDoc
\`\`\`

## Related Documentation

- [Frontend](./frontend.md) — UI components, pages, hooks
- [Backend/API](./backend.md) — API routes, controllers, middleware
- [Database](./database.md) — Models, schemas, migrations
- [Integrations](./integrations.md) — External services & adapters
- [Workers](./workers.md) — Background jobs, queues, cron tasks
`;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

function main(): void {
  console.log(`[generate.ts] Scanning: ${SRC_DIR}`);
  console.log(`[generate.ts] Output:   ${OUTPUT_DIR}`);

  // Ensure output directory exists
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });

  // Walk the directory tree
  const allFiles = walkDir(SRC_DIR);
  console.log(`[generate.ts] Found ${allFiles.length} files`);

  // Classify files into areas
  const areas = classifyFiles(allFiles);

  // Generate INDEX.md
  const indexContent = generateIndex(areas, allFiles);
  const indexPath = path.join(OUTPUT_DIR, 'INDEX.md');
  fs.writeFileSync(indexPath, indexContent, 'utf8');
  console.log(`[generate.ts] Written: ${rel(indexPath)}`);

  // Generate per-area codemaps
  for (const [key, area] of Object.entries(areas)) {
    const content = generateAreaDoc(key, area, allFiles);
    const outPath = path.join(OUTPUT_DIR, `${key}.md`);
    fs.writeFileSync(outPath, content, 'utf8');
    console.log(`[generate.ts] Written: ${rel(outPath)} (${area.files.length} files)`);
  }

  console.log('\n[generate.ts] Done! Codemaps written to docs/CODEMAPS/');
  console.log('[generate.ts] Files generated:');
  console.log('  docs/CODEMAPS/INDEX.md');
  console.log('  docs/CODEMAPS/frontend.md');
  console.log('  docs/CODEMAPS/backend.md');
  console.log('  docs/CODEMAPS/database.md');
  console.log('  docs/CODEMAPS/integrations.md');
  console.log('  docs/CODEMAPS/workers.md');
}

main();
