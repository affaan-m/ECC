#!/usr/bin/env node
'use strict';

/**
 * Static exfiltration heuristic check for loaded ECC skill definitions (#2415).
 */

const fs = require('fs');
const path = require('path');

const SUSPICIOUS_PATTERNS = [
  { id: 'env-exfil-curl', re: /(?:curl|wget)[^\n]*(?:process\.env|\$[A-Z_]*(?:KEY|TOKEN|SECRET))/i },
  { id: 'encoded-payload-pipe', re: /base64\s+(?:-d|--decode)\s*\|\s*(?:bash|sh|node|python)/i },
];

function scanSkillText(text, fileLabel = 'SKILL.md') {
  const findings = [];
  const lines = String(text || '').split(/\r?\n/);
  for (let i = 0; i < lines.length; i += 1) {
    for (const rule of SUSPICIOUS_PATTERNS) {
      if (rule.re.test(lines[i])) {
        findings.push({ file: fileLabel, line: i + 1, rule: rule.id });
      }
    }
  }
  return findings;
}

if (require.main === module) {
  const skillsDir = path.join(__dirname, '..', '..', 'skills');
  let checked = 0;
  const allFindings = [];
  if (fs.existsSync(skillsDir)) {
    for (const entry of fs.readdirSync(skillsDir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const mdPath = path.join(skillsDir, entry.name, 'SKILL.md');
      if (!fs.existsSync(mdPath)) continue;
      checked += 1;
      const content = fs.readFileSync(mdPath, 'utf8');
      allFindings.push(...scanSkillText(content, `skills/${entry.name}/SKILL.md`));
    }
  }
  console.log(`Scanned ${checked} skills; heuristic findings: ${allFindings.length}`);
  process.exit(0);
}

module.exports = { scanSkillText, SUSPICIOUS_PATTERNS };
