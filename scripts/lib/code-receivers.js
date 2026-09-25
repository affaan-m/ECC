'use strict';

/**
 * Which programs run the text they receive as code: a quoted argument
 * (`sh -c '...'`, `node -e '...'`, `awk '...'`), or what is piped into them
 * (`| sh`, `| python3 -`, `| sed e`).
 */

const { SED_PROGRAMS, sedScriptTexts, sedExecution } = require('./sed-script');

/**
 * Programs that execute a quoted argument as a shell command line, so a
 * `git` inside one of their quoted arguments is a command that must still
 * be checked (`sh -c "git commit --no-verify"`, `sudo`, `xargs`, `env`...).
 * For any other argv0 (`node cli.js 'git commit --no-verify'`,
 * `printf '%s' '...'`, `grep -n '...' docs.md`) a quoted string is data,
 * unless it is a runtime given an eval flag (see CODE_EVALUATORS).
 */
const COMMAND_WRAPPERS = new Set([
  'sh',
  'bash',
  'zsh',
  'dash',
  'ksh',
  'fish',
  'busybox',
  'eval',
  'exec',
  'command',
  'xargs',
  'sudo',
  'doas',
  'su',
  'env',
  'nice',
  'ionice',
  'nohup',
  'timeout',
  'time',
  'watch',
  'flock',
  'ssh',
  'script',
  'csh',
  'tcsh',
  'setsid',
  'stdbuf',
  'taskset',
  'chrt',
  'unshare',
  'chroot',
  'runuser',
  'npx',
  'bunx',
  'pnpx',
  // Runs a command line for each input line; find and fd, which do so only
  // after one of their exec flags, are in LAUNCHERS.
  'parallel',
  // Shell builtins and zsh precommand modifiers that run a command line, or
  // keep one to run later (`trap '...' EXIT`, `alias x='...'`).
  'builtin',
  'noglob',
  'nocorrect',
  'trap',
  'alias',
]);

/**
 * Strip a leading path and a trailing `.exe` from a command word.
 */
function commandBasename(word) {
  return String(word || '')
    .replace(/^.*[\\/]/, '')
    .replace(/\.exe$/i, '')
    .toLowerCase();
}

/**
 * Runtimes that run a quoted argument as program source, each with the
 * flags that do it: `node -e`, `python3 -c`, `perl -E`, `php -r`,
 * `deno eval`. That source can spawn git itself, so it stays subject to the
 * guard. The same runtime without one of its own eval flags receives a
 * script path and arguments, which are data (`node cli.js 'git commit
 * --no-verify'`).
 *
 * The flags are per runtime because the same letter means different things:
 * node's `-r` preloads a module and leaves the rest of the command line as
 * ordinary arguments, while php's `-r` is how php is handed code.
 */
const CODE_EVALUATORS = new Map([
  ['node', ['-e', '--eval', '-p', '--print']],
  ['nodejs', ['-e', '--eval', '-p', '--print']],
  ['bun', ['-e', '--eval', '-p', '--print']],
  ['deno', ['-e', '--eval', 'eval']],
  ['python', ['-c']],
  ['python2', ['-c']],
  ['python3', ['-c']],
  ['pythonw', ['-c']],
  ['perl', ['-e', '-E']],
  ['ruby', ['-e']],
  ['php', ['-r']],
  ['lua', ['-e']],
  ['luajit', ['-e']],
  ['rscript', ['-e']],
  ['osascript', ['-e']],
  ['groovy', ['-e']],
  ['julia', ['-e', '-E']],
  ['elixir', ['-e']],
  ['erl', ['-eval']],
  ['expect', ['-c']],
]);

/**
 * Launchers that run another program given after one of their flags:
 * `find . -exec CMD ARGS \;`, `fd -x CMD ARGS`. A quoted argument of the
 * launched program is judged as that program's own, so `-exec grep '...'`
 * searches and `-exec sh -c '...'` runs. After find's `;` or `{} +` the
 * arguments are find's again.
 */
const LAUNCHERS = new Map([
  ['find', ['-exec', '-execdir', '-ok', '-okdir']],
  ['fd', ['-x', '--exec', '-X', '--exec-batch']],
  ['fdfind', ['-x', '--exec', '-X', '--exec-batch']],
]);

const EXEC_TERMINATORS = new Set(['\\;', "';'", '";"']);

/**
 * Runtimes whose first operand is itself program source, with no eval flag:
 * `awk 'BEGIN { system("git commit --no-verify") }'` runs git. Every quoted
 * argument they receive stays subject to the guard, at the cost of also
 * checking an awk pattern that merely mentions a bypass flag.
 */
const SOURCE_OPERAND_RUNTIMES = new Set(['awk', 'gawk', 'mawk', 'nawk']);

/**
 * Whether a quoted argument is data for the program that receives it.
 * `words` runs from that program's name up to the argument. An eval flag is
 * matched as a whole word, or as the `=` form of itself, so a path that
 * happens to end in one of them cannot qualify.
 */
function receivesAsData(words) {
  // A program named by an expansion is only known when the line runs.
  if (/[$`]/.test(words[0])) return false;
  const base = commandBasename(words[0]);
  if (base === 'git' || COMMAND_WRAPPERS.has(base) || SOURCE_OPERAND_RUNTIMES.has(base)) return false;
  const launchFlags = LAUNCHERS.get(base);
  if (launchFlags !== undefined) {
    const at = words.findLastIndex((word) => launchFlags.includes(word));
    if (at === -1) return true;
    const launched = words.slice(at + 1);
    if (launched.some((word, i) => EXEC_TERMINATORS.has(word) || (word === '+' && launched[i - 1] === '{}'))) {
      return true;
    }
    // The quoted argument is the launched program's name itself.
    if (launched.length === 0) return false;
    return receivesAsData([launched[0].replace(/['"\\]/g, ''), ...launched.slice(1)]);
  }
  const flags = CODE_EVALUATORS.get(base);
  if (flags === undefined) return true;
  return !words.some((word) => flags.some((flag) => word === flag || word.startsWith(`${flag}=`)));
}

/**
 * The arguments sed receives in a statement, or null when the statement does
 * not run sed: `sed ARGS`, or sed behind a wrapper (`sudo sed ARGS`).
 */
function sedArguments(words) {
  const base = commandBasename(words[0]);
  if (SED_PROGRAMS.has(base)) return words.slice(1);
  if (!COMMAND_WRAPPERS.has(base)) return null;
  const at = words.findIndex((word) => SED_PROGRAMS.has(commandBasename(word)));
  return at === -1 ? null : words.slice(at + 1);
}

/**
 * Whether a program reads the text piped into it as code: a shell or command
 * wrapper (`| sh`, `| xargs sh -c`), a runtime with no script operand of its
 * own (`| node`, `| python3 -`), sed with a script that runs its input
 * (`| sed e`), or a program named by an expansion.
 */
function readsCodeFromStdin(words) {
  if (/[$`]/.test(words[0])) return true;
  const base = commandBasename(words[0]);
  if (COMMAND_WRAPPERS.has(base)) return true;
  if (SED_PROGRAMS.has(base)) {
    const opaque = words.some((word) => /[$`]/.test(word));
    return sedScriptTexts(words.slice(1), opaque).some((script) => sedExecution(script).runsInput);
  }
  if (CODE_EVALUATORS.has(base)) return words.slice(1).every((word) => word.startsWith('-'));
  return false;
}

module.exports = { COMMAND_WRAPPERS, commandBasename, receivesAsData, sedArguments, readsCodeFromStdin };
