import type Stripe from 'stripe'
import { stripe } from './client'

/**
 * Handler function type for a Stripe webhook event.
 */
type WebhookHandler = (event: Stripe.Event) => Promise<void>

/**
 * Registry of handlers keyed by Stripe event type.
 */
const handlers = new Map<string, WebhookHandler>()

/**
 * Register a handler for a specific Stripe event type.
 *
 * @example
 * ```ts
 * registerHandler('checkout.session.completed', async (event) => {
 *   const session = event.data.object as Stripe.Checkout.Session
 *   // Process the completed checkout...
 * })
 * ```
 */
export function registerHandler(eventType: string, handler: WebhookHandler): void {
  if (handlers.has(eventType)) {
    console.warn(`[Stripe Webhook] Overwriting handler for ${eventType}`)
  }
  handlers.set(eventType, handler)
}

/**
 * Verify a Stripe webhook signature and construct the event object.
 *
 * @param body - Raw request body (Buffer or string)
 * @param signature - Value of the `stripe-signature` header
 * @param secret - Webhook endpoint secret (defaults to STRIPE_WEBHOOK_SECRET env var)
 */
export function constructEvent(
  body: string | Buffer,
  signature: string,
  secret?: string,
): Stripe.Event {
  const webhookSecret = secret ?? process.env.STRIPE_WEBHOOK_SECRET

  if (!webhookSecret) {
    throw new Error('Missing STRIPE_WEBHOOK_SECRET environment variable')
  }

  return stripe.webhooks.constructEvent(body, signature, webhookSecret)
}

/**
 * Dispatch a verified Stripe event to the appropriate registered handler.
 *
 * Returns true if a handler was found and executed, false otherwise.
 */
export async function dispatchEvent(event: Stripe.Event): Promise<boolean> {
  const handler = handlers.get(event.type)

  if (!handler) {
    console.log(`[Stripe Webhook] No handler for event type: ${event.type}`)
    return false
  }

  try {
    await handler(event)
    return true
  } catch (error) {
    console.error(`[Stripe Webhook] Handler error for ${event.type}:`, error)
    throw error
  }
}

/**
 * Convenience: verify + dispatch in one call.
 */
export async function handleWebhook(
  body: string | Buffer,
  signature: string,
  secret?: string,
): Promise<{ received: boolean; eventType: string }> {
  const event = constructEvent(body, signature, secret)
  const received = await dispatchEvent(event)
  return { received, eventType: event.type }
}
