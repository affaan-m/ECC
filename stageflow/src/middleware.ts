import { type NextRequest, NextResponse } from 'next/server'

/**
 * StageFlow multi-tenant middleware.
 *
 * Resolution order:
 *  1. Host header → apex domain → marketing
 *  2. Host header → subdomain → resolve org from organizations.slug
 *  3. Host header → custom_domains table lookup
 *  4. Path-based → /o/{slug} or /s/{slug}/{studio}
 *  5. Embed routes → /embed/{org} with restrictive CSP
 *  6. Falls through to marketing for unknown hosts
 */

const APEX_DOMAINS = new Set([
  'stageflow.app',
  'stageflow.com',
  'localhost:3000',
  'localhost',
])

const PUBLIC_PATHS = new Set([
  '/',
  '/pricing',
  '/login',
  '/signup',
  '/verify-email',
  '/forgot-password',
  '/api/health',
  '/api/auth/callback',
  '/api/webhooks/stripe',
  '/api/webhooks/resend',
])

function isPublicPath(pathname: string): boolean {
  if (PUBLIC_PATHS.has(pathname)) return true
  if (pathname.startsWith('/embed/')) return true
  if (pathname.startsWith('/api/webhooks/')) return true
  if (pathname.startsWith('/_next/')) return true
  if (pathname.startsWith('/favicon')) return true
  return false
}

function extractSubdomain(host: string): string | null {
  const cleanHost = host.replace(/:\d+$/, '')
  const parts = cleanHost.split('.')

  // localhost or IP — no subdomain
  if (parts.length <= 1 || cleanHost === 'localhost') return null

  // e.g., org.stageflow.app → 3 parts, subdomain = parts[0]
  if (parts.length >= 3) {
    const subdomain = parts[0]
    if (subdomain === 'www') return null
    return subdomain
  }

  return null
}

function resolveOrgFromPath(pathname: string): string | null {
  // /o/{slug}/... → org admin
  const orgMatch = pathname.match(/^\/o\/([^/]+)/)
  if (orgMatch) return orgMatch[1]

  // /s/{slug}/{studio}/... → studio portal
  const studioMatch = pathname.match(/^\/s\/([^/]+)/)
  if (studioMatch) return studioMatch[1]

  // /embed/{org}/... → embedded widget
  const embedMatch = pathname.match(/^\/embed\/([^/]+)/)
  if (embedMatch) return embedMatch[1]

  return null
}

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl
  const host = request.headers.get('host') ?? 'localhost'
  const response = NextResponse.next()

  // ── Step 1: Apex domain → marketing (no org resolution needed) ──
  const cleanHost = host.replace(/:\d+$/, '')
  if (APEX_DOMAINS.has(host) || APEX_DOMAINS.has(cleanHost)) {
    // Path-based org resolution still applies on apex domain
    const pathOrg = resolveOrgFromPath(pathname)
    if (pathOrg) {
      response.headers.set('x-stageflow-org-id', pathOrg)
      response.headers.set('x-stageflow-resolution', 'path')
    }

    // Embed CSP headers
    if (pathname.startsWith('/embed/')) {
      return applyEmbedCSP(response, pathname)
    }

    return response
  }

  // ── Step 2: Subdomain resolution ──
  const subdomain = extractSubdomain(host)
  if (subdomain) {
    // In production this would query Supabase:
    //   const { data } = await supabase
    //     .from('organizations')
    //     .select('id')
    //     .eq('slug', subdomain)
    //     .single()
    response.headers.set('x-stageflow-org-id', subdomain)
    response.headers.set('x-stageflow-resolution', 'subdomain')
    return response
  }

  // ── Step 3: Custom domain resolution ──
  // In production this would query Supabase:
  //   const { data } = await supabase
  //     .from('custom_domains')
  //     .select('organization_id')
  //     .eq('domain', cleanHost)
  //     .eq('verified', true)
  //     .single()
  // For now, set a header indicating custom domain lookup is needed
  if (!APEX_DOMAINS.has(cleanHost)) {
    response.headers.set('x-stageflow-custom-domain', cleanHost)
    response.headers.set('x-stageflow-resolution', 'custom-domain-pending')
  }

  // ── Step 4: Path-based fallback ──
  const pathOrg = resolveOrgFromPath(pathname)
  if (pathOrg) {
    response.headers.set('x-stageflow-org-id', pathOrg)
    response.headers.set('x-stageflow-resolution', 'path')
  }

  // ── Step 5: Embed CSP ──
  if (pathname.startsWith('/embed/')) {
    return applyEmbedCSP(response, pathname)
  }

  return response
}

function applyEmbedCSP(response: NextResponse, _pathname: string): NextResponse {
  // Restrictive CSP for embedded widgets — allow framing from any origin
  response.headers.set(
    'Content-Security-Policy',
    [
      "default-src 'self'",
      "script-src 'self' 'unsafe-inline' https://js.stripe.com",
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data: https:",
      "font-src 'self' https://fonts.gstatic.com",
      "connect-src 'self' https://*.supabase.co https://api.stripe.com",
      'frame-ancestors *',
    ].join('; ')
  )
  // Remove X-Frame-Options to allow embedding
  response.headers.delete('X-Frame-Options')
  return response
}

export const config = {
  matcher: [
    /*
     * Match all paths except static files and Next.js internals.
     */
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)',
  ],
}
