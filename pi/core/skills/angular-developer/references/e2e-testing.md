# End-to-End (E2E) Testing

Use E2E tests to cover critical user journeys in a real browser. Prefer the framework already configured in the Angular workspace, such as Cypress or Playwright.

## Running E2E Tests

Check `package.json` and `angular.json` for the project-specific command. Common patterns include:

```shell
npm run e2e
pnpm e2e
ng e2e
```

When the app must be built or served first, use the existing project scripts instead of inventing a parallel test entrypoint.

## Test Structure

- Keep E2E specs close to the configured test framework, such as `cypress/e2e/` or `e2e/`.
- Put reusable login/setup helpers in the framework support directory.
- Keep fixtures explicit and small enough that each test can explain the user state it depends on.

### Cypress Example

```typescript
describe('Login flow', () => {
  it('redirects to dashboard on valid credentials', () => {
    cy.visit('/login');
    cy.get('[data-cy=email]').type('user@example.com');
    cy.get('[data-cy=password]').type('password123');
    cy.get('[data-cy=submit]').click();
    cy.url().should('include', '/dashboard');
  });
});
```

### Playwright Example

```typescript
import {expect, test} from '@playwright/test';

test('redirects to dashboard on valid credentials', async ({page}) => {
  await page.goto('/login');
  await page.getByLabel('Email').fill('user@example.com');
  await page.getByLabel('Password').fill('password123');
  await page.getByRole('button', {name: 'Sign in'}).click();
  await expect(page).toHaveURL(/dashboard/);
});
```

## Best Practices

- Prefer accessible locators (`getByRole`, `getByLabel`) or stable `data-*` attributes.
- Avoid selectors that depend on CSS classes, DOM depth, or incidental text.
- Wait for specific UI states, routes, or network responses instead of arbitrary sleeps.
- Keep smoke tests short and reserve full workflow coverage for the highest-value paths.
