#!/usr/bin/env node
/**
 * Skill Creator - Pretty Output Formatter
 *
 * Creates beautiful terminal output for the /skill-create command
 * similar to @mvanhorn's /last30days skill
 */

// ANSI color codes - no external dependencies
const chalk = {
  bold: (s) => `\x1b[1m${s}\x1b[0m`,
  cyan: (s) => `\x1b[36m${s}\x1b[0m`,
  green: (s) => `\x1b[32m${s}\x1b[0m`,
  yellow: (s) => `\x1b[33m${s}\x1b[0m`,
  magenta: (s) => `\x1b[35m${s}\x1b[0m`,
  gray: (s) => `\x1b[90m${s}\x1b[0m`,
  white: (s) => `\x1b[37m${s}\x1b[0m`,
  red: (s) => `\x1b[31m${s}\x1b[0m`,
  dim: (s) => `\x1b[2m${s}\x1b[0m`,
  bgCyan: (s) => `\x1b[46m${s}\x1b[0m`,
};

// Box drawing characters
const BOX = {
  topLeft: '╭',
  topRight: '╮',
  bottomLeft: '╰',
  bottomRight: '╯',
  horizontal: '─',
  vertical: '│',
  verticalRight: '├',
  verticalLeft: '┤',
};

// Progress spinner frames
const SPINNER = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];

// Helper functions
function box(title, content, width = 60) {
  const lines = content.split('\n');
  const top = `${BOX.topLeft}${BOX.horizontal} ${chalk.bold(chalk.cyan(title))} ${BOX.horizontal.repeat(Math.max(0, width - title.length - 5))}${BOX.topRight}`;
  const bottom = `${BOX.bottomLeft}${BOX.horizontal.repeat(width - 2)}${BOX.bottomRight}`;
  const middle = lines.map(line => {
    const padding = width - 4 - stripAnsi(line).length;
    return `${BOX.vertical} ${line}${' '.repeat(Math.max(0, padding))} ${BOX.vertical}`;
  }).join('\n');
  return `${top}\n${middle}\n${bottom}`;
}

function stripAnsi(str) {
  // eslint-disable-next-line no-control-regex
  return str.replace(/\x1b\[[0-9;]*m/g, '');
}

function progressBar(percent, width = 30) {
  const filled = Math.max(0, Math.min(width, Math.round(width * percent / 100)));
  const empty = width - filled;
  const bar = chalk.green('█'.repeat(filled)) + chalk.gray('░'.repeat(empty));
  return `${bar} ${chalk.bold(percent)}%`;
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function animateProgress(label, steps, callback) {
  process.stdout.write(`\n${chalk.cyan('⏳')} ${label}...\n`);

  for (let i = 0; i < steps.length; i++) {
    const step = steps[i];
    process.stdout.write(`   ${chalk.gray(SPINNER[i % SPINNER.length])} ${step.name}`);
    await sleep(step.duration || 500);
    process.stdout.clearLine?.(0) || process.stdout.write('\r');
    process.stdout.cursorTo?.(0) || process.stdout.write('\r');
    process.stdout.write(`   ${chalk.green('✓')} ${step.name}\n`);
    if (callback) callback(step, i);
  }
}

// Main output formatter
class SkillCreateOutput {
  constructor(repoName, options = {}) {
    this.repoName = repoName;
    this.options = options;
    this.width = options.width || 70;
  }

  header() {
    const subtitle = `Extracting patterns from ${chalk.cyan(this.repoName)}`;

    console.log('\n');
    console.log(chalk.bold(chalk.magenta('╔════════════════════════════════════════════════════════════════╗')));
    console.log(chalk.bold(chalk.magenta('║')) + chalk.bold('  🔮 ECC Skill Creator                                          ') + chalk.bold(chalk.magenta('║')));
    console.log(chalk.bold(chalk.magenta('║')) + `     ${subtitle}${' '.repeat(Math.max(0, 59 - stripAnsi(subtitle).length))}` + chalk.bold(chalk.magenta('║')));
    console.log(chalk.bold(chalk.magenta('╚════════════════════════════════════════════════════════════════╝')));
    console.log('');
  }

  async analyzePhase(data) {
    const steps = [
      { name: 'Parsing git history...', duration: 300 },
      { name: `Found ${chalk.yellow(data.commits)} commits`, duration: 200 },
      { name: 'Analyzing commit patterns...', duration: 400 },
      { name: 'Detecting file co-changes...', duration: 300 },
      { name: 'Identifying workflows...', duration: 400 },
      { name: 'Extracting architecture patterns...', duration: 300 },
    ];

    await animateProgress('Analyzing Repository', steps);
  }

  analysisResults(data) {
    console.log('\n');
    console.log(box('📊 Analysis Results', `
${chalk.bold('Commits Analyzed:')} ${chalk.yellow(data.commits)}
${chalk.bold('Time Range:')}       ${chalk.gray(data.timeRange)}
${chalk.bold('Contributors:')}     ${chalk.cyan(data.contributors)}
${chalk.bold('Files Tracked:')}    ${chalk.green(data.files)}
`));
  }

  patterns(patterns) {
    console.log('\n');
    console.log(chalk.bold(chalk.cyan('🔍 Key Patterns Discovered:')));
    console.log(chalk.gray('─'.repeat(50)));

    patterns.forEach((pattern, i) => {
      const confidence = pattern.confidence || 0.8;
      const confidenceBar = progressBar(Math.round(confidence * 100), 15);
      console.log(`
  ${chalk.bold(chalk.yellow(`${i + 1}.`))} ${chalk.bold(pattern.name)}
     ${chalk.gray('Trigger:')} ${pattern.trigger}
     ${chalk.gray('Confidence:')} ${confidenceBar}
     ${chalk.dim(pattern.evidence)}`);
    });
  }

  output(skillPath) {
    console.log('\n');
    console.log(chalk.bold(chalk.green('✨ Generation Complete!')));
    console.log(chalk.gray('─'.repeat(50)));
    console.log(`
  ${chalk.green('📄')} ${chalk.bold('Skill File:')}
     ${chalk.cyan(skillPath)}
`);
  }

  nextSteps() {
    console.log(box('📋 Next Steps', `
${chalk.yellow('1.')} Review the generated SKILL.md
${chalk.yellow('2.')} Adjust the description so it states when to use the skill
${chalk.yellow('3.')} Install it to ~/.claude/skills/ (scripts/install.sh)
`));
    console.log('\n');
  }

  footer() {
    console.log(chalk.gray('─'.repeat(60)));
    console.log(chalk.dim(`  Powered by Everything Claude Code • ecc.tools`));
    console.log(chalk.dim(`  GitHub App: github.com/apps/skill-creator`));
    console.log('\n');
  }
}

// Demo function to show the output
async function demo() {
  const output = new SkillCreateOutput('PMX');

  output.header();

  await output.analyzePhase({
    commits: 200,
  });

  output.analysisResults({
    commits: 200,
    timeRange: 'Nov 2024 - Jan 2025',
    contributors: 4,
    files: 847,
  });

  output.patterns([
    {
      name: 'Conventional Commits',
      trigger: 'when writing commit messages',
      confidence: 0.85,
      evidence: 'Found in 150/200 commits (feat:, fix:, refactor:)',
    },
    {
      name: 'Client/Server Component Split',
      trigger: 'when creating Next.js pages',
      confidence: 0.90,
      evidence: 'Observed in markets/, premarkets/, portfolio/',
    },
    {
      name: 'Service Layer Architecture',
      trigger: 'when adding backend logic',
      confidence: 0.85,
      evidence: 'Business logic in services/, not routes/',
    },
    {
      name: 'TDD with E2E Tests',
      trigger: 'when adding features',
      confidence: 0.75,
      evidence: '9 E2E test files, test(e2e) commits common',
    },
  ]);

  output.output('.claude/skills/pmx-patterns/SKILL.md');

  output.nextSteps();
  output.footer();
}

// Export for use in other scripts
module.exports = { SkillCreateOutput, demo };

// Run demo if executed directly
if (require.main === module) {
  demo().catch(console.error);
}
