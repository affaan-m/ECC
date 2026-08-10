## What Changed
<!-- Describe the specific changes made in this PR -->

## Why This Change
<!-- Explain the motivation and context for this change -->

## Testing Done
<!-- Describe the testing you performed to validate your changes -->
- [ ] Manual testing completed
- [ ] Automated tests pass locally (`node tests/run-all.js`)
- [ ] Edge cases considered and tested

## Type of Change
- [ ] `fix:` Bug fix
- [ ] `feat:` New feature
- [ ] `refactor:` Code refactoring
- [ ] `docs:` Documentation
- [ ] `test:` Tests
- [ ] `chore:` Maintenance/tooling
- [ ] `ci:` CI/CD changes

## Security & Quality Checklist
- [ ] No secrets or API keys committed (ghp_, sk-, AKIA, xoxb, xoxp patterns checked)
- [ ] JSON files validate cleanly
- [ ] Shell scripts pass shellcheck (if applicable)
- [ ] Pre-commit hooks pass locally (if configured)
- [ ] No sensitive data exposed in logs or output
- [ ] Follows conventional commits format

## If you changed dependencies or `package.json` (`bin` / `files` / deps)
- [ ] Ran `yarn install --mode=update-lockfile` and committed the `yarn.lock` change. CI runs Yarn in hardened mode on public PRs and fails if the lockfile would be modified, so an out of date `yarn.lock` breaks the build even when nothing else is wrong.

## If you added a skill, command, agent, hook, or CLI tool
- [ ] Registered in `package.json` (`bin` and `files`), `manifests/install-components.json`, `manifests/install-modules.json`, and `agent.yaml`
- [ ] Regenerated the catalog (`npm run catalog:sync`) and command registry (`npm run command-registry:write`)
- [ ] Updated the docs tables it belongs in (`README.md`, `COMMANDS-QUICK-REF.md`, `docs/COMMAND-AGENT-MAP.md`)
- [ ] If it ships a new script path, added it to the publish surface allowlist (`tests/scripts/npm-publish-surface.test.js`)
- [ ] Cross-harness surfaces updated if applicable (for Codex, `.agents/skills/<name>/` plus `agents/openai.yaml`; the Codex frontmatter validator allows only `name`, `description`, `metadata`, `license`, `allowed-tools`, so drop keys like `version` from that copy)
- [ ] Full gauntlet passes locally (`npm test`)

## Documentation
- [ ] Updated relevant documentation
- [ ] Added comments for complex logic
- [ ] README updated (if needed)
