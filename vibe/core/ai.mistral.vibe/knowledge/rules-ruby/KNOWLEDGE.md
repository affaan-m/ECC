---
name: rules-ruby
description: ECC ruby engineering rules for coding style, patterns, security, and testing.
display_name: "ECC Ruby Rules"
icon: book
---

# ECC Ruby Rules

## Ruby Coding Style

> This file extends [common/coding-style.md](../common/coding-style.md) with Ruby and Rails specific content.

### Standards

- Target **Ruby 3.3+** for new Rails work unless the project already pins an older supported runtime.
- Enable **YJIT** in production only after measuring boot time, memory, and request/job throughput.
- Add `# frozen_string_literal: true` to new Ruby files when the project uses that convention.
- Prefer clear Ruby over clever metaprogramming; isolate DSL-heavy code behind narrow, tested boundaries.

### Formatting And Linting

- Use the project's checked-in RuboCop config. For Rails 8+ apps, start from `rubocop-rails-omakase` and customize only where the codebase has a real convention.
- Keep formatter/linter commands behind binstubs or scripts so CI and local runs match:

```bash
bundle exec rubocop
bundle exec rubocop -A
```

- Do not silence cops inline unless the exception is narrow, documented, and harder to express cleanly in code.

### Rails Style

- Follow Rails naming and directory conventions before adding custom structure.
- Keep controllers transport-focused: authentication, authorization, parameter handling, response shape.
- Put reusable domain behavior in models, concerns, service objects, query objects, or form objects based on actual complexity, not as default ceremony.
- Prefer `bin/rails`, `bin/rake`, and checked-in binstubs over globally installed commands.

### Error Handling

- Rescue specific exceptions. Avoid broad `rescue StandardError` blocks unless they re-raise or preserve enough context for operators.
- Use `ActiveSupport::Notifications` or the app's logger for operational events; do not leave `puts`, `pp`, or `debugger` in committed application code.

### Reference

See skill: `backend-patterns` for broader service/repository layering guidance.

## Ruby Hooks

> This file extends [common/hooks.md](../common/hooks.md) with Ruby and Rails specific content.

### PostToolUse Hooks

Configure project-local hooks to prefer binstubs and checked-in tooling:

- **RuboCop**: run `bundle exec rubocop -A <file>` or the project's safer formatter command after Ruby edits.
- **Brakeman**: run `bundle exec brakeman --no-progress` after security-sensitive Rails changes.
- **Tests**: run the narrowest matching `bin/rails test ...` or `bundle exec rspec ...` command for touched files.
- **Bundler audit**: run `bundle exec bundle-audit check --update` when `Gemfile` or `Gemfile.lock` changes and the project has bundler-audit installed.

### Warnings

- Warn on committed `debugger`, `binding.irb`, `binding.pry`, `puts`, `pp`, or `p` calls in application code.
- Warn when an edit disables CSRF protection, expands mass-assignment, or adds raw SQL without parameterization.
- Warn when a migration changes data destructively without a reversible path or documented rollout plan.

### CI Gate Suggestions

```bash
bundle exec rubocop
bundle exec brakeman --no-progress
bin/rails test
bundle exec rspec
```

Use only the commands that are present in the project; do not install new hook dependencies without maintainer approval.

## Ruby Patterns

> This file extends [common/patterns.md](../common/patterns.md) with Ruby and Rails specific content.

### Rails Way First

- Start with plain Rails MVC and Active Record conventions for small and medium features.
- Introduce service objects, query objects, form objects, decorators, or presenters when the model/controller boundary is carrying multiple responsibilities.
- Name extracted objects after the business operation they perform, not after generic layers like `Manager` or `Processor`.

### Persistence

- Prefer PostgreSQL for multi-host production Rails apps unless the existing platform has a clear reason for MySQL or SQLite.
- Treat Rails 8 SQLite-backed defaults as viable for single-host or modest deployments, not as an automatic fit for shared multi-service systems.
- Keep raw SQL behind query objects or model scopes and parameterize every dynamic value.

### Background Jobs And Runtime Services

- Use **Solid Queue** for greenfield Rails 8 apps with modest throughput and simple deployment needs.
- Use **Sidekiq** when the app needs mature observability, high throughput, existing Redis infrastructure, or Pro/Enterprise features.
- Use **Solid Cache** and **Solid Cable** when their deployment model matches the app; use Redis when shared cross-service behavior, high fanout, or advanced data structures matter.

### Frontend

- Prefer **Hotwire** with Turbo, Stimulus, Importmap, and Propshaft for server-rendered Rails apps.
- Use React, Vue, Inertia.js, or a separate SPA when interaction complexity, existing product architecture, or team ownership justifies the extra client surface.
- Keep view components, partials, and presenters focused on rendering decisions; keep persistence and authorization out of templates.

### Authentication

- Use the Rails 8 authentication generator for straightforward session auth and password reset needs.
- Use Devise or another established auth system when requirements include OAuth, MFA, confirmable/lockable flows, multi-model auth, or a large existing Devise footprint.

### Reference

See skill: `backend-patterns` for service boundaries and adapter patterns.

## Ruby Security

> This file extends [common/security.md](../common/security.md) with Ruby and Rails specific content.

### Rails Defaults

- Keep CSRF protection enabled for state-changing browser requests.
- Use strong parameters or typed boundary objects before mass assignment.
- Store secrets in Rails credentials, environment variables, or a secret manager. Never commit plaintext keys, tokens, private credentials, or copied `.env` values.

### SQL And Active Record

- Prefer Active Record query APIs and parameterized SQL.
- Never interpolate request, cookie, header, job, or webhook values into SQL strings.
- Scope model callbacks carefully; security-sensitive side effects should be explicit and covered by tests.

### Authentication And Sessions

- Use the Rails 8 authentication generator for simple session auth, or Devise when OAuth, MFA, confirmable, lockable, multi-model auth, or existing Devise conventions are required.
- Rotate sessions after sign-in and privilege changes.
- Protect account recovery flows with expiry, single-use tokens, rate limiting, and audit logging.

### Dependencies

- Run dependency checks when the lockfile changes:

```bash
bundle exec bundle-audit check --update
bundle exec brakeman --no-progress
```

- Review new gems for maintainer activity, native extension risk, transitive dependencies, and whether the same behavior can be implemented with Rails core.

### Web Safety

- Escape template output by default. Treat `html_safe`, `raw`, and custom sanitizers as security-sensitive code.
- Validate file uploads by content type, extension, size, and storage destination.
- Treat background jobs, webhooks, Action Cable messages, and Turbo Stream inputs as untrusted boundaries.

### Reference

See skill: `security-review` for secure-by-default review patterns.

## Ruby Testing

> This file extends [common/testing.md](../common/testing.md) with Ruby and Rails specific content.

### Framework

- Use **Minitest** when the Rails app follows the default Rails test stack.
- Use **RSpec** when it is already established in the project or the team has explicit production conventions around it.
- Do not mix Minitest and RSpec inside the same feature area without a migration reason.

### Test Pyramid

- Put fast domain behavior in model, service, query, policy, and job tests.
- Use request/controller tests for HTTP contracts, auth behavior, redirects, status codes, and response shapes.
- Use system tests with Capybara for browser-critical flows only; keep them focused and stable.
- Cover background jobs with unit tests for behavior and integration tests for queue/enqueue contracts.

### Fixtures And Factories

- Use Rails fixtures when they are the project default and the data graph is small.
- Use `factory_bot` when scenarios need explicit object construction or complex traits.
- Keep test data close to the behavior being asserted; avoid global fixtures that hide setup cost.

### Commands

Prefer project-local commands:

```bash
bin/rails test
bin/rails test test/models/user_test.rb
bundle exec rspec
bundle exec rspec spec/models/user_spec.rb
```

### Coverage

- Use SimpleCov when coverage is enforced; keep thresholds in CI and avoid gaming branch coverage with low-value tests.
- Add regression tests for bug fixes before changing production code.

### Reference

See skill: `tdd-workflow` for the repo-wide RED -> GREEN -> REFACTOR loop.
