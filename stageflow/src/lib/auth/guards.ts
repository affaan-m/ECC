import { createClient } from '@/lib/supabase/server'
import { getUser, type UserProfile } from './session'

export class AuthorizationError extends Error {
  public readonly statusCode: number

  constructor(message: string, statusCode = 403) {
    super(message)
    this.name = 'AuthorizationError'
    this.statusCode = statusCode
  }
}

export interface OrgMembership {
  id: string
  userId: string
  organizationId: string
  role: string
  createdAt: string
}

export interface StudioMembership {
  id: string
  userId: string
  studioId: string
  role: string
  createdAt: string
}

/**
 * Require the current user to be a platform admin.
 * Throws AuthorizationError if not. Always queries the database — never trusts
 * client-supplied data.
 */
export async function requirePlatformAdmin(): Promise<UserProfile> {
  const profile = await getUser()

  if (!profile) {
    throw new AuthorizationError('Not authenticated', 401)
  }

  if (!profile.isPlatformAdmin) {
    throw new AuthorizationError('Platform admin access required')
  }

  return profile
}

/**
 * Require the current user to hold one of the specified roles within an organization.
 * Throws AuthorizationError if not a member or if role doesn't match.
 */
export async function requireOrgRole(
  orgId: string,
  roles: string[],
): Promise<OrgMembership> {
  const supabase = await createClient()

  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser()

  if (authError || !user) {
    throw new AuthorizationError('Not authenticated', 401)
  }

  const { data: membership, error: memberError } = await supabase
    .from('organization_members')
    .select('id, user_id, organization_id, role, created_at')
    .eq('organization_id', orgId)
    .eq('user_id', user.id)
    .single()

  if (memberError || !membership) {
    throw new AuthorizationError(
      `Not a member of organization ${orgId}`,
    )
  }

  const memberRole = membership.role as string

  if (!roles.includes(memberRole)) {
    throw new AuthorizationError(
      `Requires one of roles [${roles.join(', ')}] but has "${memberRole}"`,
    )
  }

  return {
    id: membership.id as string,
    userId: membership.user_id as string,
    organizationId: membership.organization_id as string,
    role: memberRole,
    createdAt: membership.created_at as string,
  }
}

/**
 * Require the current user to be a member of a studio (any role).
 * Throws AuthorizationError if not a member.
 */
export async function requireStudioMember(
  studioId: string,
): Promise<StudioMembership> {
  const supabase = await createClient()

  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser()

  if (authError || !user) {
    throw new AuthorizationError('Not authenticated', 401)
  }

  const { data: membership, error: memberError } = await supabase
    .from('studio_members')
    .select('id, user_id, studio_id, role, created_at')
    .eq('studio_id', studioId)
    .eq('user_id', user.id)
    .single()

  if (memberError || !membership) {
    throw new AuthorizationError(
      `Not a member of studio ${studioId}`,
    )
  }

  return {
    id: membership.id as string,
    userId: membership.user_id as string,
    studioId: membership.studio_id as string,
    role: membership.role as string,
    createdAt: membership.created_at as string,
  }
}
