import type Stripe from 'stripe'
import { stripe } from './client'

export interface CreateCheckoutParams {
  /** Connected Stripe account ID for the organization */
  stripeAccountId: string
  /** Organization ID for metadata */
  organizationId: string
  /** Entry ID being paid for */
  entryId: string
  /** Line items for the checkout */
  lineItems: Array<{
    name: string
    description?: string
    /** Amount in cents */
    amountCents: number
    quantity: number
  }>
  /** Customer's email for Stripe to pre-fill */
  customerEmail?: string
  /** Platform fee in cents */
  applicationFeeCents?: number
  /** URL to redirect on success */
  successUrl: string
  /** URL to redirect on cancel */
  cancelUrl: string
}

export interface CreatePlatformCheckoutParams {
  /** Organization ID subscribing */
  organizationId: string
  /** Stripe price ID for the plan */
  priceId: string
  /** Customer's email */
  customerEmail: string
  /** Existing Stripe customer ID (if any) */
  customerId?: string
  /** URL to redirect on success */
  successUrl: string
  /** URL to redirect on cancel */
  cancelUrl: string
}

/**
 * Create a Stripe Checkout session for entry payments.
 *
 * Funds go to the connected account with an application fee for the platform.
 */
export async function createCheckoutSession(
  params: CreateCheckoutParams,
): Promise<Stripe.Checkout.Session> {
  const {
    stripeAccountId,
    organizationId,
    entryId,
    lineItems,
    customerEmail,
    applicationFeeCents,
    successUrl,
    cancelUrl,
  } = params

  const session = await stripe.checkout.sessions.create(
    {
      mode: 'payment',
      customer_email: customerEmail,
      line_items: lineItems.map((item) => ({
        price_data: {
          currency: 'usd',
          product_data: {
            name: item.name,
            description: item.description,
          },
          unit_amount: item.amountCents,
        },
        quantity: item.quantity,
      })),
      payment_intent_data: applicationFeeCents
        ? { application_fee_amount: applicationFeeCents }
        : undefined,
      metadata: {
        organizationId,
        entryId,
        type: 'entry_payment',
      },
      success_url: successUrl,
      cancel_url: cancelUrl,
    },
    {
      stripeAccount: stripeAccountId,
    },
  )

  return session
}

/**
 * Create a Stripe Checkout session for organization subscription payments.
 *
 * These go to the platform account (not a connected account).
 */
export async function createPlatformCheckoutSession(
  params: CreatePlatformCheckoutParams,
): Promise<Stripe.Checkout.Session> {
  const {
    organizationId,
    priceId,
    customerEmail,
    customerId,
    successUrl,
    cancelUrl,
  } = params

  const session = await stripe.checkout.sessions.create({
    mode: 'subscription',
    customer: customerId,
    customer_email: customerId ? undefined : customerEmail,
    line_items: [{ price: priceId, quantity: 1 }],
    metadata: {
      organizationId,
      type: 'platform_subscription',
    },
    subscription_data: {
      metadata: { organizationId },
    },
    success_url: successUrl,
    cancel_url: cancelUrl,
  })

  return session
}
