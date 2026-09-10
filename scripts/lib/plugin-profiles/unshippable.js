/**
 * Omitting commands the staged load smoke proved cannot run.
 *
 * A carrier never ships `node_modules` (see require-graph.js and
 * load-smoke.js), so an entry script whose closure needs an npm package the
 * load smoke could not find will fail identically for every user who runs
 * the command. Shipping it anyway — reachable from the command list,
 * guaranteed to crash — is worse than not listing it, so the command is
 * removed from the staged tree instead, and named in the receipt so the
 * omission is visible rather than silent.
 */

'use strict';

const fs = require('fs');
const path = require('path');

/**
 * Remove commands whose runtime the staged load smoke proved unshippable.
 *
 * A command that references more than one entry script is omitted in whole
 * when any one of them is unshippable, matching the existing rule that a
 * carrier never carries a slash command it cannot fully run.
 *
 * The backing script itself is left in the staged tree: it may still be
 * required by something else, and an unreferenced script costs nothing
 * toward the session-context budget the ledger measures.
 *
 * @param {object} plan Resolved plan.
 * @param {string} stagingRoot Staged plugin directory.
 * @param {{external: Array<{file: string, module: string}>}} verification Load smoke result.
 * @returns {{omittedCommands: Array<string>, shippedCommands: Array<string>, reasons: Array<object>}}
 */
function pruneUnshippableCommands(plan, stagingRoot, verification) {
  const commandsByScript = new Map();
  for (const entry of plan.closure.entries) {
    if (!commandsByScript.has(entry.script)) {
      commandsByScript.set(entry.script, new Set());
    }
    commandsByScript.get(entry.script).add(entry.command);
  }

  const omittedCommands = new Set();
  const reasons = [];
  for (const dep of verification.external || []) {
    const commands = commandsByScript.get(dep.file);
    if (!commands || commands.size === 0) {
      continue;
    }
    for (const command of commands) {
      omittedCommands.add(command);
    }
    reasons.push({ commands: [...commands].sort(), script: dep.file, module: dep.module });
  }

  for (const commandFile of omittedCommands) {
    const staged = path.join(stagingRoot, 'commands', commandFile);
    if (fs.existsSync(staged)) {
      fs.rmSync(staged);
    }
  }

  return {
    omittedCommands: [...omittedCommands].sort(),
    shippedCommands: plan.commands.filter(commandFile => !omittedCommands.has(commandFile)),
    reasons: reasons.sort((a, b) => a.script.localeCompare(b.script)),
  };
}

module.exports = {
  pruneUnshippableCommands,
};
