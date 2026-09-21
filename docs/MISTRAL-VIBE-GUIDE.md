# Mistral Vibe integration

ECC provides a project-local, skills-first integration for Mistral Vibe. The
contract in this guide is verified against **Mistral Vibe v2.25.3**.

## Install a skill

Run the installer from the project that Vibe will open. Keep the ECC source
checkout separate so managed files are written to the target project:

```bash
ECC_ROOT="/absolute/path/to/ECC"
"$ECC_ROOT/install.sh" --target mistral-vibe --skills tdd-workflow
```

After a release containing this target is published, verify the registry
version and pin that released version:

```bash
npm view ecc-universal version
npx ecc-universal@<released-version> install --target mistral-vibe --skills tdd-workflow
```

Install multiple skills with a comma-separated list:

```bash
"$ECC_ROOT/install.sh" --target mistral-vibe --skills tdd-workflow,security-review
```

ECC writes each selected skill to `.vibe/skills/<name>/`. Vibe discovers this
directory natively for trusted projects and loads each `SKILL.md` through its
Agent Skills implementation. ECC records only its managed files in
`.vibe/ecc-install-state.json`; an existing user-owned skill file is preserved.

## Verify and maintain the install

```bash
node "$ECC_ROOT/scripts/list-installed.js" --target mistral-vibe
node "$ECC_ROOT/scripts/doctor.js" --target mistral-vibe
node "$ECC_ROOT/scripts/repair.js" --target mistral-vibe
node "$ECC_ROOT/scripts/uninstall.js" --target mistral-vibe
```

Use `--dry-run --json` with install, repair, or uninstall to inspect changes
before writing them. Repair restores missing or drifted ECC-managed skill files.
Uninstall removes unchanged managed files, but preserves modified files and the
install-state so they can be reviewed.

## Compatibility boundary

This first integration deliberately installs Agent Skills only. It does not
configure Vibe model/provider credentials, `.vibe/config.toml`, MCP servers, or
`.vibe/hooks.toml`. It also does not translate ECC's Claude-oriented agent
Markdown into `.vibe/agents/*.toml`, and it does not claim that ECC command or
rule directories are native Vibe surfaces.

Vibe also discovers project-level `.agents/skills/` and root `AGENTS.md`, but
ECC uses `.vibe/skills/` so every managed write and lifecycle action stays
inside one project-local ownership boundary.

Official references:

- [Mistral Vibe](https://github.com/mistralai/mistral-vibe)
- [Agent Skills specification](https://agentskills.io/specification)
