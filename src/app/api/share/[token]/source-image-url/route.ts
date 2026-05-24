import { createServiceClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'

function one<T>(value: T | T[] | null | undefined): T | null {
  return Array.isArray(value) ? value[0] ?? null : value ?? null
}

type QuestionWithWeek = {
  id: string
  source_image_path: string | null
  week: { class_id: string | null } | { class_id: string | null }[] | null
}

export async function GET(request: Request, { params }: { params: Promise<{ token: string }> }) {
  const supabase = createServiceClient()
  const { token } = await params
  const path = new URL(request.url).searchParams.get('path')

  if (!path) return NextResponse.json({ error: 'path 없음' }, { status: 400 })
  if (!path.startsWith('source-images/')) {
    return NextResponse.json({ error: '허용되지 않은 경로입니다.' }, { status: 403 })
  }

  const { data: student } = await supabase
    .from('student')
    .select('id')
    .eq('share_token', token)
    .single()

  if (!student) return NextResponse.json({ error: '공유 링크를 찾을 수 없습니다.' }, { status: 404 })

  const { data: question } = await supabase
    .from('exam_question')
    .select('id, source_image_path, week(class_id)')
    .eq('source_image_path', path)
    .maybeSingle()

  const row = question as QuestionWithWeek | null
  const classId = one(row?.week)?.class_id
  if (!row || !classId) {
    return NextResponse.json({ error: '이미지를 찾을 수 없습니다.' }, { status: 404 })
  }

  const { data: enrollment } = await supabase
    .from('class_student')
    .select('class_id')
    .eq('student_id', student.id)
    .eq('class_id', classId)
    .maybeSingle()

  if (!enrollment) return NextResponse.json({ error: '접근 권한이 없습니다.' }, { status: 403 })

  const { data, error } = await supabase.storage
    .from('answer-sheets')
    .createSignedUrl(path, 60 * 60)

  if (error || !data?.signedUrl) {
    return NextResponse.json({ error: error?.message ?? 'URL 생성 실패' }, { status: 500 })
  }

  return NextResponse.json({ url: data.signedUrl })
}
