import { headers } from 'next/headers'
import { createClient } from '@/lib/supabase/server'

export interface AuditParams {
  /** Action identifier, e.g. "event.created", "entry.approved" */
  action: string
  /** Type of entity being acted on (e.g. "event", "entry", "user") */
  targetType?: string
  /** ID of the entity being acted on */
  targetId?: string
  /** Arbitrary metadata to attach to the log entry */
  metadata?: Record<string, unknown>
  /** Organization scope for the action */
  organizationId?: string
}

/**
 * Write an entry to the audit_logs table.
 *
 * Automatically captures:
 * - The actor (current authenticated user, or "system" if unauthenticated)
 * - The client IP address from request headers
 * - The user-agent string
 *
 * Fails silently with a console.error — audit logging should never
 * break the calling operation.
 */
export async function audit(params: AuditParams): Promise<void> {
  try {
    const supabase = await createClient()

    // Get current user (may be null for system actions)
    const {
      data: { user },
    } = await supabase.auth.getUser()

    // Extract IP and user-agent from request headers
    const headerStore = await headers()
    const ipAddress =
      headerStore.get('x-forwarded-for')?.split(',')[0]?.trim() ??
      headerStore.get('x-real-ip') ??
      'unknown'
    const userAgent = headerStore.get('user-agent') ?? 'unknown'

    const { error } = await supabase.from('audit_logs').insert({
      actor_id: user?.id ?? null,
      action: params.action,
      target_type: params.targetType ?? null,
      target_id: params.targetId ?? null,
      metadata: params.metadata ?? null,
      organization_id: params.organizationId ?? null,
      ip_address: ipAddress,
      user_agent: userAgent,
    })

    if (error) {
      console.error('[Audit] Failed to write audit log:', error.message, params)
    }
  } catch (error) {
    console.error('[Audit] Unexpected error:', error, params)
  }
}
