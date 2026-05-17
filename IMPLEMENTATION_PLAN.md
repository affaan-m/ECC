## Stage 1: Align Manifest And Validators
**Goal**: Make plugin metadata and validation scripts match the fork's nested language-specific layout before importing upstream content.
**Success Criteria**: `.claude-plugin/plugin.json` points at existing nested agent files, docs describe nested paths, and validators accept nested TypeScript/Python/Rust/Common names without false flat-layout assumptions.
**Tests**: `node scripts/node/ci/validate-agents.js`, `node scripts/node/ci/validate-commands.js`, `node scripts/node/ci/validate-rules.js`, `node scripts/node/ci/validate-skills.js`, `node tests/ci/validators.test.js`, `node tests/hooks/hooks.test.js`
**Status**: Complete

## Stage 2: Port Language-Specific Upstream Surface
**Goal**: Port selected upstream TypeScript, Python, Rust, and FastAPI review agents/commands/rules/skills into the current language directory structure.
**Success Criteria**: Imported files live under language-specific directories with local naming conventions, command and agent references resolve, and no broad upstream flat layout or editor-specific settings are copied wholesale.
**Tests**: Validator scripts plus focused command/agent reference tests.
**Status**: In Progress

## Stage 3: Port Verification, Security, And Docs
**Goal**: Bring in selected upstream validation/security utilities and structure docs that support the curated language surface.
**Success Criteria**: Security/verification additions are scoped to existing project tooling, docs describe the fork's nested layout, and references do not point to excluded upstream surfaces.
**Tests**: Relevant validator/test suite and manual documentation reference check.
**Status**: Not Started
