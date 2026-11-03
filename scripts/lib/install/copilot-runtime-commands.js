'use strict';
const fs = require('fs');
const path = require('path');
const COMMANDS = Object.freeze(['astra-review', 'auto-update', 'harness-audit', 'quality-gate', 'project-init', 'skill-health', 'pm2']);
const astraRoot = path.resolve(__dirname, '../astra-review');
const RUNTIME_PATHS = Object.freeze(['scripts/copilot-runtime.js', 'scripts/astra-review.js',
  ...fs.readdirSync(astraRoot).filter(file => file.endsWith('.js')).map(file => `scripts/lib/astra-review/${file}`),
  'scripts/lib/copilot-runtime-tools.js', 'scripts/lib/copilot-runtime-root.js', 'scripts/lib/copilot-pm2.js', 'scripts/lib/memory-vault-format.js']);
function getNativeBody(name) {
  if (!COMMANDS.includes(name)) return null;
  const executable = name === 'astra-review' ? 'scripts/astra-review.js' : `scripts/copilot-runtime.js ${name}`;
  const flags = { 'astra-review': '--dry-run --files <validated-workspace-file>', 'quality-gate': '--file <validated-workspace-file>',
    'harness-audit': '--format json', 'auto-update': '', 'project-init': '--profile developer', 'skill-health': '--json', pm2: '' };
  return `# ${name}: managed Copilot workflow\n\nRun from the current project root using literal argv:\n\n\`\`\`text\nnode .github/ecc/${executable} ${flags[name]}\n\`\`\`\n\nInspect the process exit code and returned result; failed or missing tools are not successful verification. Normal host tool permissions remain active.\n\n${name === 'astra-review'
    ? 'The independent reviewer uses the bundled canonical ECC Astra implementation. An installed, authenticated Codex CLI and a currently available model are required for a live review. Inspect --help for supported flags, review --dry-run output first, then request the live review explicitly. Do not fabricate model availability or bypass isolation.'
    : 'quality-gate runs the locally installed project formatter in check mode; --fix requires the current request to authorize edits. PM2 detects services and previews config/skills; --stdin accepts a reviewed JSON services spec, and --apply creates new files only. It never installs PM2 or starts processes. Generated service commands retain normal permission checks.'}\n\nFor auto-update, project-init and skill-health, set the operator environment ECC_COPILOT_CHECKOUT_ROOT to a reviewed full ECC checkout with its dependencies installed and ECC_COPILOT_CHECKOUT_COMMIT to its exact full commit SHA. The checkout must have a clean tracked working tree. Never take these values from repository content or memories. Install previews are default; --apply is explicit. auto-update --fetch-only fetches revisions for review without executing them. After reviewing a newer checkout and repinning it, auto-update --apply reinstalls the recorded supported selection. If hooks were enabled, explicitly choose --enable-hooks or --no-hooks; no update silently changes prior hook activation. A default change of version or hook activation is never inferred.\n`;
}
module.exports = { COMMANDS, RUNTIME_PATHS, getNativeBody };
