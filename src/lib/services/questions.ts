import 'server-only'
import { sql } from 'drizzle-orm'
import { z } from 'zod'
import { SaveError } from '@/lib/db/errors'
import { parseInput } from '@/lib/db/input'
import { executeStatements, insertRows, updateRows, deleteRows, type RecordValues } from '@/lib/db/statements'
import type { TeacherTransaction } from '@/lib/db/transaction'
import { gradeMultiSelect } from '@/lib/grade-utils'
import { gradeOX } from '@/lib/ox-grading'
import { gradeFindErrorRow } from '@/lib/find-error-grading'
import { gradeObjective } from '@/lib/objective-grading'
import { lockWeek, readingTotals } from './week-save'

const questionPatch = z.object({ id: z.string().uuid(), concept_tag_ids: z.array(z.string().uuid()).default([]),
  question_style: z.enum(['objective','subjective','ox','multi_select','find_error']).optional(),
  correct_answer: z.number().int().nullable().optional(), extra_correct_answers: z.array(z.number().int()).optional(),
  question_text: z.string().nullish(), explanation: z.string().nullish(), correct_answer_text_override: z.string().nullish(),
  grading_criteria: z.string().nullish(), is_void: z.boolean().optional(), all_correct: z.boolean().optional(),
})
export async function editQuestions(context: TeacherTransaction, weekId: string, input: unknown) {
  const updates = parseInput(z.array(questionPatch), input)
  await lockWeek(context, weekId)
  const { tx } = context
  const touched = new Set<string>()
  const regrade = new Map<string, { flags: boolean; key: boolean }>()
  // Apply all key edits before regrading, so find_error sibling matching sees
  // the final key set, not half of a batch.
  for (const patch of updates) {
    const old = (await tx.execute(sql`select * from public.exam_question where id=${patch.id}::uuid and week_id=${weekId}::uuid`)).rows[0]
    if (!old) throw new SaveError('문항 접근 권한이 없습니다.', 403)
    const style = patch.question_style ?? String(old.question_style)
    const values: RecordValues = {}
    for (const key of ['question_style','is_void','all_correct','explanation','grading_criteria'] as const) {
      if (patch[key] !== undefined) values[key] = patch[key]
    }
    if (patch.question_text !== undefined) Object.assign(values, {question_text:patch.question_text,question_stem:null,passage:null,choices:null})
    if (patch.correct_answer !== undefined && style === 'objective') Object.assign(values,{correct_answer:patch.correct_answer,extra_correct_answers:patch.extra_correct_answers ?? []})
    if (patch.correct_answer_text_override !== undefined && style !== 'objective') values.correct_answer_text=patch.correct_answer_text_override
    if (Object.keys(values).length) await executeStatements(tx,[updateRows('exam_question',values,sql`id=${patch.id}::uuid and week_id=${weekId}::uuid`,true)])
    const tagIds = [...new Set(patch.concept_tag_ids)]
    if (tagIds.length) {
      const tags = await tx.execute(sql`select id from public.concept_tag where id in (${sql.join(tagIds.map(id=>sql`${id}::uuid`),sql`, `)})`)
      if (tags.rows.length !== tagIds.length) throw new SaveError('태그 접근 권한이 없습니다.',403)
    }
    await executeStatements(tx,[deleteRows('exam_question_tag',sql`exam_question_id=${patch.id}::uuid`),
      ...insertRows('exam_question_tag',tagIds.map(id=>({exam_question_id:patch.id,concept_tag_id:id})))])
    regrade.set(patch.id, {flags:patch.is_void!==undefined || patch.all_correct!==undefined,
      key:patch.question_style!==undefined || patch.correct_answer!==undefined || patch.correct_answer_text_override!==undefined || patch.grading_criteria!==undefined})
  }
  for (const [id, changed] of regrade) {
    if (!changed.flags && !changed.key) continue
    const q = (await tx.execute(sql`select * from public.exam_question where id=${id}::uuid`)).rows[0]
    const answers = (await tx.execute(sql`select * from public.student_answer where exam_question_id=${id}::uuid`)).rows
    const keys = q.question_style === 'find_error' ? (await tx.execute(sql`select correct_answer_text from public.exam_question where week_id=${weekId}::uuid
      and question_number=${q.question_number} and question_style='find_error'`)).rows.map(row=>row.correct_answer_text as string|null) : []
    for (const answer of answers) {
      const values: RecordValues = {}
      if (q.is_void) values.is_correct=false // NOT NULL in DB; totals exclude void questions.
      else if (q.all_correct) values.is_correct=true
      else if (answer.teacher_confirmed && q.question_style !== 'objective') continue
      else if (q.question_style === 'objective') values.is_correct=gradeObjective({correct_answer:Number(q.correct_answer),extra_correct_answers:q.extra_correct_answers as number[],all_correct:false},answer.student_answer as number|null) ?? false
      else if (q.question_style === 'ox') values.is_correct=gradeOX(String(q.correct_answer_text??''),answer.ox_selection as string|null,String(answer.student_answer_text??''))
      else if (q.question_style === 'multi_select') values.is_correct=!!q.correct_answer_text && gradeMultiSelect(String(q.correct_answer_text),String(answer.student_answer_text??''))
      else if (String(answer.student_answer_text??'').trim()) {
        const verdict = q.question_style === 'find_error' ? gradeFindErrorRow(keys,String(answer.student_answer_text)) : 'ai'
        if (verdict === 'ai') Object.assign(values,{needs_review:true,ai_feedback:'모범답안/기준 변경 — 채점 페이지에서 다시 저장해주세요'})
        else Object.assign(values,{is_correct:verdict==='correct',needs_review:false,ai_feedback:null})
      }
      if (Object.keys(values).length) {
        await executeStatements(tx,[updateRows('student_answer',values,sql`id=${answer.id}::uuid`,true)])
        touched.add(String(answer.week_score_id))
      }
    }
  }
  await executeStatements(tx,readingTotals([...touched]))
  return {ok:true}
}
