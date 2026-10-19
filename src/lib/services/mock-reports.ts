import 'server-only'
import { sql } from 'drizzle-orm'
import { SaveError } from '@/lib/db/errors'
import { executeStatements, insertRows, updateRows } from '@/lib/db/statements'
import type { TeacherTransaction } from '@/lib/db/transaction'
import { mockInputs } from './mock-results'

export async function publishMockReports(context:TeacherTransaction,examId:string,resultIds:string[]) {
  await mockInputs(context,examId)
  const reports=[]
  for (const id of [...new Set(resultIds)].sort()) {
    const result=(await context.tx.execute(sql`select r.*,
      jsonb_build_object('id',s.id,'name',s.name,'school',s.school,'grade',s.grade) as student,
      jsonb_build_object('id',e.id,'title',e.title,'exam_year',e.exam_year,'exam_month',e.exam_month,'grade',e.grade,'source',e.source,'exam_date',e.exam_date) as exam
      from public.mock_exam_result r join public.student s on s.id=r.student_id join public.mock_exam e on e.id=r.mock_exam_id
      where r.id=${id}::uuid and r.mock_exam_id=${examId}::uuid for update of r`)).rows[0]
    if(!result) throw new SaveError('성적 결과를 찾을 수 없습니다.',404)
    const wrong=(await context.tx.execute(sql`select a.student_answer,a.is_correct,a.earned_points,
      jsonb_build_object('question_number',q.question_number,'correct_answer',q.correct_answer,'points',q.points,
        'section',q.section,'question_type',q.question_type,'difficulty',q.difficulty,'is_void',q.is_void,'all_correct',q.all_correct) as mock_exam_question
      from public.mock_exam_student_answer a join public.mock_exam_question q on q.id=a.mock_exam_question_id
      where a.mock_exam_result_id=${id}::uuid and not q.is_void and not a.is_correct order by q.question_number`)).rows
    const publishedAt=new Date().toISOString()
    const snapshot={version:1,generated_at:publishedAt,exam:result.exam,student:result.student,
      score:{raw_score:result.raw_score,grade:result.grade,listening_correct:result.listening_correct,
        listening_total:result.listening_total,reading_correct:result.reading_correct,reading_total:result.reading_total,type_analysis:result.type_analysis},
      cohort:null,wrong_answers:wrong,teacher_comment:result.teacher_comment}
    await executeStatements(context.tx,[...insertRows('mock_exam_report',[{mock_exam_result_id:id,snapshot_json:snapshot,
      status:'published',published_at:publishedAt,revoked_at:null}],['mock_exam_result_id']),
      updateRows('mock_exam_result',{status:'published',published_at:publishedAt},sql`id=${id}::uuid and mock_exam_id=${examId}::uuid`,true)])
    reports.push((await context.tx.execute(sql`select * from public.mock_exam_report where mock_exam_result_id=${id}::uuid`)).rows[0])
  }
  return reports
}
