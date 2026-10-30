# Migrating From ECC 1.x To 2.0

ECC 2.0 renamed the repo (`affaan-m/everything-claude-code` → `affaan-m/ECC`) and the plugin identifier (`everything-claude-code@everything-claude-code` → `ecc@ecc`). If you installed 1.x, follow this guide to upgrade cleanly. See also the [Naming + Migration Note](../README.md#claude-code-details) in the README.

## TL;DR

Before uninstalling, back up any saved plugin options, secrets, and data you need. Removing the last installation can delete them; see Claude Code's [uninstall reference](https://code.claude.com/docs/en/plugins/cli-reference#what-an-uninstall-deletes-and-keeps). If you registered 1.x through `settings.json`, follow the [marketplace declaration migration](#migrating-a-settingsjson-marketplace-declaration) below instead of the quick commands so you preserve your settings and plugin enablement choice.

```bash
# 1. Install 2.0
/plugin marketplace add https://github.com/affaan-m/ECC
/plugin install ecc@ecc

# 2. Remove the old plugin
/plugin uninstall everything-claude-code@everything-claude-code
```

Review any leftover 1.x folders (see below) and restart the session.

## "I now see two ECC plugins"

Expected. `ecc@ecc` and `everything-claude-code@everything-claude-code` are treated as separate plugins by Claude Code. Uninstall the old one; keep only `ecc@ecc`. Running both duplicates skills, commands, and hook executions.

## Migrating a `settings.json` marketplace declaration

Uninstalling the old plugin does not itself replace a persistent `extraKnownMarketplaces` declaration. Migrate the marketplace even if you do not want to enable the ECC plugin.

1. Back up the settings files that declare `everything-claude-code` (user `~/.claude/settings.json`, project `.claude/settings.json`, or local `.claude/settings.local.json`). Check each applicable scope; ask your administrator to update managed declarations. Preserve unrelated marketplaces, settings, and plugin enablement choices.
2. Run `/plugin list` (or `claude plugin list --json` from the shell) and inspect the installed plugins associated with the old `everything-claude-code` marketplace, even if that marketplace is no longer registered. Record anything you need to reinstall and the old plugin’s enabled/disabled choice at each applicable settings scope, and back up any plugin data you need. Removing a marketplace can uninstall **all plugins from it**, remove their enablement entries, and delete their saved configuration/data. Move any plugins you still need to their intended marketplace before retiring the old one; the new ECC identifier is `ecc@ecc`.
3. Retire the old registration through Claude Code's supported controls: open `/plugin` → **Marketplaces**, select `everything-claude-code`, and remove it after reviewing the affected plugins. The shell equivalent is:

   ```bash
   claude plugin marketplace remove everything-claude-code
   ```

   Use the name reported by `claude plugin marketplace list`, not the repository URL. If the old entry is already absent, skip only the marketplace removal. See Claude Code's [marketplace command reference](https://code.claude.com/docs/en/plugins/cli-reference#plugin-marketplace-remove) for scope options and removal effects.

   Before uninstalling a remaining legacy installation, remove the `everything-claude-code@everything-claude-code` entry from `enabledPlugins` in the settings files at each applicable scope identified in step 2. Preserve unrelated entries; ask your administrator to handle managed settings.

   After retiring the registration and clearing the legacy enablement entries, run `/plugin list` again. If `everything-claude-code@everything-claude-code` is still installed, finish the backup in step 2 and run `/plugin uninstall everything-claude-code@everything-claude-code`. A missing marketplace entry does not prove that the installed plugin is gone. From the shell, use `claude plugin uninstall everything-claude-code@everything-claude-code --scope <scope>` for each applicable installation shown by `claude plugin list --json`; use `user`, `project`, or `local` as appropriate and run project/local commands from the corresponding project. Ask your administrator to remove managed installations. If uninstall reports a settings file that still switches the plugin on (`settings_still_on` with `--json` on Claude Code v2.1.282 or later), the plugin remains installed: fix the legacy enablement entry in that file and retry the scoped uninstall. See the [plugin uninstall reference](https://code.claude.com/docs/en/plugins/cli-reference#plugin-uninstall).
4. In each settings file that declared the old marketplace, remove any remaining `extraKnownMarketplaces["everything-claude-code"]` entry and merge in the current declaration below. Do not replace the whole settings file or leave both keys behind:

   ```json
   {
     "extraKnownMarketplaces": {
       "ecc": {
         "source": {
           "source": "github",
           "repo": "affaan-m/ECC"
         }
       }
     }
   }
   ```

   This snippet registers the marketplace only. Use the enablement choice recorded in step 2. If you previously enabled the old plugin and want to continue using it, install `ecc@ecc` and use `"ecc@ecc": true` in `enabledPlugins` at the intended scope. If you kept it disabled, preserve `"ecc@ecc": false`; if you did not enable it, do not add an enablement entry just to repair the marketplace. Remove any obsolete `everything-claude-code@everything-claude-code` enablement entry while preserving unrelated entries.
5. Restart Claude Code and run `/plugin marketplace list` (or `claude plugin marketplace list --json` from the shell). Confirm that the legacy ECC marketplace is absent and `ecc` points to `affaan-m/ECC`; unrelated marketplaces should remain. In the JSON output, check that ECC's `installLocation` directory exists and its `.claude-plugin/marketplace.json` declares `"name": "ecc"`. Use `/plugin list` to confirm the legacy plugin is no longer installed, and `/plugin` to confirm the new plugin's enabled/disabled state matches your choice. If the old marketplace returns, recheck the settings scopes for a remaining declaration rather than repeatedly deleting its cache.

### Abandoned temporary marketplace clones

If plugin storage is unexpectedly large, first resolve the plugin root: use the effective `CLAUDE_CODE_PLUGIN_CACHE_DIR` value configured in your shell or the `env` key of the applicable settings files; otherwise use `<CLAUDE_CONFIG_DIR>/plugins` when `CLAUDE_CONFIG_DIR` is set, or `~/.claude/plugins` when it is not. `CLAUDE_CODE_PLUGIN_CACHE_DIR` selects the parent directory for both marketplaces and the plugin cache. `CLAUDE_CONFIG_DIR` can come from your shell, user settings, or managed settings; project and local settings cannot set it. In settings JSON, use an absolute path: values such as `~` and `$HOME` are not shell-expanded. See Claude Code's [environment variable reference](https://code.claude.com/docs/en/env-vars). Inspect `marketplaces/` and `cache/` under that resolved root for `temp_git*` directories. A temporary-looking name alone does not prove a directory is abandoned. Compare its path against registered marketplace locations and installed plugin paths, and inspect its Git remote/configuration to identify its source. A former ECC URL is evidence of that clone's source, not proof that ECC caused repeated cloning.

Close Claude Code sessions and ensure no install/update process is using a directory before considering cleanup. Back up anything needed and remove only individually verified abandoned clones. Do not blanket-delete the plugin registry, `known_marketplaces.json`, `installed_plugins.json`, active marketplaces, or active plugin caches. If you cannot establish that a directory is unused, leave it in place. Marketplace migration repairs stale declarations; it does not establish or fix Claude Code's temporary-clone cleanup behavior.

## Leftover folders after uninstalling 1.x

`/plugin uninstall` removes the plugin from the active list, but can leave the old directory in the Claude plugin cache and any manual copies in your home directory.

The old plugin disappearing from `/plugin list` does not prove its folder is abandoned. Before deleting an old plugin folder under the [resolved plugin root](#abandoned-temporary-marketplace-clones), verify all of the following:

- Its path is not a registered marketplace location or an installed plugin path; compare against `claude plugin marketplace list --json` and `claude plugin list --json` at each applicable scope.
- Its Git remote and configuration identify it as an abandoned legacy clone, rather than an active marketplace or working checkout. A legacy name or URL alone is not enough.
- No active Claude Code session or install/update process uses the directory. Close relevant sessions and finish or stop those operations before cleanup.

Back up anything needed and delete only that individually verified abandoned folder. If any check is uncertain, leave it in place.

For manual installations, review these separately:

- A 1.x manual install in your home folder (a cloned `everything-claude-code/` directory), **if** you are not using it as a working checkout
- Old manually-copied surfaces under `~/.claude/` (`skills/`, `commands/`, `agents/` entries that came from 1.x) — the 2.0 plugin provides current versions

Do NOT delete `~/.claude/rules/` content you copied intentionally, or personal memory/state files.

## Does removing 1.x affect my existing projects?

No. ECC is a harness layer: skills, commands, agents, hooks. It does not alter your project code or git history. Everything ECC produced in your repos (commits, files, PRs) is untouched. Your next session simply loads 2.0 surfaces instead of 1.x ones. Slash-command namespaces changed from `everything-claude-code:*` to `ecc:*`.

## One install path only

Do not stack the plugin install with the manual installer (`install.sh` / `install.ps1` / `npx ecc-universal install --profile full`). Pick one path; stacking creates duplicate skills and duplicate hook runs. If you already stacked, see [Reset / Uninstall ECC](../README.md#reset--uninstall-ecc).

## Using 2.0 across harnesses (Codex, Antigravity/agy, OpenCode, Cursor)

2.0 is cross-harness. Use the manual installer with a target:

```bash
npx ecc-universal install --profile core --target codex      # Codex CLI
npx ecc-universal install --profile core --target opencode   # OpenCode
npx ecc-universal install --profile core --target cursor     # Cursor
```

Run `npx ecc-universal consult "<what you need>" --target <harness>` to preview which components fit before installing. Harness-specific guides: [ANTIGRAVITY-GUIDE.md](./ANTIGRAVITY-GUIDE.md), [HERMES-SETUP.md](./HERMES-SETUP.md), [QWEN-GUIDE.md](./QWEN-GUIDE.md), [JOYCODE-GUIDE.md](./JOYCODE-GUIDE.md).
