import { type NextRequest, NextResponse } from 'next/server'
import { constructEvent, dispatchEvent } from '@/lib/stripe/webhooks'
import { createAdminClient } from '@/lib/supabase/admin'

const HANDLED_EVENTS = new Set([
  'checkout.session.completed',
  'payment_intent.succeeded',
  'invoice.paid',
  'customer.subscription.updated',
  'account.updated',
])

export async function POST(request: NextRequest) {
  const body = await request.text()
  const signature = request.headers.get('stripe-signature')

  if (!signature) {
    return NextResponse.json({ error: 'Missing stripe-signature header' }, { status: 400 })
  }

  let event
  try {
    event = constructEvent(body, signature)
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Signature verification failed'
    console.error('[Stripe Webhook] Verification failed:', message)
    return NextResponse.json({ error: message }, { status: 400 })
  }

  // Idempotency check: skip already-processed events
  const supabase = createAdminClient()
  const { data: existing } = await supabase
    .from('processed_webhook_events')
    .select('id')
    .eq('event_id', event.id)
    .single()

  if (existing) {
    return NextResponse.json({ received: true, duplicate: true })
  }

  if (!HANDLED_EVENTS.has(event.type)) {
    return NextResponse.json({ received: true, handled: false })
  }

  try {
    await dispatchEvent(event)

    // Record this event as processed
    await supabase
      .from('processed_webhook_events')
      .insert({ event_id: event.id, event_type: event.type, processed_at: new Date().toISOString() })

    return NextResponse.json({ received: true, handled: true })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Handler error'
    console.error('[Stripe Webhook] Handler error:', message)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
