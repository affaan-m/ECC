import { NextResponse } from 'next/server'
import { endImpersonation, getImpersonationStatus } from '@/lib/auth/impersonation'

export async function POST() {
  const status = await getImpersonationStatus()

  if (!status.isImpersonating) {
    return NextResponse.json(
      { error: 'No active impersonation session' },
      { status: 400 },
    )
  }

  try {
    await endImpersonation()

    return NextResponse.json({
      message: 'Impersonation session ended. Original session restored.',
      endedSessionId: status.sessionId,
      impersonatorId: status.impersonatorId,
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to end impersonation'
    console.error('[Impersonate End]', message)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
