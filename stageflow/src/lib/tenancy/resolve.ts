import { createAdminClient } from '@/lib/supabase/admin'

export interface ResolvedOrganization {
  organizationId: string
  slug: string
  isCustomDomain: boolean
}

/**
 * The primary domain for the platform (no subdomain = marketing site).
 * Reads from env so it can vary between preview/staging/production.
 */
const APEX_DOMAIN = process.env.NEXT_PUBLIC_ROOT_DOMAIN ?? 'stageflow.app'

/**
 * Resolve a hostname to an organization.
 *
 * Resolution order:
 * 1. Apex domain (e.g. stageflow.app) → null (marketing site)
 * 2. Subdomain (e.g. acme.stageflow.app) → look up organizations.slug = "acme"
 * 3. Custom domain (e.g. events.acme.com) → look up custom_domains.domain
 *
 * Returns null when the host maps to the marketing site or no org is found.
 */
export async function resolveOrganization(
  host: string,
): Promise<ResolvedOrganization | null> {
  // Strip port for local development
  const hostname = host.split(':')[0]!

  // 1. Apex domain → marketing site
  if (hostname === APEX_DOMAIN || hostname === `www.${APEX_DOMAIN}`) {
    return null
  }

  // 2. Subdomain check
  if (hostname.endsWith(`.${APEX_DOMAIN}`)) {
    const slug = hostname.replace(`.${APEX_DOMAIN}`, '')

    // Reject nested subdomains
    if (slug.includes('.')) {
      return null
    }

    const supabase = createAdminClient()
    const { data: org, error } = await supabase
      .from('organizations')
      .select('id, slug')
      .eq('slug', slug)
      .single()

    if (error || !org) {
      return null
    }

    return {
      organizationId: org.id as string,
      slug: org.slug as string,
      isCustomDomain: false,
    }
  }

  // 3. Custom domain lookup
  const supabase = createAdminClient()
  const { data: customDomain, error } = await supabase
    .from('custom_domains')
    .select('organization_id, domain, organizations(id, slug)')
    .eq('domain', hostname)
    .eq('verified', true)
    .single()

  if (error || !customDomain) {
    return null
  }

  const org = customDomain.organizations as { id: string; slug: string } | null

  if (!org) {
    return null
  }

  return {
    organizationId: org.id,
    slug: org.slug,
    isCustomDomain: true,
  }
}
