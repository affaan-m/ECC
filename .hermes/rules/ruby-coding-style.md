---
paths:
  - "**/*.rb"
  - "**/*.rake"
  - "**/Gemfile"
  - "**/*.gemspec"
  - "**/config.ru"
---
# Ruby Coding Style

> This file extends [common/coding-style.md](../common/coding-style.md) with Ruby and Rails specific content.

## Standards

- Target **Ruby 3.3+** for new Rails work unless the project already pins an older supported runtime.
- Enable **YJIT** in production only after measuring boot time, memory, and request/job throughput.
- Add `# frozen_string_literal: true` to new Ruby files when the project uses that convention.
- Prefer clear Ruby over clever metaprogramming; isolate DSL-heavy code behind narrow, tested boundaries.

## Formatting And Linting

- Use the project's checked-in RuboCop config. For Rails 8+ apps, start from `rubocop-rails-omakase` and customize only where the codebase has a real convention.
- Keep formatter/linter commands behind binstubs or scripts so CI and local runs match:

```bash
bundle exec rubocop
bundle exec rubocop -A
```

- Do not silence cops inline unless the exception is narrow, documented, and harder to express cleanly in code.

## Rails Style

- Follow Rails naming and directory conventions before adding custom structure.
- Keep controllers transport-focused: authentication, authorization, parameter handling, response shape.
- Put reusable domain behavior in models, concerns, service objects, query objects, or form objects based on actual complexity, not as default ceremony.
- Prefer `bin/rails`, `bin/rake`, and checked-in binstubs over globally installed commands.

## Error Handling

- Rescue specific exceptions. Avoid broad `rescue StandardError` blocks unless they re-raise or preserve enough context for operators.
- Use `ActiveSupport::Notifications` or the app's logger for operational events; do not leave `puts`, `pp`, or `debugger` in committed application code.

## Reference

See skill: `backend-patterns` for broader service/repository layering guidance.
