import 'server-only'
import { randomUUID } from 'node:crypto'
import { sql } from 'drizzle-orm'
import { z } from 'zod'
import { parseInput, dateInput } from '@/lib/db/input'
import { SaveError } from '@/lib/db/errors'
import { executeStatements, insertRows, updateRows, type RecordValues } from '@/lib/db/statements'
import { lockClass, type TeacherTransaction } from '@/lib/db/transaction'
import { buildDefaultMockExamQuestions, DEFAULT_ENGLISH_GRADE_CUTOFFS, calculateMockExamScore } from '@/lib/mock-exam'
import { mockInputs } from './mock-results'

export async function createMockExam(context: TeacherTransaction, input: unknown) {
  const values=parseInput(z.object({title:z.string().trim().min(1),class_id:z.string().uuid().nullable(),
    exam_year:z.number().int(),exam_month:z.number().int().min(1).max(12),grade:z.number().int().min(1).max(3).nullish(),
    source:z.string().optional(),exam_date:dateInput.nullish(),
  }),input)
  if(values.class_id) await lockClass(context,values.class_id)
  const id=randomUUID()
  await executeStatements(context.tx,[...insertRows('mock_exam',[{...values,id,teacher_id:context.teacherId,
    source:values.source?.trim()||'교육청',total_score:100,grade_cutoffs:DEFAULT_ENGLISH_GRADE_CUTOFFS,status:'draft'}]),
    ...insertRows('mock_exam_question',buildDefaultMockExamQuestions().map(question=>({mock_exam_id:id,...question})))])
  return (await context.tx.execute(sql`select * from public.mock_exam where id=${id}::uuid`)).rows[0]
}

export async function replaceMockQuestions(context: TeacherTransaction, examId: string, rows: RecordValues[], expectedVersion?:string) {
  const current=await mockInputs(context,examId)
  if(expectedVersion && current.version!==expectedVersion) {
    throw new SaveError('자료 처리 중 모의고사가 변경됐습니다. 새로고침해 주세요.',409)
  }
  await executeStatements(context.tx,insertRows('mock_exam_question',rows,['mock_exam_id','question_number']))
  const {exam,questions}=await mockInputs(context,examId)
  const results=(await context.tx.execute(sql`select * from public.mock_exam_result where mock_exam_id=${examId}::uuid order by id for update`)).rows
  for(const result of results) {
    const answers=(await context.tx.execute(sql`select q.question_number,a.student_answer from public.mock_exam_student_answer a
      join public.mock_exam_question q on q.id=a.mock_exam_question_id where a.mock_exam_result_id=${result.id}::uuid`)).rows
    const score=calculateMockExamScore(questions,answers.map(row=>({question_number:Number(row.question_number),student_answer:row.student_answer})),exam.grade_cutoffs as Record<string,number>|null)
    await executeStatements(context.tx,[updateRows('mock_exam_result',{raw_score:score.raw_score,grade:score.grade,
      listening_correct:score.listening_correct,listening_total:score.listening_total,reading_correct:score.reading_correct,
      reading_total:score.reading_total,type_analysis:score.type_analysis},sql`id=${result.id}::uuid`,true),
      ...insertRows('mock_exam_student_answer',score.answer_rows.map(answer=>({mock_exam_result_id:result.id,...answer})),['mock_exam_result_id','mock_exam_question_id'])])
  }
  const ready=questions.every(question=>question.is_void||question.all_correct||question.correct_answer)
  await executeStatements(context.tx,[updateRows('mock_exam',{status:ready?'ready':'draft'},sql`id=${examId}::uuid`,true)])
  return (await context.tx.execute(sql`select * from public.mock_exam_question where mock_exam_id=${examId}::uuid order by question_number`)).rows
}
