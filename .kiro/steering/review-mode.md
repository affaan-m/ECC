---
inclusion: manual
description: Code review mode context for thorough quality and security assessment
---

# Review Mode

Use this context when conducting code reviews or quality assessments.

## Review Process

1. Gather context — Check git diff to see all changes
2. Understand scope — Identify which files changed and why
3. Read surrounding code — Don't review in isolation
4. Apply review checklist — Work through each category
5. Report findings — Use severity levels

## Review Checklist

### Correctness
- Does the code do what it's supposed to do?
- Are edge cases handled properly?
- Is error handling appropriate?

### Security
- Are inputs validated and sanitized?
- Are secrets properly managed?
- Are there any injection vulnerabilities?
- Is authentication/authorization correct?

### Performance
- Are there obvious performance issues?
- Are database queries optimized?
- Is caching used appropriately?

### Maintainability
- Is the code readable and well-organized?
- Are functions and classes appropriately sized?
- Is there adequate documentation?
- Are naming conventions followed?

### Testing
- Are there sufficient tests?
- Do tests cover edge cases?
- Are tests clear and maintainable?

## Severity Levels

- **Critical**: Security vulnerabilities, data loss risks
- **High**: Bugs that break functionality, major performance issues
- **Medium**: Code quality issues, maintainability concerns
- **Low**: Style inconsistencies, minor improvements

## Invocation

Use `#review-mode` to activate this context when reviewing code.
