import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'
import { canAccessRoute, normalizeRole } from '../lib/rbac'

export async function middleware(request: NextRequest) {
  let supabaseResponse = NextResponse.next({ request })

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll()
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value))
          supabaseResponse = NextResponse.next({ request })
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options)
          )
        },
      },
    }
  )

  const { data: { user } } = await supabase.auth.getUser()

  // ── Auth check: redirect to /auth if not logged in ──
  const protectedRoutes = ['/dashboard', '/actions', '/agent', '/marketplace', '/settings']
  const isProtected = protectedRoutes.some(
    (route) => request.nextUrl.pathname === route || request.nextUrl.pathname.startsWith(route + '/')
  )

  if (!user && isProtected) {
    const url = request.nextUrl.clone()
    url.pathname = '/auth'
    return NextResponse.redirect(url)
  }

  // ── RBAC check: redirect to /dashboard if role lacks permission ──
  if (user && isProtected) {
    // Fetch the user's role from the profiles table
    const { data: profile } = await supabase
      .from('profiles')
      .select('role')
      .eq('id', user.id)
      .single()

    const role = normalizeRole(profile?.role)
    const pathname = request.nextUrl.pathname

    if (!canAccessRoute(role, pathname)) {
      const url = request.nextUrl.clone()
      url.pathname = '/dashboard'
      // Add a query param so the dashboard can show an "access denied" message
      url.searchParams.set('error', 'insufficient_permissions')
      return NextResponse.redirect(url)
    }
  }

  return supabaseResponse
}

export const config = {
  matcher: [
    '/dashboard/:path*',
    '/actions/:path*',
    '/agent/:path*',
    '/marketplace/:path*',
    '/settings/:path*',
  ],
}