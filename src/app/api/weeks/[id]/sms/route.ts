import { getAuth, err, ok } from '@/lib/api'
import { generateSmsMessages, SmsStudentInput } from '@/lib/anthropic'

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { supabase, user } = await getAuth()
  const { id: weekId } = await params
  if (!user) return err('인증 필요', 401)

  const body = await request.json().catch(() => ({}))
  const customPrompt: string | undefined = body?.customPrompt || undefined

  // 주차 + 수업 정보
  const { data: week } = await supabase
    .from('week')
    .select('*, class(name)')
    .eq('id', weekId)
    .single()

  if (!week) return err('주차 없음', 404)

  const classId = week.class_id
  const className = (week.class as { name: string } | null)?.name ?? '수업'

  // 이전 주차 (비교용)
  const { data: prevWeek } = await supabase
    .from('week')
    .select('id')
    .eq('class_id', classId)
    .eq('week_number', week.week_number - 1)
    .single()

  // 해당 주차 수업일 기준으로 재원 중이었던 학생만 조회
  let csQuery = supabase
    .from('class_student')
    .select('student_id, student(id, name, phone, father_phone, mother_phone, share_token)')
    .eq('class_id', classId)
    .order('joined_at')
  if (week.start_date) {
    csQuery = csQuery.lte('joined_at', week.start_date).or(`left_at.is.null,left_at.gt.${week.start_date}`)
  } else {
    csQuery = csQuery.is('left_at', null)
  }
  const { data: classStudents } = await csQuery

  if (!classStudents?.length) return ok({ messages: [] })

  const studentIds = classStudents.map((cs) => cs.student_id)

  // 현재 주차 채점 데이터
  const { data: weekScores } = await supabase
    .from('week_score')
    .select('*, student_answer(is_correct, ai_feedback, student_answer_text, exam_question(question_number, question_style, exam_question_tag(concept_tag(name, concept_category(name)))))')
    .eq('week_id', weekId)
    .in('student_id', studentIds)

  // 이전 주차 채점 데이터 (단어 비교용)
  const prevScoreMap = new Map<string, number>()
  if (prevWeek) {
    const { data: prevScores } = await supabase
      .from('week_score')
      .select('student_id, vocab_correct')
      .eq('week_id', prevWeek.id)
      .in('student_id', studentIds)
    prevScores?.forEach((s) => prevScoreMap.set(s.student_id, s.vocab_correct))
  }

  // 시험 문항 수 (reading)
  const { data: questions } = await supabase
    .from('exam_question')
    .select('id')
    .eq('week_id', weekId)
    .eq('exam_type', 'reading')

  const readingTotal = questions?.length ?? 0

  // 결석 학생 파악 (수업일 기준)
  const absentSet = new Set<string>()
  if (week.start_date) {
    const { data: attendances } = await supabase
      .from('attendance')
      .select('student_id, status')
      .in('student_id', studentIds)
      .eq('date', week.start_date)
    attendances?.filter((a) => a.status === 'absent').forEach((a) => absentSet.add(a.student_id))
  }

  // base URL (share 링크용) — NEXT_PUBLIC_APP_URL 환경변수 우선
  const host = process.env.NEXT_PUBLIC_APP_URL ?? new URL(request.url).origin

  // 학생별 input 구성
  const scoreMap = new Map(weekScores?.map((s) => [s.student_id, s]) ?? [])

  const studentInputs: SmsStudentInput[] = []

  type StudentRecord = {
    id: string; name: string; phone: string | null
    father_phone: string | null; mother_phone: string | null; share_token: string
  }

  for (const cs of classStudents) {
    const student = (cs.student as unknown) as StudentRecord | null
    if (!student) continue

    const score = scoreMap.get(cs.student_id)

    // 채점 없는 학생 — 결석이면 별도 SMS 생성
    if (!score) {
      if (absentSet.has(cs.student_id)) {
        studentInputs.push({
          student_name: student.name,
          is_absent: true,
          vocab: { correct: 0, total: week.vocab_total, prev_correct: null },
          reading: { correct: 0, total: readingTotal, wrong_objective: [], wrong_subjective: [] },
          homework: { done: 0, total: week.homework_total },
          teacher_memo: null,
          share_url: `${host}/share/${student.share_token}`,
        })
      }
      continue
    }

    type AnswerRecord = {
      is_correct: boolean
      ai_feedback: string | null
      student_answer_text: string | null
      exam_question: {
        question_number: number
        question_style: string
        exam_question_tag: { concept_tag: { name: string; concept_category: { name: string } | null } | null }[]
      } | null
    }

    const answers: AnswerRecord[] = score.student_answer ?? []
    const wrongAnswers = answers.filter((a) => !a.is_correct && a.exam_question)

    function getTagNames(eq: AnswerRecord['exam_question']): { category: string; tags: string | null } {
      const tags = eq?.exam_question_tag?.map((t) => t.concept_tag).filter(Boolean) ?? []
      return {
        category: tags[0]?.concept_category?.name ?? '문항',
        tags: tags.length > 0 ? tags.map((t) => t!.name).join('/') : null,
      }
    }

    const wrongObjective = wrongAnswers
      .filter((a) => a.exam_question?.question_style !== 'subjective')
      .map((a) => {
        const { category, tags } = getTagNames(a.exam_question)
        return {
          question_number: a.exam_question!.question_number,
          concept_category: category,
          concept_tag: tags,
        }
      })

    const wrongSubjective = wrongAnswers
      .filter((a) => a.exam_question?.question_style === 'subjective')
      .map((a) => {
        const { category } = getTagNames(a.exam_question)
        return {
          question_number: a.exam_question!.question_number,
          concept_category: category,
          ai_feedback: a.ai_feedback ?? '',
        }
      })

    const readingCorrect = answers.filter(
      (a) => a.is_correct && a.exam_question
    ).length

    studentInputs.push({
      student_name: student.name,
      vocab: {
        correct: score.vocab_correct,
        total: week.vocab_total,
        prev_correct: prevScoreMap.get(cs.student_id) ?? null,
      },
      reading: {
        correct: readingCorrect,
        total: readingTotal,
        wrong_objective: wrongObjective,
        wrong_subjective: wrongSubjective,
      },
      homework: { done: score.homework_done, total: week.homework_total },
      teacher_memo: score.memo ?? null,
      share_url: `${host}/share/${student.share_token}`,
    })
  }

  try {
    const generated = await generateSmsMessages(
      { week_number: week.week_number, class_name: className, start_date: week.start_date },
      studentInputs,
      customPrompt
    )

    // 학생 정보와 합치기
    const messages = generated.map((g) => {
      const cs = classStudents.find((c) => {
        const s = (c.student as unknown) as { name: string } | null
        return s?.name === g.student_name
      })
      const student = (cs?.student as unknown) as {
        id: string; name: string; phone: string | null
        father_phone: string | null; mother_phone: string | null
      } | null
      return {
        student_id: cs?.student_id ?? '',
        student_name: g.student_name,
        phone: student?.phone ?? null,
        father_phone: student?.father_phone ?? null,
        mother_phone: student?.mother_phone ?? null,
        message: g.message,
      }
    })

    return ok({ messages })
  } catch (e) {
    console.error('[POST /api/weeks/[id]/sms]', e)
    return err('SMS 생성 실패', 500)
  }
}
