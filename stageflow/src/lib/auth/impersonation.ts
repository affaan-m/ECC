import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { getCurrentUserId } from './session'
import { requirePlatformAdmin } from './guards'
import { audit } from '@/lib/audit'

export interface ImpersonationStatus {
  isImpersonating: boolean
  impersonatorId: string | null
  impersonatorEmail: string | null
  sessionId: string | null
  startedAt: string | null
  reason: string | null
}

/**
 * Start an impersonation session. Only platform admins may impersonate.
 *
 * Creates an impersonation_sessions row and generates a new JWT
 * scoped to the target user so the admin can act on their behalf.
 */
export async function startImpersonation(
  targetUserId: string,
  reason: string,
): Promise<{ sessionId: string }> {
  const admin = await requirePlatformAdmin()
  const supabaseAdmin = createAdminClient()

  // Prevent self-impersonation
  if (admin.id === targetUserId) {
    throw new Error('Cannot impersonate yourself')
  }

  // Verify target user exists
  const { data: targetUser, error: targetError } = await supabaseAdmin
    .from('profiles')
    .select('id, email')
    .eq('id', targetUserId)
    .single()

  if (targetError || !targetUser) {
    throw new Error(`Target user ${targetUserId} not found`)
  }

  // Create impersonation session record
  const { data: session, error: sessionError } = await supabaseAdmin
    .from('impersonation_sessions')
    .insert({
      impersonator_id: admin.id,
      target_user_id: targetUserId,
      reason,
      started_at: new Date().toISOString(),
    })
    .select('id')
    .single()

  if (sessionError || !session) {
    throw new Error(`Failed to create impersonation session: ${sessionError?.message}`)
  }

  const sessionId = session.id as string

  // Audit the impersonation start
  await audit({
    action: 'impersonation.started',
    targetType: 'user',
    targetId: targetUserId,
    metadata: {
      impersonatorId: admin.id,
      impersonatorEmail: admin.email,
      targetEmail: targetUser.email,
      reason,
      sessionId,
    },
  })

  return { sessionId }
}

/**
 * End the current impersonation session.
 */
export async function endImpersonation(): Promise<void> {
  const supabase = await createClient()
  const supabaseAdmin = createAdminClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    throw new Error('Not authenticated')
  }

  // Find the active impersonation session for this target user
  const { data: activeSession, error: findError } = await supabaseAdmin
    .from('impersonation_sessions')
    .select('id, impersonator_id, target_user_id')
    .eq('target_user_id', user.id)
    .is('ended_at', null)
    .order('started_at', { ascending: false })
    .limit(1)
    .single()

  if (findError || !activeSession) {
    throw new Error('No active impersonation session found')
  }

  // End the session
  const { error: updateError } = await supabaseAdmin
    .from('impersonation_sessions')
    .update({ ended_at: new Date().toISOString() })
    .eq('id', activeSession.id as string)

  if (updateError) {
    throw new Error(`Failed to end impersonation session: ${updateError.message}`)
  }

  // Audit the impersonation end
  await audit({
    action: 'impersonation.ended',
    targetType: 'user',
    targetId: activeSession.target_user_id as string,
    metadata: {
      impersonatorId: activeSession.impersonator_id,
      sessionId: activeSession.id,
    },
  })
}

/**
 * Check whether the current user is being impersonated and by whom.
 */
export async function getImpersonationStatus(): Promise<ImpersonationStatus> {
  const supabaseAdmin = createAdminClient()

  let userId: string
  try {
    userId = await getCurrentUserId()
  } catch {
    return {
      isImpersonating: false,
      impersonatorId: null,
      impersonatorEmail: null,
      sessionId: null,
      startedAt: null,
      reason: null,
    }
  }

  const { data: activeSession } = await supabaseAdmin
    .from('impersonation_sessions')
    .select('id, impersonator_id, started_at, reason')
    .eq('target_user_id', userId)
    .is('ended_at', null)
    .order('started_at', { ascending: false })
    .limit(1)
    .single()

  if (!activeSession) {
    return {
      isImpersonating: false,
      impersonatorId: null,
      impersonatorEmail: null,
      sessionId: null,
      startedAt: null,
      reason: null,
    }
  }

  // Look up the impersonator's email
  const { data: impersonator } = await supabaseAdmin
    .from('profiles')
    .select('email')
    .eq('id', activeSession.impersonator_id as string)
    .single()

  return {
    isImpersonating: true,
    impersonatorId: activeSession.impersonator_id as string,
    impersonatorEmail: (impersonator?.email as string) ?? null,
    sessionId: activeSession.id as string,
    startedAt: activeSession.started_at as string,
    reason: activeSession.reason as string | null,
  }
}
