import { createClient } from '@/lib/supabase/server'
import { NextRequest, NextResponse } from 'next/server'

export async function POST(request: NextRequest) {
  try {
    const { email, password, name } = await request.json()

    const supabase = await createClient()

    const { data: authData, error: authError } = await supabase.auth.signUp({
      email,
      password,
    })

    if (authError) {
      return NextResponse.json({ error: authError.message }, { status: 400 })
    }

    if (!authData.user) {
      return NextResponse.json({ error: '회원가입 실패' }, { status: 400 })
    }

    const { error: teacherError } = await supabase.from('teacher').insert({
      auth_id: authData.user.id,
      email,
      name,
    })

    if (teacherError) {
      return NextResponse.json({ error: teacherError.message }, { status: 400 })
    }

    return NextResponse.json({ success: true })
  } catch (e) {
    console.error('signup error:', e)
    return NextResponse.json({ error: String(e) }, { status: 500 })
  }
}
