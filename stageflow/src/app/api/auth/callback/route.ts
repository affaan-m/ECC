import { type NextRequest, NextResponse } from 'next/server'
import { createServerClient, type CookieOptions } from '@supabase/ssr'
import { cookies } from 'next/headers'

export async function GET(request: NextRequest) {
  const { searchParams, origin } = request.nextUrl
  const code = searchParams.get('code')
  const redirectTo = searchParams.get('redirect_to')

  if (!code) {
    return NextResponse.redirect(`${origin}/login?error=missing_code`)
  }

  const cookieStore = await cookies()
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll()
        },
        setAll(cookiesToSet: Array<{ name: string; value: string; options: CookieOptions }>) {
          cookiesToSet.forEach(({ name, value, options }) =>
            cookieStore.set(name, value, options),
          )
        },
      },
    },
  )

  const { error } = await supabase.auth.exchangeCodeForSession(code)

  if (error) {
    console.error('[Auth Callback] Code exchange failed:', error.message)
    return NextResponse.redirect(`${origin}/login?error=auth_failed`)
  }

  if (redirectTo) {
    return NextResponse.redirect(`${origin}${redirectTo}`)
  }

  // Determine the user's role to redirect to the appropriate dashboard
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) {
    return NextResponse.redirect(`${origin}/login`)
  }

  const { data: profile } = await supabase
    .from('profiles')
    .select('is_platform_admin')
    .eq('id', user.id)
    .single()

  if (profile?.is_platform_admin) {
    return NextResponse.redirect(`${origin}/admin`)
  }

  // Check for org membership
  const { data: orgMember } = await supabase
    .from('organization_members')
    .select('organization_id')
    .eq('user_id', user.id)
    .limit(1)
    .single()

  if (orgMember) {
    return NextResponse.redirect(`${origin}/o/${orgMember.organization_id}/dashboard`)
  }

  // Check for studio membership
  const { data: studioMember } = await supabase
    .from('studio_members')
    .select('studio_id, studios(organization_id)')
    .eq('user_id', user.id)
    .limit(1)
    .single()

  if (studioMember) {
    const orgId = (studioMember.studios as { organization_id: string })?.organization_id
    return NextResponse.redirect(`${origin}/s/${orgId}/${studioMember.studio_id}/dashboard`)
  }

  // Fallback: no known membership
  return NextResponse.redirect(`${origin}/`)
}
