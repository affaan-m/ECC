import { headers } from 'next/headers'
import { createClient } from '@/lib/supabase/server'

export interface OrgContext {
  id: string
  name: string
  slug: string
  planId: string | null
  stripeAccountId: string | null
  logoUrl: string | null
  createdAt: string
}

export interface StudioContext {
  id: string
  name: string
  organizationId: string
  createdAt: string
}

/**
 * Header injected by middleware after resolving the tenant.
 */
const ORG_HEADER = 'x-stageflow-org-id'
const STUDIO_HEADER = 'x-stageflow-studio-id'

/**
 * Get the current organization from the request context.
 *
 * Reads the `x-stageflow-org-id` header set by middleware, then queries
 * the database for the full organization record.
 *
 * Returns null if not in an organization context (e.g. marketing pages).
 */
export async function getCurrentOrg(): Promise<OrgContext | null> {
  const headerStore = await headers()
  const orgId = headerStore.get(ORG_HEADER)

  if (!orgId) {
    return null
  }

  const supabase = await createClient()
  const { data: org, error } = await supabase
    .from('organizations')
    .select('id, name, slug, plan_id, stripe_account_id, logo_url, created_at')
    .eq('id', orgId)
    .single()

  if (error || !org) {
    console.error('[Tenancy] Organization not found for id:', orgId)
    return null
  }

  return {
    id: org.id as string,
    name: org.name as string,
    slug: org.slug as string,
    planId: org.plan_id as string | null,
    stripeAccountId: org.stripe_account_id as string | null,
    logoUrl: org.logo_url as string | null,
    createdAt: org.created_at as string,
  }
}

/**
 * Get the current studio from the request context.
 *
 * Reads the `x-stageflow-studio-id` header set by middleware.
 *
 * Returns null if not in a studio-scoped request.
 */
export async function getCurrentStudio(): Promise<StudioContext | null> {
  const headerStore = await headers()
  const studioId = headerStore.get(STUDIO_HEADER)

  if (!studioId) {
    return null
  }

  const supabase = await createClient()
  const { data: studio, error } = await supabase
    .from('studios')
    .select('id, name, organization_id, created_at')
    .eq('id', studioId)
    .single()

  if (error || !studio) {
    console.error('[Tenancy] Studio not found for id:', studioId)
    return null
  }

  return {
    id: studio.id as string,
    name: studio.name as string,
    organizationId: studio.organization_id as string,
    createdAt: studio.created_at as string,
  }
}
