# LinkedIn Draft - ECC v2.0.0-rc.1

ECC v2.0.0-rc.1 is ready for final release review as the first release-candidate pass at the 2.0 direction.

The practical shift is simple: ECC is no longer framed as only a Claude Code plugin or config bundle.

It is becoming a meta-harness for agentic work: the portable layer above the
individual AI coding clients.

- reusable skills instead of one-off prompts
- hooks and tests instead of manual discipline
- MCP-backed access to docs, code, browser automation, and research
- Codex, OpenCode, Cursor, Gemini, Zed, and Claude Code surfaces that share the same core workflow layer
- Hermes as the operator shell for chat, cron, handoffs, and daily work routing

For this release-candidate surface, I kept the repo honest.

I did not publish private workspace state. I shipped the reusable layer:

- sanitized Hermes setup documentation
- release notes and launch collateral
- cross-harness architecture notes
- Hermes import guidance for turning local operator patterns into public ECC skills
- release-readiness gates for PRs, issues, discussions, Linear progress, legacy tails, observability, and supply-chain checks
- a deterministic preview-pack smoke test so the public pack can be verified before a release action
- a gated Itô prediction-market skill pack for research, comparison, planning,
  and risk review, with Itô API access kept separate from ECC Tools and
  approval-based

The leverage is not just better prompting.

It is reducing the number of isolated surfaces, turning repeated workflows into
reusable skills, and making the operating system around the agent measurable.

That is the reason I like the phrase meta-harness. The goal is not to replace
the harness. The goal is to make the workflow layer above the harness portable,
auditable, and useful across teams.

The supply-chain work became part of the release story too. After the Mini
Shai-Hulud/TanStack campaign, rc.1 now includes IOC scanning, no-lifecycle CI
installs, advisory-source refresh, npm audit/signature checks, and AI-tool
persistence coverage.

There is still more to harden before GA, especially around packaging, installers, and the `ecc2/` control plane. But rc.1 is enough to show the shape clearly.

The GitHub prerelease and npm `next` package are live now. Public publication
still stays approval-gated for the plugin path, video URLs, final outbound URLs,
and any billing/native-payments claim that has not been freshly rechecked.

The release URL ledger now separates links that already resolve from links that
must wait for the remaining approval-gated plugin, video, billing, and outbound
checks.
