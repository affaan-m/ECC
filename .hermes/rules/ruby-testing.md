---
paths:
  - "**/*.rb"
  - "**/*.rake"
  - "**/Gemfile"
  - "**/test/**/*.rb"
  - "**/spec/**/*.rb"
  - "**/config/routes.rb"
---
# Ruby Testing

> This file extends [common/testing.md](../common/testing.md) with Ruby and Rails specific content.

## Framework

- Use **Minitest** when the Rails app follows the default Rails test stack.
- Use **RSpec** when it is already established in the project or the team has explicit production conventions around it.
- Do not mix Minitest and RSpec inside the same feature area without a migration reason.

## Test Pyramid

- Put fast domain behavior in model, service, query, policy, and job tests.
- Use request/controller tests for HTTP contracts, auth behavior, redirects, status codes, and response shapes.
- Use system tests with Capybara for browser-critical flows only; keep them focused and stable.
- Cover background jobs with unit tests for behavior and integration tests for queue/enqueue contracts.

## Fixtures And Factories

- Use Rails fixtures when they are the project default and the data graph is small.
- Use `factory_bot` when scenarios need explicit object construction or complex traits.
- Keep test data close to the behavior being asserted; avoid global fixtures that hide setup cost.

## Commands

Prefer project-local commands:

```bash
bin/rails test
bin/rails test test/models/user_test.rb
bundle exec rspec
bundle exec rspec spec/models/user_spec.rb
```

## Coverage

- Use SimpleCov when coverage is enforced; keep thresholds in CI and avoid gaming branch coverage with low-value tests.
- Add regression tests for bug fixes before changing production code.

## Reference

See skill: `tdd-workflow` for the repo-wide RED -> GREEN -> REFACTOR loop.
