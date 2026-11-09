# Copilot custom-agent tool restrictions

P09 implementation, 3 November 2026. Native enforcement is **unverified** until
both direct and delegated invocation are exercised on a pinned Copilot CLI.

The installer now emits an explicit `tools` list and `strict-tools-list: true`
for every projected ECC agent. Previously it removed `tools`, which Copilot
interprets as access to every available tool. Tool selection never grants tool
auto-approval or bypasses the operator's permission settings.

| Canonical names | Copilot group |
| --- | --- |
| Read, NotebookRead | read |
| Grep, Glob | search |
| Write, Edit, MultiEdit, NotebookEdit | edit |
| Bash, PowerShell, shell | execute |
| Task, custom-agent | agent |
| WebSearch, WebFetch | web |
| TodoWrite | todo |

Aliases are case insensitive and repeated groups collapse. Copilot groups can
combine operations that Claude names separately: `edit` is a group, not a
promise to allow only creation or only replacement. The native acceptance run
must verify the effective tool inventory for each declared profile.

Agent names ending in `reviewer` or `analyzer`, plus `agent-evaluator`, receive
only authored read/search groups. Shells, edit, delegation and remote tools are
removed, since they can mutate files or external state. A visible notice in the
projected body describes this narrowing. This deliberately prevents reviewers
from running tests themselves; a separate implementation agent runs them and
provides evidence for review. These are policy projections, not proof that the
host enforces them.

Missing, invalid or unmapped declarations produce **`tools: []`**, together with
an incompatibility notice. No partial list is emitted when an authored tool
cannot be mapped. Wildcards and parameterized shell permissions remain
incompatible. Claude MCP names require explicit operator mappings. By default `docs-lookup` and
`gan-evaluator` require explicit reviewed server/tool mappings before they can
operate; discovery of those agents does not certify their workflows. The
installer remains usable and does not silently give an incompatible agent more
access. Empty authored lists remain empty.

Claude model IDs and unknown metadata are removed. A programmatic operator may
pass `{ model, verifiedModels }` to `adaptCopilotAgent`; the model must occur in
the explicitly supplied verified list. This is not automatic model discovery or
a claim about account availability. The normal installer retains the session
model. Operator configuration, model entitlement and a native dispatch test are
required before advertising an override as supported.

## Explicit installer configuration

Set `ECC_COPILOT_AGENT_CONFIG` to an absolute, operator-selected JSON file before
running the normal installer or repair. The installer never discovers this file
from the project, an agent body, a hook event or recalled memory. Use a regular
file with no symlink/hardlink redirection, at most 64 KiB. The complete file is
validated before any configured agent projection is accepted. Unknown versions,
fields, malformed entries and non-verified mappings/models fail the install;
they do not fall back to broader access.

Example (tool IDs must first be checked against your actual CLI and server
registration; the strings below are configuration examples):

```json
{
  "schema": "ecc.copilot.agents.v1",
  "cliVersion": "1.0.105",
  "verifiedTools": ["context7/resolve-library-id", "context7/query-docs"],
  "verifiedModels": [],
  "agents": {
    "docs-lookup": {
      "toolMappings": {
        "mcp__context7__resolve-library-id": "context7/resolve-library-id",
        "mcp__context7__query-docs": "context7/query-docs"
      }
    }
  }
}
```

`verifiedTools` and `verifiedModels` are operator attestations, not automatic
discovery or proof that a provider exists. An optional per-agent `model` must be
listed in `verifiedModels`. Mapping targets must be exact native group or
`server/tool` names in `verifiedTools`. No wildcard is accepted, and canonical
aliases such as `Read` cannot be remapped to `execute`. Every authored unknown
tool must be mapped or the entire agent retains an incompatible empty tool list.
Reviewer/analyzer restrictions still remove execution, editing, delegation and
remote MCP tools even when a mapping is explicitly configured. Canonical reviewer
file names also enforce narrowing if their frontmatter name is changed.

On PowerShell set `$env:ECC_COPILOT_AGENT_CONFIG` to the selected absolute file
path. On POSIX set the same variable in the installer environment. No config
contents or credentials are copied into the installed project. Selected tool
lists and optional models are the only emitted capability metadata. Keep the
operator file available and unchanged for reproducible repair. Removing the
setting restores default projections on subsequent rendering; no permissive
list is reconstructed from installed agent instructions.

Preview the exact projection status before installation:

```text
node scripts/copilot-agents.js report
```

The report uses the same projection function as installation and names each
incompatible/restricted agent. It is read-only and emits no agent bodies or
configuration contents. The default catalog reports `docs-lookup` and
`gan-evaluator` as incompatible; an explicitly complete reviewed mapping can
resolve either one. It never reports native enforcement as certified.

The original agent instructions remain verbatim after the projection notice.
Instructions requesting additional tools cannot change the emitted list.
Agents with incompatible tools should be excluded from a certified profile
until their mapping has been reviewed and tested. Rollback must retain explicit
restrictions or exclude the agent; restoring omission of `tools` widens access.

## Verification

`node tests/lib/copilot-agent-tools.test.js` checks aliases, empty/malformed
lists, wildcards, unknown MCP tools, reviewer shell/delegation removal, model
validation, metadata filtering and all canonical agent files.
`node tests/lib/copilot-install-target.test.js` checks installer projections.

Required native acceptance: pin CLI version and OS; inspect direct and delegated
reviewer tool lists; request a fixture file edit and shell write and confirm
neither is available; confirm an implementation agent can edit only through its
configured tool groups; inspect an incompatible profile and confirm zero tools;
repeat after repair and uninstall/reinstall. Until recorded, no reviewer is
certified as read-only on the host.

## Sources

Official references consulted 3 November 2026:

- [Custom-agent configuration and aliases](https://docs.github.com/en/copilot/reference/custom-agents-configuration)
- [CLI custom agents and strict-tools-list](https://docs.github.com/en/copilot/how-tos/copilot-cli/customize-copilot/create-custom-agents-for-cli)
- [CLI command reference](https://docs.github.com/en/copilot/reference/copilot-cli-reference/cli-command-reference)
