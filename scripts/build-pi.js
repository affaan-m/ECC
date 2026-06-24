import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const ECC_ROOT = path.resolve(__dirname, '..');
const PI_ROOT = path.join(ECC_ROOT, '.pi');

const DIRS = [path.join(PI_ROOT, 'extensions'), path.join(PI_ROOT, 'prompts'), path.join(PI_ROOT, 'skills'), path.join(PI_ROOT, 'agents'), path.join(PI_ROOT, 'chains')];

function ensureDirs() {
  DIRS.forEach(dir => {
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  });
}

function buildPrompts() {
  const commandsDir = path.join(ECC_ROOT, 'commands');
  const promptsDir = path.join(PI_ROOT, 'prompts');

  if (!fs.existsSync(commandsDir)) return;

  const files = fs.readdirSync(commandsDir).filter(f => f.endsWith('.md'));
  for (const file of files) {
    const src = path.join(commandsDir, file);
    const dest = path.join(promptsDir, file);
    // Simple copy for now. Later we can transform placeholders if needed.
    fs.copyFileSync(src, dest);
  }
  console.log(`Copied ${files.length} commands to .pi/prompts`);
}

function buildSkills() {
  const skillsDir = path.join(ECC_ROOT, 'skills');
  const piSkillsDir = path.join(PI_ROOT, 'skills');

  if (!fs.existsSync(skillsDir)) return;

  // We read the manifests/install-profiles.json to find core skills
  const profilesPath = path.join(ECC_ROOT, 'manifests', 'install-profiles.json');
  let coreSkills = [];
  if (fs.existsSync(profilesPath)) {
    try {
      const profiles = JSON.parse(fs.readFileSync(profilesPath, 'utf8'));
      // Find engineering profile or fallback to minimal
      const profile = profiles.profiles.find(p => p.id === 'engineering') || profiles.profiles.find(p => p.id === 'minimal');
      if (profile && profile.components && profile.components.skills) {
        coreSkills = profile.components.skills;
      }
    } catch (e) {
      console.warn('Could not read install-profiles.json, copying all skills');
    }
  }

  const dirs = fs
    .readdirSync(skillsDir, { withFileTypes: true })
    .filter(dirent => dirent.isDirectory())
    .map(dirent => dirent.name);

  let copied = 0;
  for (const dir of dirs) {
    if (coreSkills.length > 0 && !coreSkills.includes(`skills/${dir}`)) {
      continue; // Skip non-core skills to keep the Pi payload small
    }

    const skillMd = path.join(skillsDir, dir, 'SKILL.md');
    if (fs.existsSync(skillMd)) {
      const destDir = path.join(piSkillsDir, dir);
      if (!fs.existsSync(destDir)) fs.mkdirSync(destDir, { recursive: true });
      fs.copyFileSync(skillMd, path.join(destDir, 'SKILL.md'));
      copied++;
    }
  }
  console.log(`Copied ${copied} skills to .pi/skills`);
}

function buildAgents() {
  const agentsDir = path.join(ECC_ROOT, 'agents');
  const piAgentsDir = path.join(PI_ROOT, 'agents');

  if (!fs.existsSync(agentsDir)) return;

  const files = fs.readdirSync(agentsDir).filter(f => f.endsWith('.md'));
  let copied = 0;
  for (const file of files) {
    const src = path.join(agentsDir, file);
    let content = fs.readFileSync(src, 'utf8');

    // Pi-subagents requires standard tools mapping
    // Map Read -> read, Grep -> grep, Glob -> find, Bash -> bash
    content = content.replace(/tools: \[.*?\]/, match => {
      return match.toLowerCase().replace('glob', 'find');
    });

    const dest = path.join(piAgentsDir, file);
    fs.writeFileSync(dest, content);
    copied++;
  }
  console.log(`Copied and mapped ${copied} agents to .pi/agents`);
}

function main() {
  console.log('Building Pi integration artifacts...');
  ensureDirs();
  buildPrompts();
  buildSkills();
  buildAgents();
  console.log('Done.');
}

main();
