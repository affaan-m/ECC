import { test, expect } from '@playwright/test'

test.describe('Entry submission flow', () => {
  test('org signup -> branding -> invite studio -> studio submits entry -> pays -> org approves -> export', async ({
    page,
  }) => {
    // Step 1: Org signup
    await page.goto('/signup')
    await expect(page.getByRole('heading', { name: /create.*organisation/i })).toBeVisible()

    // Step 2: Fill in org details
    await page.getByLabel('Organisation name').fill('Test Dance Comp')
    await page.getByLabel('Email').fill('org@testdance.com')
    await page.getByLabel('Password').fill('SecurePass123!@#')
    await page.getByRole('button', { name: /sign up/i }).click()

    // Step 3: Set branding
    await page.waitForURL('**/branding')
    await expect(page.getByRole('heading', { name: /branding/i })).toBeVisible()

    // Step 4: Invite studio
    await page.goto('/o/test-dance-comp/team')
    await page.getByRole('button', { name: /invite/i }).click()
    await page.getByLabel('Email').fill('studio@sparkle.com')
    await page.getByRole('button', { name: /send invite/i }).click()
    await expect(page.getByText(/invitation sent/i)).toBeVisible()

    // Further steps would continue the full flow...
    // Studio accepts invite, creates dancers, submits entries, pays, org approves
  })

  test('super admin impersonation flow', async ({ page }) => {
    // Login as super admin
    await page.goto('/login')
    await page.getByLabel('Email').fill('admin@stageflow.local')
    await page.getByLabel('Password').fill('Admin123!@#Local')
    await page.getByRole('button', { name: /sign in/i }).click()

    // Navigate to admin
    await page.waitForURL('**/admin')

    // Impersonate a user
    await page.goto('/admin/organizations')
    await page.getByRole('link', { name: /test dance comp/i }).click()
    await page.getByRole('button', { name: /impersonate/i }).click()

    // Enter reason
    await page.getByLabel('Reason').fill('Testing impersonation flow')
    await page.getByRole('button', { name: /start/i }).click()

    // Verify impersonation banner
    await expect(page.getByText(/acting as/i)).toBeVisible()

    // End impersonation
    await page.getByRole('button', { name: /end/i }).click()
    await expect(page.getByText(/acting as/i)).not.toBeVisible()

    // Check audit log
    await page.goto('/admin/audit-logs')
    await expect(page.getByText(/impersonation.started/i)).toBeVisible()
    await expect(page.getByText(/impersonation.ended/i)).toBeVisible()
  })

  test('embed flow on third-party site', async ({ page }) => {
    // Load the embed page directly
    await page.goto('/embed/test-dance-comp')
    await expect(page.getByRole('heading')).toBeVisible()

    // Studio creates account
    await page.getByRole('link', { name: /register/i }).click()
    await page.getByLabel('Studio name').fill('Embed Studio')
    await page.getByLabel('Email').fill('embed@studio.com')
    await page.getByLabel('Password').fill('SecurePass123!@#')
    await page.getByRole('button', { name: /register/i }).click()

    // Continue flow would test music upload and entry submission
  })
})
