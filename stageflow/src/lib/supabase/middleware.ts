import { createServerClient, type CookieOptions } from '@supabase/ssr'
import { type NextRequest, NextResponse } from 'next/server'
import type { Database } from './types'

/**
 * Create a Supabase client suitable for use inside Next.js middleware.
 *
 * Unlike the server-component helper, middleware receives the raw
 * NextRequest/NextResponse objects and must proxy cookie operations
 * through them.
 *
 * Returns both the client and the (possibly mutated) response so the
 * caller can forward set-cookie headers.
 */
export function createMiddlewareClient(request: NextRequest) {
  let response = NextResponse.next({ request })

  const supabase = createServerClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll()
        },
        setAll(
          cookiesToSet: Array<{ name: string; value: string; options: CookieOptions }>,
        ) {
          // Mirror cookies onto the request so downstream middleware sees them
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value),
          )

          // Create a fresh response that includes both the original and new cookies
          response = NextResponse.next({ request })
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options),
          )
        },
      },
    },
  )

  return { supabase, response }
}
