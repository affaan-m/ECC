import { type NextRequest, NextResponse } from 'next/server'
import { startImpersonation } from '@/lib/auth/impersonation'
import { AuthorizationError } from '@/lib/auth/guards'

export async function POST(request: NextRequest) {
  let body: { targetUserId: string; reason: string }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const { targetUserId, reason } = body

  if (!targetUserId || typeof targetUserId !== 'string') {
    return NextResponse.json({ error: 'Missing or invalid targetUserId' }, { status: 400 })
  }

  if (!reason || typeof reason !== 'string' || reason.trim().length < 5) {
    return NextResponse.json(
      { error: 'A reason is required (minimum 5 characters)' },
      { status: 400 },
    )
  }

  try {
    const { sessionId } = await startImpersonation(targetUserId, reason.trim())

    return NextResponse.json({
      sessionId,
      targetUserId,
      message: 'Impersonation session started. All actions will be audit-logged.',
    })
  } catch (err) {
    if (err instanceof AuthorizationError) {
      return NextResponse.json({ error: err.message }, { status: err.statusCode })
    }

    const message = err instanceof Error ? err.message : 'Failed to start impersonation'
    console.error('[Impersonate Start]', message)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
