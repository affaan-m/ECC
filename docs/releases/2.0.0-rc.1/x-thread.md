# X Thread Draft - ECC v2.0.0-rc.1

1/ ECC v2.0.0-rc.1 is the first release-candidate pass at the 2.0 direction.

The repo is moving from a Claude Code config pack into a cross-harness operating system for agentic work.

2/ The important split:

ECC is the reusable substrate.
Hermes is the operator shell that can run on top.

Skills, hooks, MCP configs, rules, and workflow packs live in ECC.

3/ Claude Code is still a core target.

Codex, OpenCode, Cursor, Gemini, and other harnesses are part of the same story now.

The goal is fewer one-off harness tricks and more reusable workflow surface.

4/ Since v1.10.0, the work also picked up the operator layer:

PR/issue/discussion audits, Linear progress sync, release evidence, observability checks, and a generated readiness dashboard.

5/ The security posture changed too.

The Mini Shai-Hulud/TanStack campaign forced a real supply-chain loop:

- IOC scanning
- no-lifecycle CI installs
- advisory-source refresh
- npm audit/signature checks
- AI-tool persistence targets

6/ The rc.1 surface ships the public pieces:

- Hermes setup guide
- release notes
- launch checklist
- cross-harness architecture doc
- Hermes import guidance
- preview-pack smoke gate
- X, LinkedIn, and article drafts

7/ It does not ship private workspace state.

No secrets.
No OAuth tokens.
No raw local exports.
No personal datasets.

The point is to publish the reusable system shape.

8/ Why Hermes matters:

Most agent systems fail in the daily operating loop.

They can code, but they do not keep research, content, handoffs, reminders, and execution in one measurable surface.

9/ ECC gives the reusable layer.

Hermes gives the operator shell.

Together they make the work feel less like scattered chat windows and more like a system you can run.

10/ This is still a release candidate.

The public docs and reusable surfaces are ready for review.

The deeper local integrations stay local until they are sanitized, and publication still waits on the GitHub release, npm, plugin, and final URL gates.

11/ Start here:

Repo:
<https://github.com/affaan-m/ECC>

Hermes x ECC setup:
<https://github.com/affaan-m/ECC/blob/main/docs/HERMES-SETUP.md>

12/ Release notes:
<https://github.com/affaan-m/ECC/blob/main/docs/releases/2.0.0-rc.1/release-notes.md>

URL ledger:
<https://github.com/affaan-m/ECC/blob/main/docs/releases/2.0.0-rc.1/release-url-ledger-2026-05-19.md>
