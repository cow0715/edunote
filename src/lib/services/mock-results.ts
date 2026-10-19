import 'server-only'
import { createHash } from 'node:crypto'
import { sql } from 'drizzle-orm'
import { z } from 'zod'
import { SaveError } from '@/lib/db/errors'
import { parseInput } from '@/lib/db/input'
import { executeStatements, insertRows } from '@/lib/db/statements'
import { lockClass, type TeacherTransaction } from '@/lib/db/transaction'
import { lockStudent } from './students'
import { calculateMockExamScore, type MockExamQuestionForGrading } from '@/lib/mock-exam'

const fingerprint = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex')
export async function mockInputs(context: TeacherTransaction, examId: string) {
  const exam = (await context.tx.execute(sql`select * from public.mock_exam where id=${examId}::uuid and teacher_id=${context.teacherId}::uuid`)).rows[0]
  if (!exam) throw new SaveError('모의고사 접근 권한이 없습니다.', 403)
  if (exam.class_id) await lockClass(context, String(exam.class_id))
  const locked = (await context.tx.execute(sql`select * from public.mock_exam where id=${examId}::uuid and teacher_id=${context.teacherId}::uuid for update`)).rows[0]
  if (!locked || locked.class_id !== exam.class_id) throw new SaveError('모의고사가 변경됐습니다.', 409)
  const questions = (await context.tx.execute(sql`select * from public.mock_exam_question where mock_exam_id=${examId}::uuid order by question_number for update`)).rows
  return { exam: locked, questions: questions as unknown as MockExamQuestionForGrading[], version: fingerprint([locked, questions]) }
}

export async function captureMockInputs(context: TeacherTransaction, examId: string) {
  const inputs = await mockInputs(context, examId)
  const results = (await context.tx.execute(sql`select * from public.mock_exam_result where mock_exam_id=${examId}::uuid order by id`)).rows
  return { version: inputs.version, results: Object.fromEntries(results.map(row => [String(row.student_id), fingerprint(row)])) }
}

export async function saveMockResult(context: TeacherTransaction, examId: string, input: unknown,
  expected?: { version: string; result: string | null }) {
  const body = parseInput(z.object({ student_id: z.string().uuid(),
    answers: z.array(z.object({ question_number: z.number().int().min(1).max(45), student_answer: z.union([z.string(),z.number()]).nullish() })).default([]),
    teacher_comment: z.string().nullish(), status: z.enum(['draft','published']).default('draft'),
  }), input)
  const { tx } = context
  const { exam, questions, version } = await mockInputs(context, examId)
  if (expected && expected.version !== version) throw new SaveError('OCR 처리 중 모의고사 문항이 변경됐습니다. 다시 처리해 주세요.', 409)
  await lockStudent(context, body.student_id)
  if (exam.class_id) {
    const date = exam.exam_date instanceof Date ? exam.exam_date.toISOString().slice(0,10)
      : exam.exam_date ? String(exam.exam_date).slice(0,10) : new Date().toISOString().slice(0,10)
    const allowed = await tx.execute(sql`select id from public.class_student where class_id=${exam.class_id}::uuid
      and student_id=${body.student_id}::uuid and joined_at<=${date}::timestamptz and (left_at is null or left_at>${date}::timestamptz) for update`)
    if (!allowed.rows.length) throw new SaveError('해당 수업 학생이 아닙니다.', 403)
  }
  const previous = (await tx.execute(sql`select * from public.mock_exam_result where mock_exam_id=${examId}::uuid and student_id=${body.student_id}::uuid for update`)).rows[0]
  if (expected && (previous ? fingerprint(previous) : null) !== expected.result) throw new SaveError('OCR 처리 중 학생 성적이 변경됐습니다. 새로고침해 주세요.', 409)
  if (!questions.length) throw new SaveError('등록된 문항이 없습니다.')
  const score = calculateMockExamScore(questions, body.answers, exam.grade_cutoffs as Record<string,number> | null)
  await executeStatements(tx, insertRows('mock_exam_result', [{ mock_exam_id: examId, student_id: body.student_id,
    raw_score: score.raw_score, grade: score.grade, listening_correct: score.listening_correct,
    listening_total: score.listening_total, reading_correct: score.reading_correct, reading_total: score.reading_total,
    type_analysis: score.type_analysis, teacher_comment: body.teacher_comment ?? null, status: body.status,
  }], ['mock_exam_id','student_id']))
  const result = (await tx.execute(sql`select * from public.mock_exam_result where mock_exam_id=${examId}::uuid and student_id=${body.student_id}::uuid`)).rows[0]
  if (!result) throw new SaveError('성적 저장 실패', 409)
  await executeStatements(tx, insertRows('mock_exam_student_answer', score.answer_rows.map(answer => ({
    mock_exam_result_id: result.id, ...answer,
  })), ['mock_exam_result_id','mock_exam_question_id']))
  return result
}
