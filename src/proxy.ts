import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'

export async function proxy(request: NextRequest) {
  // This POST route verifies getUser itself and refreshes cookies in its Route
  // Handler, then checks approved-teacher ownership inside the write transaction.
  // Do not verify the same session twice or trust forwarded identity headers.
  if (request.method === 'POST' && /^\/api\/weeks\/[0-9a-f-]{36}\/grade\/?$/i.test(request.nextUrl.pathname)) {
    return NextResponse.next({ request })
  }

  if (process.env.NODE_ENV === 'development' && request.nextUrl.pathname === '/dev/exam-student-confirm') return NextResponse.next({request})
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
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value)
          )
          supabaseResponse = NextResponse.next({ request })
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options)
          )
        },
      },
    }
  )

  const {
    data: { user },
  } = await supabase.auth.getUser()

  const { pathname } = request.nextUrl

  // 공개 경로: /login, /signup, 학생/학부모 공유 링크
  const isPublic =
    pathname.startsWith('/login') ||
    pathname.startsWith('/signup') ||
    pathname.startsWith('/share') ||
    pathname.startsWith('/report-cards') ||
    pathname.startsWith('/mock-exam-reports') ||
    pathname.startsWith('/api/auth') ||
    pathname.startsWith('/api/share') ||
    pathname.startsWith('/api/cron') ||
    // 개발용 디자인 확인 페이지는 로컬 개발에서만 로그인 없이 연다.
    (process.env.NODE_ENV === 'development' && (
      pathname.startsWith('/dev/vocab-print-preview') || pathname.startsWith('/dev/share-design')
    ))

  if (!user && !isPublic) {
    const url = request.nextUrl.clone()
    url.pathname = '/login'
    return NextResponse.redirect(url)
  }

  if (user && (pathname === '/login' || pathname === '/signup')) {
    const url = request.nextUrl.clone()
    url.pathname = '/dashboard'
    return NextResponse.redirect(url)
  }

  return supabaseResponse
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
}
