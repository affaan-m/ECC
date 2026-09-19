#!/usr/bin/env node
/**
 * Copy skills that target hermes to .hermes/skills/
 */

const fs = require('fs');
const path = require('path');

const REPO_ROOT = path.resolve(__dirname, '..');
const SKILLS_DIR = path.join(REPO_ROOT, 'skills');
const HERMES_SKILLS_DIR = path.join(REPO_ROOT, '.hermes', 'skills');

// Skills that target hermes based on install-modules.json
const HERMES_SKILLS = [
  // skill-unified-memory module
  'unified-memory',
  
  // workflow-quality module
  'agent-sort',
  'agent-introspection-debugging',
  'ai-regression-testing',
  'configure-ecc',
  'code-tour',
  'continuous-learning',
  'continuous-learning-v2',
  'council',
  'council-multi-model',
  'dev-team',
  'e2e-testing',
  'error-handling',
  'eval-harness',
  'hookify-rules',
  'iterative-retrieval',
  'plan-canvas',
  'plankton-code-quality',
  'production-audit',
  'skill-comply',
  'skill-scout',
  'skill-stocktake',
  'strategic-compact',
  'tdd-workflow',
  'verification-loop',
  'windows-desktop-e2e',
  'agent-self-evaluation',
  'architecture-decision-records',
  'browser-qa',
  'ck',
  'click-path-audit',
  'codebase-onboarding',
  'codehealth-mcp',
  'config-gc',
  'context-budget',
  'delivery-gate',
  'ecc-guide',
  'ecc-recipes',
  'growth-log',
  'inherit-legacy-style',
  'intent-driven-development',
  'living-docs-governance',
  'loop-design-check',
  'product-lens',
  'repo-scan',
  'rules-distill',
  'santa-method',
  'git-workflow',
];

function ensureDir(dirPath) {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
}

function copyDirSync(src, dest) {
  ensureDir(dest);
  const entries = fs.readdirSync(src, { withFileTypes: true });
  
  for (const entry of entries) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);
    
    if (entry.isDirectory()) {
      copyDirSync(srcPath, destPath);
    } else {
      fs.copyFileSync(srcPath, destPath);
    }
  }
}

function copyHermesSkills() {
  ensureDir(HERMES_SKILLS_DIR);
  
  let copied = 0;
  let skipped = 0;
  
  for (const skill of HERMES_SKILLS) {
    const srcPath = path.join(SKILLS_DIR, skill);
    const destPath = path.join(HERMES_SKILLS_DIR, skill);
    
    if (fs.existsSync(srcPath)) {
      copyDirSync(srcPath, destPath);
      copied++;
    } else {
      console.log(`Warning: Skill not found: ${skill}`);
      skipped++;
    }
  }
  
  console.log(`Copied ${copied} skills to ${HERMES_SKILLS_DIR}`);
  if (skipped > 0) {
    console.log(`Skipped ${skipped} skills (not found)`);
  }
}

copyHermesSkills();
