import { assertWeekOwner, getAuth, getTeacherId, err, ok } from '@/lib/api'
import { createServiceClient } from '@/lib/supabase/server'
import {
  createTagMatcher,
  fetchTeacherTagContext,
  parseAnswerSheetDocument,
  saveWeekAnswerSheetFile,
  syncWeekReadingQuestionsAndRegrade,
} from '@/lib/week-reading-import'

export const maxDuration = 300

type ParseMode = 'auto' | 'answer_sheet' | 'problem_sheet'

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { supabase, user } = await getAuth()
    const { id: weekId } = await params
    if (!user) return err('인증이 필요합니다.', 401)

    const teacherId = await getTeacherId(supabase, user.id)
    if (!teacherId) return err('강사 정보를 찾지 못했습니다.', 404)
    if (!await assertWeekOwner(supabase, weekId, teacherId)) return err('접근 권한이 없습니다.', 403)

    const { tagList, tagCategories } = await fetchTeacherTagContext(supabase, teacherId)
    const matchTagId = createTagMatcher(tagList)

    const body = await request.json()
    const { mimeType, fileName } = body

    // 채점된 주차를 다시 파싱하면, 새 파싱에서 사라진 문항의 학생 답안이 삭제된다.
    // 학생이 쓴 답은 PDF 에 없어서 다시 만들 수 없으므로(강사 입력·OCR 산물) 먼저 막는다.
    // 파싱은 최대 300초·유료 호출이라 파싱 "전에" 검사한다 — 확인받고 다시 부르게 하려면
    // 비싼 작업을 두 번 하지 않는 게 중요하다.
    if (body.discardAnswers !== true) {
      const serviceClient = createServiceClient()
      const { data: weekQuestions } = await serviceClient
        .from('exam_question')
        .select('id')
        .eq('week_id', weekId)
        .eq('exam_type', 'reading')
      const questionIds = (weekQuestions ?? []).map((question) => question.id)

      if (questionIds.length > 0) {
        const { count } = await serviceClient
          .from('student_answer')
          .select('id', { count: 'exact', head: true })
          .in('exam_question_id', questionIds)

        if ((count ?? 0) > 0) {
          return ok({
            error: '이미 채점한 시험입니다. 다시 파싱하면 새 파싱에서 빠진 문항의 학생 답안이 삭제됩니다.',
            code: 'ANSWERS_EXIST',
            answer_count: count ?? 0,
            question_count: questionIds.length,
          }, { status: 409 })
        }
      }
    }
    let fileData = body.fileData as string | undefined
    const requestedMode = (body.parseMode === 'answer_sheet' || body.parseMode === 'problem_sheet' || body.parseMode === 'auto'
      ? body.parseMode
      : 'auto') as ParseMode

    // 큰 파일은 body(4.5MB 제한) 대신 임시 스토리지 경유 — 감지 단계에서 올린 파일 재사용
    const storagePath = typeof body.storagePath === 'string' ? body.storagePath : null
    if (!fileData && storagePath) {
      const serviceClient = createServiceClient()
      const { data, error } = await serviceClient.storage.from('exam-pdf-temp').download(storagePath)
      if (error || !data) return err(`파일 다운로드 실패: ${error?.message ?? storagePath}`)
      fileData = Buffer.from(await data.arrayBuffer()).toString('base64')
      void serviceClient.storage.from('exam-pdf-temp').remove([storagePath]).catch(() => {})
    }

    // 업로드는 통합 PDF 1개로 고정 — 문항/해설(또는 정오표)이 따로면 사용자가 합쳐서 올린다
    if (!fileData || !mimeType) return err('파일이 없습니다.')
    if (requestedMode === 'problem_sheet') {
      return err('문제지형 PDF는 시험지 가져오기를 사용해 주세요.', 422)
    }

    let parsedAnswers
    let skippedPages: number[] = []
    let skippedQuestions: number[] = []
    try {
      const parsed = await parseAnswerSheetDocument([{ fileData, mimeType, fileName }], tagCategories)
      parsedAnswers = parsed.answers
      skippedPages = parsed.skipped.map((entry) => entry.startPage)
      skippedQuestions = parsed.skippedQuestionNumbers ?? []
    } catch (error) {
      const message = error instanceof Error ? error.message : '해설지 파싱에 실패했습니다.'
      return err(message || '해설 포함 PDF로 파싱하지 못했습니다.', 422)
    }

    if (!parsedAnswers.length) {
      return err('문항을 찾을 수 없습니다.', 422)
    }

    await saveWeekAnswerSheetFile(supabase, weekId, fileData, mimeType, fileName)
    const result = await syncWeekReadingQuestionsAndRegrade({
      supabase,
      weekId,
      parsedAnswers,
      matchTagId,
    })

    // 해설 안전망(빈 해설 채우기)은 여기서 돌리지 않는다 — 파싱 209초 + 해설 생성이 한 함수에
    // 합산되면 300초를 넘을 수 있어, 클라이언트가 explanations-drain 을 이어서 호출한다.
    return ok({
      ok: true,
      ...result,
      parse_mode_used: 'answer_sheet',
      skipped_pages: skippedPages,
      // 범위 분할 경로에서 콘텐츠 필터로 그룹째 결손된 문항 번호 (평시 빈 배열)
      skipped_questions: skippedQuestions,
    })
  } catch (error) {
    console.error('[parse-answers] unhandled error:', error)
    const message = error instanceof Error ? error.message : '서버 처리 중 오류가 발생했습니다.'
    return err(message, 500)
  }
}
