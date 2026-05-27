import { stripe } from './client'
import { createAdminClient } from '@/lib/supabase/admin'

export interface ConnectAccountStatus {
  chargesEnabled: boolean
  payoutsEnabled: boolean
  detailsSubmitted: boolean
  requiresAction: boolean
}

/**
 * Generate a Stripe Connect onboarding or update URL for an organization.
 *
 * Creates or reuses the organization's connected account and returns
 * an Account Link so the org admin can complete onboarding.
 */
export async function createConnectAccountLink(
  orgId: string,
): Promise<{ url: string; accountId: string }> {
  const supabase = createAdminClient()

  // Check if the org already has a Stripe account
  const { data: org, error: orgError } = await supabase
    .from('organizations')
    .select('id, stripe_account_id, name, slug')
    .eq('id', orgId)
    .single()

  if (orgError || !org) {
    throw new Error(`Organization ${orgId} not found`)
  }

  const existingAccountId = org.stripe_account_id as string | null
  let accountId: string

  // Create a new connected account if one doesn't exist
  if (!existingAccountId) {
    const account = await stripe.accounts.create({
      type: 'standard',
      metadata: {
        organizationId: orgId,
        organizationSlug: org.slug as string,
      },
    })

    accountId = account.id

    // Store the account ID on the organization
    const { error: updateError } = await supabase
      .from('organizations')
      .update({ stripe_account_id: accountId })
      .eq('id', orgId)

    if (updateError) {
      throw new Error(`Failed to store Stripe account ID: ${updateError.message}`)
    }
  } else {
    accountId = existingAccountId
  }

  const baseUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000'

  const accountLink = await stripe.accountLinks.create({
    account: accountId,
    refresh_url: `${baseUrl}/dashboard/settings/payments?refresh=true`,
    return_url: `${baseUrl}/dashboard/settings/payments?setup=complete`,
    type: 'account_onboarding',
  })

  return { url: accountLink.url, accountId }
}

/**
 * Get the current status of a connected Stripe account.
 */
export async function getConnectAccountStatus(
  stripeAccountId: string,
): Promise<ConnectAccountStatus> {
  const account = await stripe.accounts.retrieve(stripeAccountId)

  return {
    chargesEnabled: account.charges_enabled ?? false,
    payoutsEnabled: account.payouts_enabled ?? false,
    detailsSubmitted: account.details_submitted ?? false,
    requiresAction:
      !account.charges_enabled || !account.details_submitted,
  }
}
