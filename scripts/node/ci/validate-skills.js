#!/usr/bin/env node
/**
 * Validate skill directories have SKILL.md with required structure
 *
 * Supports both flat layout (skills/skill-name/SKILL.md) and
 * nested layout (skills/{common,node,python}/skill-name/SKILL.md)
 */

const fs = require('fs');
const path = require('path');

const SKILLS_DIR = path.join(__dirname, '../../../skills');

function validateSkills() {
  if (!fs.existsSync(SKILLS_DIR)) {
    console.log('No skills directory found, skipping validation');
    process.exit(0);
  }

  const topEntries = fs.readdirSync(SKILLS_DIR, { withFileTypes: true });
  const topDirs = topEntries.filter(e => e.isDirectory()).map(e => e.name);
  let hasErrors = false;
  let validCount = 0;

  // Collect all skill directories (handle both flat and nested layouts)
  const skillDirs = [];

  for (const dir of topDirs) {
    const dirPath = path.join(SKILLS_DIR, dir);
    const skillMd = path.join(dirPath, 'SKILL.md');

    if (fs.existsSync(skillMd)) {
      // Flat layout: skills/skill-name/SKILL.md
      skillDirs.push({ name: dir, path: dirPath });
    } else {
      // Check for nested layout: skills/{lang}/skill-name/SKILL.md
      const subEntries = fs.readdirSync(dirPath, { withFileTypes: true });
      const subDirs = subEntries.filter(e => e.isDirectory()).map(e => e.name);
      if (subDirs.length > 0) {
        // Nested layout: language group dir with skill subdirs
        for (const subDir of subDirs) {
          skillDirs.push({ name: `${dir}/${subDir}`, path: path.join(dirPath, subDir) });
        }
      } else {
        // Flat layout without SKILL.md — will be caught as missing below
        skillDirs.push({ name: dir, path: dirPath });
      }
    }
  }

  for (const skill of skillDirs) {
    const skillMd = path.join(skill.path, 'SKILL.md');
    if (!fs.existsSync(skillMd)) {
      console.error(`ERROR: ${skill.name}/ - Missing SKILL.md`);
      hasErrors = true;
      continue;
    }

    let content;
    try {
      content = fs.readFileSync(skillMd, 'utf-8');
    } catch (err) {
      console.error(`ERROR: ${skill.name}/SKILL.md - ${err.message}`);
      hasErrors = true;
      continue;
    }
    if (content.trim().length === 0) {
      console.error(`ERROR: ${skill.name}/SKILL.md - Empty file`);
      hasErrors = true;
      continue;
    }

    // Skill discovery keys off YAML frontmatter: without name/description the
    // skill cannot trigger reliably.
    const fmMatch = content.match(/^---\n([\s\S]*?)\n---/);
    if (!fmMatch) {
      console.error(`ERROR: ${skill.name}/SKILL.md - Missing YAML frontmatter (--- block)`);
      hasErrors = true;
      continue;
    }
    const frontmatter = fmMatch[1];
    let skillOk = true;
    for (const field of ['name', 'description']) {
      const fieldMatch = frontmatter.match(new RegExp(`^${field}:\\s*(.+)$`, 'm'));
      if (!fieldMatch || fieldMatch[1].trim().length === 0) {
        console.error(`ERROR: ${skill.name}/SKILL.md - Frontmatter missing non-empty "${field}"`);
        hasErrors = true;
        skillOk = false;
      }
    }
    if (!skillOk) continue;

    validCount++;
  }

  if (hasErrors) {
    process.exit(1);
  }

  console.log(`Validated ${validCount} skill directories`);
}

validateSkills();
