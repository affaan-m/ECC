# X Thread Draft - ECC v2.0.0-rc.1

1/ ECC v2.0.0-rc.1 is the first release-candidate pass at the 2.0 direction.

The repo is moving from a Claude Code config pack into a meta-harness for
agentic work.

2/ The important split:

ECC is the reusable substrate.
Hermes is the operator shell that can run on top.

Skills, hooks, MCP configs, rules, and workflow packs live in ECC.

3/ A meta-harness matters because the agent layer is fragmenting.

Claude Code, Codex, OpenCode, Cursor, Gemini, Zed, Copilot, and terminal
workflows all need similar operating primitives:

- context
- tools
- memory
- gates
- evaluation
- release evidence
- security checks

4/ ECC gives those primitives a shared shape instead of leaving every workflow
stuck inside one client.

Use the harness you like. Keep the workflow layer portable.

5/ Since v1.10.0, the work also picked up the operator layer:

PR/issue/discussion audits, Linear progress sync, release evidence, observability checks, and a generated readiness dashboard.

6/ The security posture changed too.

The Mini Shai-Hulud/TanStack campaign forced a real supply-chain loop:

- IOC scanning
- no-lifecycle CI installs
- advisory-source refresh
- npm audit/signature checks
- AI-tool persistence targets

7/ The rc.1 surface ships the public pieces:

- Hermes setup guide
- release notes
- launch checklist
- cross-harness architecture doc
- Hermes import guidance
- preview-pack smoke gate
- X, LinkedIn, and article drafts

8/ It also adds the public teaser surface for the Itô prediction-market skill
pack.

That is separate from ECC Tools billing and Itô remains a separate business.

The public skills are research, comparison, planning, and risk review.

9/ Important boundary:

No investment advice.
No default live trading.
No private keys.
No Itô-backed call without explicit gated API access.

Useful workflow shape first, gated data access second.

10/ It does not ship private workspace state.

No secrets.
No OAuth tokens.
No raw local exports.
No personal datasets.

The point is to publish the reusable system shape.

11/ Why Hermes matters:

Most agent systems fail in the daily operating loop.

They can code, but they do not keep research, content, handoffs, reminders, and execution in one measurable surface.

12/ ECC gives the reusable layer.

Hermes gives the operator shell.

Together they make the work feel less like scattered chat windows and more like a system you can run.

13/ This is still a release candidate.

The public docs and reusable surfaces are ready for review.

The deeper local integrations stay local until they are sanitized. The GitHub prerelease and npm `next` package are live; plugin, video, billing, and final outbound URLs still stay behind the approval gate.

14/ Start here:

Repo:
<https://github.com/affaan-m/ECC>

Hermes x ECC setup:
<https://github.com/affaan-m/ECC/blob/main/docs/HERMES-SETUP.md>

15/ Release notes:
<https://github.com/affaan-m/ECC/blob/main/docs/releases/2.0.0-rc.1/release-notes.md>

Itô skill pack boundary:
<https://github.com/affaan-m/ECC/blob/main/docs/releases/2.0.0-rc.1/ito-prediction-market-skill-pack.md>

URL ledger:
<https://github.com/affaan-m/ECC/blob/main/docs/releases/2.0.0-rc.1/release-url-ledger-2026-05-19.md>
