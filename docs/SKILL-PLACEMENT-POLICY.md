# Skill Placement Policy

This fork keeps curated skills in language-specific directories instead of the flat upstream layout.

## Curated Skills

Curated skills live in this repository and are shipped by the plugin:

| Scope | Path |
|-------|------|
| Common | `skills/common/<skill-name>/` |
| Node and TypeScript | `skills/node/<node-skill-name>/` |
| Python | `skills/python/<python-skill-name>/` |
| Rust | `skills/rust/<rust-skill-name>/` |

Each skill directory must contain a non-empty `SKILL.md`.

## Local-Only Skills

Generated or user-specific skills must not be committed to this repository.

| Type | Path |
|------|------|
| Learned | `~/.claude/skills/learned/<skill-name>/` |
| Imported | `~/.claude/skills/imported/<skill-name>/` |
| Evolved | `~/.claude/homunculus/**/evolved/skills/<skill-name>/` |

Local-only skills should carry provenance metadata where the generating workflow supports it. They are not referenced by plugin manifests or install scripts.

## Naming

Language-specific shipped skills keep the language prefix in the skill directory name when that matches the surrounding surface, for example:

- `skills/python/python-patterns/`
- `skills/python/fastapi-patterns/`
- `skills/node/node-tdd-workflow/`

Do not copy upstream flat paths directly into `skills/`. Port them into the matching language directory and update command references to the nested path.

## Validation

Run these checks after adding or moving skills:

```bash
node scripts/node/ci/validate-skills.js
node scripts/node/ci/validate-commands.js
node tests/ci/validators.test.js
```
