---
paths:
  - "**/*.rb"
  - "**/*.rake"
  - "**/Gemfile"
  - "**/Gemfile.lock"
  - "**/config/routes.rb"
---
# Ruby Hooks

> This file extends [common/hooks.md](../common/hooks.md) with Ruby and Rails specific content.

## PostToolUse Hooks

Configure project-local hooks to prefer binstubs and checked-in tooling:

- **RuboCop**: run `bundle exec rubocop -A <file>` or the project's safer formatter command after Ruby edits.
- **Brakeman**: run `bundle exec brakeman --no-progress` after security-sensitive Rails changes.
- **Tests**: run the narrowest matching `bin/rails test ...` or `bundle exec rspec ...` command for touched files.
- **Bundler audit**: run `bundle exec bundle-audit check --update` when `Gemfile` or `Gemfile.lock` changes and the project has bundler-audit installed.

## Warnings

- Warn on committed `debugger`, `binding.irb`, `binding.pry`, `puts`, `pp`, or `p` calls in application code.
- Warn when an edit disables CSRF protection, expands mass-assignment, or adds raw SQL without parameterization.
- Warn when a migration changes data destructively without a reversible path or documented rollout plan.

## CI Gate Suggestions

```bash
bundle exec rubocop
bundle exec brakeman --no-progress
bin/rails test
bundle exec rspec
```

Use only the commands that are present in the project; do not install new hook dependencies without maintainer approval.
