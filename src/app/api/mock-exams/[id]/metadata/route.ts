import { err, getAuth, getTeacherId, ok } from '@/lib/api'
import {
  parseMockExamAnswerKeyFiles,
  parseMockExamMetadataFile,
  parseMockExamMetadataFiles,
  parseMockExamMetadataText,
  type MockExamMetadataQuestion,
} from '@/lib/anthropic'
import {
  buildDefaultMockExamQuestions,
  getDefaultMockExamPoints,
  getDefaultMockExamQuestionType,
  getDefaultMockExamSection,
  type MockExamDifficulty,
  type MockExamSection,
} from '@/lib/mock-exam'
import { assertMockExamOwner } from '@/lib/mock-exam-server'

type MetadataImportBody = {
  raw_text?: string
  fileData?: string
  mimeType?: string
  fileName?: string
  files?: { fileData: string; mimeType: string; fileName?: string }[]
}

const VALID_SECTIONS = new Set(['listening', 'reading'])
const VALID_DIFFICULTIES = new Set(['low', 'medium', 'high'])

export const maxDuration = 300

function normalizeAnswer(value: unknown) {
  if (value == null) return ''
  const circled: Record<string, string> = {
    '①': '1',
    '②': '2',
    '③': '3',
    '④': '4',
    '⑤': '5',
  }
  return String(value).trim().replace(/[①②③④⑤]/g, (match) => circled[match] ?? match)
}

function normalizeImportedQuestion(question: MockExamMetadataQuestion) {
  const questionNumber = Number(question.question_number)
  if (!Number.isInteger(questionNumber) || questionNumber < 1 || questionNumber > 45) return null

  const points = Number(question.points ?? getDefaultMockExamPoints(questionNumber))
  const section = question.section && VALID_SECTIONS.has(question.section)
    ? question.section as MockExamSection
    : getDefaultMockExamSection(questionNumber)
  const difficulty = question.difficulty && VALID_DIFFICULTIES.has(question.difficulty)
    ? question.difficulty as MockExamDifficulty
    : 'medium'

  return {
    question_number: questionNumber,
    correct_answer: normalizeAnswer(question.correct_answer),
    points: Number.isInteger(points) && points > 0 ? points : getDefaultMockExamPoints(questionNumber),
    section,
    question_type: question.question_type?.trim() || getDefaultMockExamQuestionType(questionNumber),
    difficulty,
    is_void: !!question.is_void,
    all_correct: !!question.all_correct,
    extra_correct_answers: (question.extra_correct_answers ?? []).map(normalizeAnswer).filter(Boolean),
  }
}

function hasReliableAnswer(value: unknown) {
  return /^[1-5]$/.test(normalizeAnswer(value))
}

function mergeAnswerKeyMetadata(
  baseQuestions: MockExamMetadataQuestion[],
  answerKeyQuestions: MockExamMetadataQuestion[],
) {
  if (answerKeyQuestions.length === 0) return baseQuestions

  const merged = new Map<number, MockExamMetadataQuestion>()
  for (const question of baseQuestions) {
    const questionNumber = Number(question.question_number)
    if (Number.isInteger(questionNumber)) merged.set(questionNumber, question)
  }

  for (const answerKey of answerKeyQuestions) {
    const questionNumber = Number(answerKey.question_number)
    if (!Number.isInteger(questionNumber) || questionNumber < 1 || questionNumber > 45) continue

    const current = merged.get(questionNumber) ?? { question_number: questionNumber }
    const next: MockExamMetadataQuestion = { ...current }
    if (hasReliableAnswer(answerKey.correct_answer)) next.correct_answer = normalizeAnswer(answerKey.correct_answer)
    const points = Number(answerKey.points)
    if (points === 2 || points === 3) next.points = points
    if (answerKey.is_void != null) next.is_void = !!answerKey.is_void
    if (answerKey.all_correct != null) next.all_correct = !!answerKey.all_correct
    if (answerKey.extra_correct_answers?.length) next.extra_correct_answers = answerKey.extra_correct_answers
    merged.set(questionNumber, next)
  }

  return [...merged.values()].sort((a, b) => Number(a.question_number) - Number(b.question_number))
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { supabase, user } = await getAuth()
  if (!user) return err('인증 필요', 401)

  const teacherId = await getTeacherId(supabase, user.id)
  if (!teacherId) return err('강사 정보를 찾을 수 없습니다', 404)

  const { id } = await params
  if (!(await assertMockExamOwner(supabase, id, teacherId))) return err('접근 권한이 없습니다', 403)

  const body = await request.json().catch(() => ({})) as MetadataImportBody
  const files = Array.isArray(body.files)
    ? body.files.filter((file) => !!file?.fileData && !!file?.mimeType)
    : []
  const hasFile = !!body.fileData && !!body.mimeType
  const hasFiles = files.length > 0
  const hasText = !!body.raw_text?.trim()
  if (!hasFile && !hasFiles && !hasText) return err('메타데이터 파일 또는 텍스트가 필요합니다')

  let parsed: MockExamMetadataQuestion[]
  try {
    parsed = hasFiles
      ? await parseMockExamMetadataFiles(files)
      : hasFile
      ? await parseMockExamMetadataFile(body.fileData!, body.mimeType!)
      : await parseMockExamMetadataText(body.raw_text!.trim())
    if (hasFiles || hasFile) {
      const answerKeyFiles = hasFiles ? files : [{ fileData: body.fileData!, mimeType: body.mimeType!, fileName: body.fileName }]
      const answerKeyParsed = await parseMockExamAnswerKeyFiles(answerKeyFiles).catch((error) => {
        console.warn('[mock-exam metadata] answer key focused extraction skipped:', error)
        return []
      })
      parsed = mergeAnswerKeyMetadata(parsed, answerKeyParsed)
    }
  } catch (error) {
    return err(error instanceof Error ? error.message : '메타데이터 분석 실패', 500)
  }

  const imported = parsed
    .map(normalizeImportedQuestion)
    .filter((question): question is NonNullable<ReturnType<typeof normalizeImportedQuestion>> => !!question)

  if (imported.length === 0) return err('읽어낸 문항 메타데이터가 없습니다')

  const { data: existing } = await supabase
    .from('mock_exam_question')
    .select('*')
    .eq('mock_exam_id', id)
    .order('question_number')

  const existingMap = new Map((existing ?? []).map((question) => [question.question_number, question]))
  const importedMap = new Map(imported.map((question) => [question.question_number, question]))

  const rows = buildDefaultMockExamQuestions().map((defaults) => {
    const current = existingMap.get(defaults.question_number)
    const next = importedMap.get(defaults.question_number)
    return {
      mock_exam_id: id,
      question_number: defaults.question_number,
      correct_answer: next?.correct_answer ?? current?.correct_answer ?? defaults.correct_answer,
      points: next?.points ?? current?.points ?? defaults.points,
      section: next?.section ?? current?.section ?? defaults.section,
      question_type: next?.question_type ?? current?.question_type ?? defaults.question_type,
      difficulty: next?.difficulty ?? current?.difficulty ?? defaults.difficulty,
      is_void: next?.is_void ?? current?.is_void ?? defaults.is_void,
      all_correct: next?.all_correct ?? current?.all_correct ?? defaults.all_correct,
      extra_correct_answers: next?.extra_correct_answers ?? current?.extra_correct_answers ?? defaults.extra_correct_answers,
    }
  })

  const { data, error } = await supabase
    .from('mock_exam_question')
    .upsert(rows, { onConflict: 'mock_exam_id,question_number' })
    .select()
    .order('question_number')

  if (error) return err(error.message, 500)

  const ready = rows.every((question) => question.is_void || question.all_correct || question.correct_answer)
  await supabase
    .from('mock_exam')
    .update({ status: ready ? 'ready' : 'draft' })
    .eq('id', id)

  return ok({
    questions: data,
    imported_count: imported.length,
    ready,
    source: hasFiles ? files.map((file) => file.fileName ?? 'file').join(', ') : hasFile ? body.fileName ?? 'file' : 'text',
  })
}
