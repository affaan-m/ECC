import { createClient } from '@supabase/supabase-js'
import type { Database } from './types'

/**
 * WARNING: This client uses the service-role key and BYPASSES Row Level Security.
 *
 * Only use this in trusted server-side contexts (webhooks, background jobs,
 * admin operations). NEVER expose this client or the service-role key to the browser.
 */
export function createAdminClient() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY

  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error(
      'Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY environment variables',
    )
  }

  return createClient<Database>(supabaseUrl, serviceRoleKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  })
}
