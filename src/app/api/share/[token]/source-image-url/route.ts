import { createHash } from 'node:crypto'
import { locateQuestionRegion } from '@/lib/pdf-question-region'
import { storeSourceRegions } from '@/lib/source-image-storage'
import type { SourceRegion } from '@/lib/source-region'
import { createServiceClient } from '@/lib/supabase/server'
import { SHARE_CLOSED_ERROR, SHARE_EXPIRED_ERROR, canViewShareByStudentId, resolveShareToken } from '@/lib/share-access'
import { NextResponse } from 'next/server'

export const maxDuration = 120

function one<T>(value: T | T[] | null | undefined): T | null {
  return Array.isArray(value) ? value[0] ?? null : value ?? null
}

type QuestionWithWeek = {
  id: string
  question_number: number
  source_question_number: number | null
  source_page: number | null
  source_bbox: SourceRegion | null
  source_image_path: string | null
  week: { class_id: string | null; answer_sheet_path: string | null } | { class_id: string | null; answer_sheet_path: string | null }[] | null
}

export async function GET(request: Request, { params }: { params: Promise<{ token: string }> }) {
  const supabase = createServiceClient()
  const { token } = await params
  const query = new URL(request.url).searchParams
  const path = query.get('path')
  const questionId = query.get('questionId')

  if (!path && !questionId) return NextResponse.json({ error: 'path 또는 questionId 없음' }, { status: 400 })
  if (questionId && !/^[0-9a-f-]{36}$/i.test(questionId)) return NextResponse.json({error:'문항 ID 오류'},{status:400})
  if (path && !path.startsWith('source-images/')) {
    return NextResponse.json({ error: '허용되지 않은 경로입니다.' }, { status: 403 })
  }

  const found = await resolveShareToken<{ id: string }>(supabase, token, 'id')
  if (found.status === 'expired') return NextResponse.json({ error: SHARE_EXPIRED_ERROR }, { status: 410 })
  if (found.status !== 'ok') return NextResponse.json({ error: '공유 링크를 찾을 수 없습니다.' }, { status: 404 })
  const student = found.student
  if (!await canViewShareByStudentId(supabase, student.id)) {
    return NextResponse.json({ error: SHARE_CLOSED_ERROR }, { status: 403 })
  }

  const { data: question } = await supabase
    .from('exam_question')
    .select('id, question_number, source_question_number, source_page, source_bbox, source_image_path, week(class_id,answer_sheet_path)')
    .eq(questionId ? 'id' : 'source_image_path', questionId ?? path!)
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

  // Existing processed questions are recropped lazily from the preserved PDF, without paid parsing.
  let imagePath = row.source_image_path ?? path
  const original = one(row.week)?.answer_sheet_path
  if (original && row.source_page) {
    try {
      const hash = createHash('sha256').update(JSON.stringify([original,row.source_page,row.source_bbox,row.source_question_number ?? row.question_number])).digest('hex').slice(0,16)
      const prefix = `source-images/share-region-v2/${row.id}-${hash}`
      const cachedPath = `${prefix}-0-p${row.source_page}.png`
      const cached = await supabase.storage.from('answer-sheets').download(cachedPath)
      if (!cached.error && cached.data) imagePath = cachedPath
      else {
        const {data:file,error:downloadError}=await supabase.storage.from('answer-sheets').download(original)
        if(downloadError || !file) throw Error('원본 PDF를 읽을 수 없습니다.')
        const pdf=Buffer.from(await file.arrayBuffer()).toString('base64')
        const region=await locateQuestionRegion(pdf,row.source_question_number ?? row.question_number,row.source_page,row.source_bbox)
        const images=await storeSourceRegions(supabase,pdf,prefix,[region])
        imagePath=images[0].path
      }
    } catch (error) { console.warn('[share-source-region] retaining saved original:', error instanceof Error ? error.message : 'crop failed') }
  }

  if (!imagePath) return NextResponse.json({error:'원본 이미지와 복구 가능한 PDF 영역이 없습니다.'},{status:422})

  const { data, error } = await supabase.storage
    .from('answer-sheets')
    .createSignedUrl(imagePath, 60 * 60)

  if (error || !data?.signedUrl) {
    return NextResponse.json({ error: error?.message ?? 'URL 생성 실패' }, { status: 500 })
  }

  return NextResponse.json({ url: data.signedUrl })
}
