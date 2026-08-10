# Everything Claude Code (ECC) — Agent Instructions

This is a **production-ready AI coding plugin** providing 67 specialized agents, 285 skills, 94 commands, and automated hook workflows for software development.

**Version:** 2.2.0

## Core Principles

1. **Agent-First** — Delegate to specialized agents for domain tasks
2. **Test-Driven** — Write tests before implementation, 80%+ coverage required
3. **Security-First** — Never compromise on security; validate all inputs
4. **Immutability** — Always create new objects, never mutate existing ones
5. **Plan Before Execute** — Plan complex features before writing code

## Available Agents

| Agent | Purpose | When to Use |
|-------|---------|-------------|
| planner | Implementation planning | Complex features, refactoring |
| architect | System design and scalability | Architectural decisions |
| tdd-guide | Test-driven development | New features, bug fixes |
| code-reviewer | Code quality and maintainability | After writing/modifying code |
| security-reviewer | Vulnerability detection | Before commits, sensitive code |
| spec-miner | Brownfield spec extraction | Onboarding brownfield projects to spec-driven development |
| build-error-resolver | Fix build/type errors | When build fails |
| e2e-runner | End-to-end Playwright testing | Critical user flows |
| refactor-cleaner | Dead code cleanup | Code maintenance |
| doc-updater | Documentation and codemaps | Updating docs |
| cpp-reviewer | C/C++ code review | C and C++ projects |
| cpp-build-resolver | C/C++ build errors | C and C++ build failures |
| fsharp-reviewer | F# functional code review | F# projects |
| docs-lookup | Documentation lookup via Context7 | API/docs questions |
| go-reviewer | Go code review | Go projects |
| go-build-resolver | Go build errors | Go build failures |
| kotlin-reviewer | Kotlin code review | Kotlin/Android/KMP projects |
| kotlin-build-resolver | Kotlin/Gradle build errors | Kotlin build failures |
| database-reviewer | PostgreSQL/Supabase specialist | Schema design, query optimization |
| python-reviewer | Python code review | Python projects |
| django-reviewer | Django code review | Django apps, DRF APIs, ORM, migrations |
| django-build-resolver | Django build, migration, and setup errors | Django startup, dependency, migration, collectstatic failures |
| java-reviewer | Java and Spring Boot code review | Java/Spring Boot projects |
| java-build-resolver | Java/Maven/Gradle build errors | Java build failures |
| loop-operator | Autonomous loop execution | Run loops safely, monitor stalls, intervene |
| harness-optimizer | Harness config tuning | Reliability, cost, throughput |
| rust-reviewer | Rust code review | Rust projects |
| rust-build-resolver | Rust build errors | Rust build failures |
| pytorch-build-resolver | PyTorch runtime/CUDA/training errors | PyTorch build/training failures |
| mle-reviewer | Production ML pipeline review | ML pipelines, evals, serving, monitoring, rollback |
| typescript-reviewer | TypeScript/JavaScript code review | TypeScript/JavaScript projects |
| react-reviewer | React/JSX code review | React component and hook changes |
| react-build-resolver | React/Vite/Next.js/webpack build errors | React build failures |
| vue-reviewer | Vue.js Composition API and reactivity review | Vue component, Pinia, and Nuxt changes |
| swift-reviewer | Swift/iOS code review | Swift code changes |
| swift-build-resolver | Swift/Xcode/SPM build errors | Swift build failures |
| flutter-reviewer | Flutter/Dart widget and state review | Flutter app changes |
| dart-build-resolver | Dart/Flutter build and pub dependency errors | Flutter compilation failures |
| csharp-reviewer | C#/.NET async patterns, nullability, security | All C# code changes |
| fastapi-reviewer | FastAPI async correctness, Pydantic, OpenAPI | FastAPI endpoint and schema changes |
| php-reviewer | PHP/PSR-12, Eloquent, security review | PHP code changes |
| harmonyos-app-resolver | HarmonyOS/ArkTS build and API errors | HarmonyOS project failures |
| healthcare-reviewer | Clinical safety, PHI compliance, CDSS accuracy | Healthcare, EMR/EHR application code |
| a11y-architect | WCAG 2.2 accessibility architecture | Designing UI components, accessibility audits |
| code-architect | Feature architecture blueprints from codebase patterns | New features needing implementation design |
| network-architect | Enterprise multi-site network architecture | Complex network design decisions |
| homelab-architect | Home/small-lab network design | Home infrastructure planning |
| network-config-reviewer | Router/switch config security and correctness | Network configuration changes |
| network-troubleshooter | OSI-layer connectivity and routing diagnosis | Network connectivity and routing issues |
| performance-optimizer | Bottleneck detection, bundle size, memory leaks | Slow code or high resource usage |
| silent-failure-hunter | Swallowed errors and missing propagation | Code reliability audits |
| type-design-analyzer | Type encapsulation and invariant design | TypeScript type system reviews |
| pr-test-analyzer | PR test coverage quality and completeness | Before merging pull requests |
| code-explorer | Execution path tracing and architecture mapping | Understanding unfamiliar code paths |
| code-simplifier | Clarity-focused code refinement without behavior change | Post-implementation cleanup |
| comment-analyzer | Comment accuracy, freshness, and rot risk | Code comment audits |
| agent-evaluator | 5-axis quality scoring for agent output | Evaluating task completion quality |
| chief-of-staff | Multi-channel communication triage and drafting | Managing email/Slack communication workflows |
| conversation-analyzer | Extract hook behaviors from session transcripts | Creating hooks from observed patterns |
| marketing-agent | Campaign planning, copy creation, content calendars | Product launches, marketing campaigns |
| seo-specialist | Technical SEO audit, structured data, Core Web Vitals | Site audits, meta tag and schema issues |
| opensource-forker | Fork projects and strip secrets for open-sourcing | Starting an open-source release |
| opensource-sanitizer | Verify sanitized fork is release-ready | Before any public release |
| opensource-packager | Generate OSS packaging boilerplate (README, LICENSE, etc.) | Finalizing an open-source release |
| gan-planner | Expand a prompt into a full product specification | Starting a GAN harness session |
| gan-generator | Implement features per spec, iterate on evaluator feedback | GAN harness implementation phase |
| gan-evaluator | Test running application via Playwright and score it | GAN harness evaluation phase |

## Agent Orchestration

Use agents proactively without user prompt:
- Complex feature requests → **planner**
- Code just written/modified → **code-reviewer**
- Bug fix or new feature → **tdd-guide**
- Architectural decision → **architect**
- Security-sensitive code → **security-reviewer**
- Brownfield project onboarding → **spec-miner**
- Autonomous loops / loop monitoring → **loop-operator**
- Harness config reliability and cost → **harness-optimizer**
- Performance bottleneck or slow code → **performance-optimizer**
- React/JSX changes → **react-reviewer**
- Vue changes → **vue-reviewer**
- Swift changes → **swift-reviewer**
- C# changes → **csharp-reviewer**
- PHP changes → **php-reviewer**
- Flutter/Dart changes → **flutter-reviewer**
- Healthcare/clinical code → **healthcare-reviewer**
- UI component design → **a11y-architect**
- Open-source release prep → **opensource-forker** → **opensource-sanitizer** → **opensource-packager**
- Agent output quality check → **agent-evaluator**

Use parallel execution for independent operations — launch multiple agents simultaneously.

## Security Guidelines

**Before ANY commit:**
- No hardcoded secrets (API keys, passwords, tokens)
- All user inputs validated
- SQL injection prevention (parameterized queries)
- XSS prevention (sanitized HTML)
- CSRF protection enabled
- Authentication/authorization verified
- Rate limiting on all endpoints
- Error messages don't leak sensitive data

**Secret management:** NEVER hardcode secrets. Use environment variables or a secret manager. Validate required secrets at startup. Rotate any exposed secrets immediately.

**If security issue found:** STOP → use security-reviewer agent → fix CRITICAL issues → rotate exposed secrets → review codebase for similar issues.

## Coding Style

**Immutability (CRITICAL):** Always create new objects, never mutate. Return new copies with changes applied.

**File organization:** Many small files over few large ones. 200-400 lines typical, 800 max. Organize by feature/domain, not by type. High cohesion, low coupling.

**Error handling:** Handle errors at every level. Provide user-friendly messages in UI code. Log detailed context server-side. Never silently swallow errors.

**Input validation:** Validate all user input at system boundaries. Use schema-based validation. Fail fast with clear messages. Never trust external data.

**Code quality checklist:**
- Functions small (<50 lines), files focused (<800 lines)
- No deep nesting (>4 levels)
- Proper error handling, no hardcoded values
- Readable, well-named identifiers

## Testing Requirements

**Minimum coverage: 80%**

Test types (all required):
1. **Unit tests** — Individual functions, utilities, components
2. **Integration tests** — API endpoints, database operations
3. **E2E tests** — Critical user flows

**TDD workflow (mandatory):**
1. Write test first (RED) — test should FAIL
2. Write minimal implementation (GREEN) — test should PASS
3. Refactor (IMPROVE) — verify coverage 80%+

Troubleshoot failures: check test isolation → verify mocks → fix implementation (not tests, unless tests are wrong).

## Development Workflow

1. **Plan** — Use planner agent, identify dependencies and risks, break into phases
2. **TDD** — Use tdd-guide agent, write tests first, implement, refactor
3. **Review** — Use code-reviewer agent immediately, address CRITICAL/HIGH issues
4. **Capture knowledge in the right place**
   - Personal debugging notes, preferences, and temporary context → auto memory
   - Team/project knowledge (architecture decisions, API changes, runbooks) → the project's existing docs structure
   - If the current task already produces the relevant docs or code comments, do not duplicate the same information elsewhere
   - If there is no obvious project doc location, ask before creating a new top-level file
5. **Commit** — Conventional commits format, comprehensive PR summaries

## Workflow Surface Policy

- `skills/` is the canonical workflow surface.
- New workflow contributions should land in `skills/` first.
- `commands/` is a legacy slash-entry compatibility surface and should only be added or updated when a shim is still required for migration or cross-harness parity.

## Git Workflow

**Commit format:** `<type>: <description>` — Types: feat, fix, refactor, docs, test, chore, perf, ci

**PR workflow:** Analyze full commit history → draft comprehensive summary → include test plan → push with `-u` flag.

## Architecture Patterns

**API response format:** Consistent envelope with success indicator, data payload, error message, and pagination metadata.

**Repository pattern:** Encapsulate data access behind standard interface (findAll, findById, create, update, delete). Business logic depends on abstract interface, not storage mechanism.

**Skeleton projects:** Search for battle-tested templates, evaluate with parallel agents (security, extensibility, relevance), clone best match, iterate within proven structure.

## Performance

**Context management:** Avoid last 20% of context window for large refactoring and multi-file features. Lower-sensitivity tasks (single edits, docs, simple fixes) tolerate higher utilization.

**Build troubleshooting:** Use build-error-resolver agent → analyze errors → fix incrementally → verify after each fix.

## Project Structure

```
agents/          — 67 specialized subagents
skills/          — 285 workflow skills and domain knowledge
commands/        — 94 slash commands
hooks/           — Trigger-based automations
rules/           — Always-follow guidelines (common + per-language)
scripts/         — Cross-platform Node.js utilities
mcp-configs/     — 14 MCP server configurations
tests/           — Test suite
```

`commands/` remains in the repo for compatibility, but the long-term direction is skills-first.

## Success Metrics

- All tests pass with 80%+ coverage
- No security vulnerabilities
- Code is readable and maintainable
- Performance is acceptable
- User requirements are met
