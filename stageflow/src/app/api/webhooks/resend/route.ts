import { type NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'

const RESEND_WEBHOOK_SECRET = process.env.RESEND_WEBHOOK_SECRET

type ResendEventType = 'email.delivered' | 'email.opened' | 'email.bounced' | 'email.complained'

interface ResendWebhookPayload {
  type: ResendEventType
  data: {
    email_id: string
    created_at: string
    to: string[]
  }
}

const STATUS_MAP: Record<ResendEventType, string> = {
  'email.delivered': 'delivered',
  'email.opened': 'opened',
  'email.bounced': 'bounced',
  'email.complained': 'complained',
}

export async function POST(request: NextRequest) {
  const signature = request.headers.get('svix-signature')

  if (RESEND_WEBHOOK_SECRET && !signature) {
    return NextResponse.json({ error: 'Missing webhook signature' }, { status: 401 })
  }

  let payload: ResendWebhookPayload
  try {
    payload = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const { type, data } = payload

  if (!data?.email_id) {
    return NextResponse.json({ error: 'Missing email_id in payload' }, { status: 400 })
  }

  const newStatus = STATUS_MAP[type]
  if (!newStatus) {
    return NextResponse.json({ received: true, handled: false })
  }

  const supabase = createAdminClient()

  const { error } = await supabase
    .from('email_log')
    .update({
      status: newStatus,
      [`${newStatus}_at`]: data.created_at ?? new Date().toISOString(),
    })
    .eq('resend_message_id', data.email_id)

  if (error) {
    console.error('[Resend Webhook] Failed to update email_log:', error.message)
    return NextResponse.json({ error: 'Failed to update email log' }, { status: 500 })
  }

  return NextResponse.json({ received: true, handled: true, status: newStatus })
}
