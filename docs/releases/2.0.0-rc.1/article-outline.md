# Article Outline - ECC v2.0.0-rc.1

## Working Title

Turning ECC Into a Cross-Harness Operating System

## Core Argument

Most agentic work breaks down because the tools stay isolated.

The leverage comes from treating the harness, reusable workflow layer, and operator shell as one system:

- skills for repeatable work
- hooks and tests for enforcement
- MCPs for tool access
- memory and handoffs for continuity
- one operator shell that can route daily execution

## Structure

### 1. The Problem

- too many chat windows
- too many tool-specific workflows
- too much context living in personal habit instead of reusable system shape

### 2. What ECC Already Solved

- reusable skill format
- cross-harness install surfaces
- hooks and verification discipline
- security and review patterns
- operator workflow skills around content, research, and business ops
- queue, discussion, Linear, legacy, and release-evidence checks that make the
  operating state inspectable
- supply-chain IOC scanning and no-lifecycle install hardening after the
  Mini Shai-Hulud/TanStack campaign

### 3. Why Hermes Is the Operator Layer

- chat, CLI, TUI, cron, and handoffs can sit above the reusable ECC layer
- business and content work can run next to engineering work
- the daily loop becomes easier to inspect and improve

### 4. What Ships in rc.1

- sanitized Hermes setup guide
- release and distribution collateral
- cross-harness architecture doc
- Hermes import guidance
- clearer 2.0 positioning in the repo
- preview-pack smoke gate
- launch drafts for GitHub release copy, X, LinkedIn, article, Telegram/Hermes
  handoff, and demo prompts

### 5. What Changed Since v1.10.0

- Claude Code remains the core target, but ECC now treats Codex, OpenCode,
  Cursor, Gemini, Zed, and terminal-only workflows as shared execution surfaces.
- The release process now has repeatable platform, discussion, observability,
  supply-chain, Linear progress, and preview-pack checks.
- AgentShield and ECC Tools work is mirrored into the roadmap so enterprise
  security, hosted review, policy promotion, and billing-readiness lanes do not
  drift away from the main release.

### 6. What Stays Local

- secrets and auth
- raw workspace exports
- personal datasets
- operator-specific automations that have not been sanitized
- deeper CRM, finance, and Google Workspace playbooks

### 7. Closing Point

The goal is not to copy one exact stack.

The goal is to build an operating system around the agent that turns repeated work into reusable, measurable surfaces.
