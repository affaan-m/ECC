import Stripe from 'stripe'

/**
 * Server-side Stripe client initialized with the platform's secret key.
 *
 * Use this for platform-level operations (subscriptions, customer management).
 * For connected-account operations, pass { stripeAccount } in the request options.
 */
export const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
  apiVersion: '2024-12-18.acacia',
  typescript: true,
  appInfo: {
    name: 'StageFlow',
    version: '0.1.0',
    url: 'https://stageflow.app',
  },
})
