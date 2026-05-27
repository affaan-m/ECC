import { createClient } from '@/lib/supabase/server'

export interface UserProfile {
  id: string
  email: string
  fullName: string | null
  avatarUrl: string | null
  isPlatformAdmin: boolean
  createdAt: string
  updatedAt: string
}

/**
 * Get the current Supabase auth session.
 * Returns null if the user is not authenticated.
 */
export async function getSession() {
  const supabase = await createClient()
  const {
    data: { session },
    error,
  } = await supabase.auth.getSession()

  if (error) {
    console.error('[Auth] Failed to get session:', error.message)
    return null
  }

  return session
}

/**
 * Get the current authenticated user along with their profile data.
 * Returns null if not authenticated or profile not found.
 */
export async function getUser(): Promise<UserProfile | null> {
  const supabase = await createClient()

  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser()

  if (authError || !user) {
    return null
  }

  const { data: profile, error: profileError } = await supabase
    .from('profiles')
    .select('id, email, full_name, avatar_url, is_platform_admin, created_at, updated_at')
    .eq('id', user.id)
    .single()

  if (profileError || !profile) {
    console.error('[Auth] Profile not found for user:', user.id)
    return null
  }

  return {
    id: profile.id as string,
    email: profile.email as string,
    fullName: profile.full_name as string | null,
    avatarUrl: profile.avatar_url as string | null,
    isPlatformAdmin: profile.is_platform_admin as boolean,
    createdAt: profile.created_at as string,
    updatedAt: profile.updated_at as string,
  }
}

/**
 * Get the current authenticated user's ID.
 * Throws an error if not authenticated — use in protected routes only.
 */
export async function getCurrentUserId(): Promise<string> {
  const supabase = await createClient()

  const {
    data: { user },
    error,
  } = await supabase.auth.getUser()

  if (error || !user) {
    throw new Error('Not authenticated')
  }

  return user.id
}
