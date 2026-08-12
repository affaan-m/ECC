'use strict';

const { version: ECC_VERSION } = require('../../package.json');

const COMMUNITY_LINKS = Object.freeze({
  github: 'https://github.com/affaan-m/ECC',
  discord: 'https://discord.gg/36yGMHGFbR',
  documentation: 'https://github.com/affaan-m/ECC#readme',
  githubApp: 'https://github.com/apps/ecc-tools',
});

const SUCCESS_ACTIONS = Object.freeze([
  'installed',
  'updated',
  'migrated',
  'resumed',
  'already-migrated',
  'configured',
]);
const SUCCESS_MESSAGES = Object.freeze({
  installed: 'Welcome to ECC!',
  updated: 'ECC is updated — thank you for using ECC!',
  migrated: 'ECC is configured — thank you for using ECC!',
  resumed: 'ECC is configured — thank you for using ECC!',
  'already-migrated': 'ECC is configured — thank you for using ECC!',
  configured: 'ECC is configured — thank you for using ECC!',
});
// CFonts' default "block" face: https://github.com/dominikwilkowski/cfonts
const ECC_WORDMARK = Object.freeze([
  ' ███████╗  ██████╗  ██████╗',
  ' ██╔════╝ ██╔════╝ ██╔════╝',
  ' █████╗   ██║      ██║',
  ' ██╔══╝   ██║      ██║',
  ' ███████╗ ╚██████╗ ╚██████╗',
  ' ╚══════╝  ╚═════╝  ╚═════╝',
]);
const ECC_GRADIENT = Object.freeze({
  start: Object.freeze({ red: 215, green: 151, blue: 107 }),
  end: Object.freeze({ red: 100, green: 131, blue: 160 }),
});
const ECC_VERSION_PATTERN = /^[0-9]+(?:\.[0-9]+){2}(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;
const WORDMARK_START_COLUMN = Math.min(...ECC_WORDMARK.map(line => line.search(/\S/)));
const WORDMARK_END_COLUMN = Math.max(
  ...ECC_WORDMARK.map(line => line.trimEnd().length - 1)
);

function colorize(value, code, enabled) {
  return enabled ? `\x1b[${code}m${value}\x1b[0m` : value;
}

function interpolateChannel(start, end, ratio) {
  return Math.round(start + ((end - start) * ratio));
}

function gradientColorAt(column) {
  const span = WORDMARK_END_COLUMN - WORDMARK_START_COLUMN;
  const ratio = span === 0 ? 0 : (column - WORDMARK_START_COLUMN) / span;
  return {
    red: interpolateChannel(ECC_GRADIENT.start.red, ECC_GRADIENT.end.red, ratio),
    green: interpolateChannel(ECC_GRADIENT.start.green, ECC_GRADIENT.end.green, ratio),
    blue: interpolateChannel(ECC_GRADIENT.start.blue, ECC_GRADIENT.end.blue, ratio),
  };
}

function renderWordmark(color) {
  if (!color) return ECC_WORDMARK.join('\n');

  return ECC_WORDMARK.map(line => (
    [...line].map((character, column) => {
      if (character === ' ') return character;
      const value = gradientColorAt(column);
      return `\x1b[38;2;${value.red};${value.green};${value.blue}m${character}`;
    }).join('') + '\x1b[0m'
  )).join('\n');
}

function renderCommunityLinks() {
  const rows = Object.freeze([
    `GitHub:        ${COMMUNITY_LINKS.github}`,
    `Discord:       ${COMMUNITY_LINKS.discord}`,
    `Documentation: ${COMMUNITY_LINKS.documentation}`,
    `GitHub App:     ${COMMUNITY_LINKS.githubApp}`,
  ]);
  const contentWidth = Math.max(...rows.map(row => row.length));
  const border = '─'.repeat(contentWidth + 2);

  return [
    `  ╭${border}╮`,
    ...rows.map(row => `  │ ${row.padEnd(contentWidth)} │`),
    `  ╰${border}╯`,
  ];
}

function renderTerminalWelcome(options = {}) {
  const color = options.color === true;
  const installedVersion = options.version || ECC_VERSION;
  if (!ECC_VERSION_PATTERN.test(installedVersion)) {
    throw new Error(`Invalid ECC version: ${installedVersion}`);
  }
  const graphic = renderWordmark(color);
  const successMessage = SUCCESS_MESSAGES[options.action] || SUCCESS_MESSAGES.installed;
  const welcomeMessage = colorize(successMessage, '1;35', color);
  const version = colorize(`v${installedVersion}`, '2', color);
  const versionLine = color ? `\x1b[1G  ${version}` : `  ${version}`;

  return [
    '',
    graphic,
    '',
    `  ${welcomeMessage}`,
    versionLine,
    '',
    ...renderCommunityLinks(),
    '',
  ].join('\n');
}

function showTerminalWelcome(options = {}) {
  const {
    action,
    dryRun = false,
    env = process.env,
    interactive = false,
    json = false,
    output = process.stdout,
  } = options;
  const shouldShow = (
    interactive
    && output.isTTY === true
    && !dryRun
    && !json
    && SUCCESS_ACTIONS.includes(action)
  );
  if (!shouldShow) return false;

  const color = env.NO_COLOR === undefined && env.TERM !== 'dumb';
  output.write(renderTerminalWelcome({ action, color }));
  return true;
}

module.exports = {
  COMMUNITY_LINKS,
  ECC_VERSION_PATTERN,
  renderTerminalWelcome,
  showTerminalWelcome,
};
