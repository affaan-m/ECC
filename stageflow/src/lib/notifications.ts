import { createAdminClient } from '@/lib/supabase/admin'

export type NotificationPriority = 'low' | 'normal' | 'high' | 'urgent'

export interface NotifyParams {
  /** IDs of users to notify */
  userIds: string[]
  /** Notification type, e.g. "entry.approved", "event.reminder" */
  type: string
  /** Short notification title shown in UI */
  title: string
  /** Optional longer description */
  body?: string
  /** Relative path the notification links to (e.g. "/events/abc/entries") */
  linkPath?: string
  /** Delivery priority; "urgent" bypasses preference suppression */
  priority?: NotificationPriority
  /** Organization scope */
  organizationId?: string
}

/**
 * Send notifications to one or more users.
 *
 * 1. Checks each user's notification preferences
 * 2. Creates in-app notification rows
 * 3. Queues email.send jobs for users who have email notifications enabled
 *    (unless priority is "low" or the user has opted out of that type)
 *
 * Uses the admin client to bypass RLS — this runs in trusted server context.
 */
export async function notify(params: NotifyParams): Promise<void> {
  const {
    userIds,
    type,
    title,
    body,
    linkPath,
    priority = 'normal',
    organizationId,
  } = params

  if (userIds.length === 0) {
    return
  }

  const supabase = createAdminClient()

  // Fetch notification preferences for all target users
  interface NotificationPref {
    user_id: string
    email_enabled: boolean
    suppressed_types: string[] | null
  }

  const { data: preferences } = await supabase
    .from('notification_preferences')
    .select('user_id, email_enabled, suppressed_types')
    .in('user_id', userIds)

  const prefsByUser = new Map(
    ((preferences ?? []) as unknown as NotificationPref[]).map((p) => [
      p.user_id,
      p,
    ]),
  )

  // Build notification rows
  const notificationRows = userIds.map((userId) => ({
    user_id: userId,
    type,
    title,
    body: body ?? null,
    link_path: linkPath ?? null,
    priority,
    organization_id: organizationId ?? null,
    read: false,
  }))

  // Batch insert in-app notifications
  const { error: insertError } = await supabase
    .from('notifications')
    .insert(notificationRows)

  if (insertError) {
    console.error('[Notifications] Failed to insert notifications:', insertError.message)
    return
  }

  // Determine which users should receive email notifications
  const emailRecipients = userIds.filter((userId) => {
    // "urgent" always sends email
    if (priority === 'urgent') return true

    // "low" never sends email
    if (priority === 'low') return false

    const prefs = prefsByUser.get(userId)
    if (!prefs) {
      // No preferences row = default to email enabled
      return true
    }

    if (!prefs.email_enabled) {
      return false
    }

    // Check if this type is suppressed
    const suppressedTypes = prefs.suppressed_types ?? []
    return !suppressedTypes.includes(type)
  })

  // Queue email jobs for eligible users
  if (emailRecipients.length > 0) {
    const emailJobs = emailRecipients.map((userId) => ({
      name: 'email.send',
      data: {
        userId,
        template: 'notification',
        templateData: { type, title, body, linkPath },
        organizationId,
      },
    }))

    const { error: jobError } = await supabase
      .from('job_queue')
      .insert(emailJobs)

    if (jobError) {
      console.error('[Notifications] Failed to queue email jobs:', jobError.message)
    }
  }
}
