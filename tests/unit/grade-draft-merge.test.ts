import { expect, it } from 'vitest'
import { mergeGradeDrafts } from '@/lib/grade-draft-merge'
import type { GradeRow } from '@/hooks/use-grade'

const base: GradeRow = { student_id: 's', student_name: '가상 학생', grade_version: { score_id: 'score', revision: 1 },
  present: true, reading_present: true, vocab_correct: 1, reading_correct: 1, homework_done: 1.5, memo: 'base',
  answers: [{ exam_question_id: 'q', student_answer: 1 }] }
it('keeps local reading edits and merges an independently committed vocab score', () => {
  const local = { ...base, answers: [{ exam_question_id: 'q', student_answer: 2 }] }
  const server = { ...base, vocab_correct: 2, grade_version: { score_id: 'score', revision: 2 } }
  expect(mergeGradeDrafts([local], [server], [base])[0]).toMatchObject({ answers: local.answers, vocab_correct: 2, grade_version: server.grade_version })
})
it('keeps conflicting edits on the old version across repeated refreshes', () => {
  const local = { ...base, memo: 'local' }, server = { ...base, memo: 'remote', grade_version: { score_id: 'score', revision: 2 } }
  const merged = mergeGradeDrafts([local], [server], [base])
  expect(merged[0]).toMatchObject({ memo: 'local', grade_conflict: true, grade_version: base.grade_version })
  expect(mergeGradeDrafts(merged, [server], [server])[0]).toMatchObject({ memo: 'local', grade_conflict: true, grade_version: base.grade_version })
})
it('ignores a stale refresh after an acknowledged save', () => {
  const local = { ...base, memo: 'acknowledged', grade_version: { score_id: 'score', revision: 3 } }
  expect(mergeGradeDrafts([local], [base], [base])[0]).toEqual(local)
})
it('accepts acknowledged identical edits without inventing a conflict', () => {
  const local = { ...base, memo: 'saved' }, server = { ...local, grade_version: { score_id: 'score', revision: 2 } }
  expect(mergeGradeDrafts([local], [server], [base])[0]).toMatchObject({ memo: 'saved', grade_conflict: false, grade_version: server.grade_version })
})
it('takes the new server verdict for an acknowledged answer without inventing an edit conflict', () => {
  const local = { ...base, answers: [{ ...base.answers[0], student_answer: 3 }] }
  const server = { ...local, grade_version: { score_id: 'score', revision: 2 },
    answers: [{ ...local.answers[0], is_correct: true, needs_review: false, teacher_confirmed: false, ai_feedback: 'graded' }] }
  const merged = mergeGradeDrafts([local], [server], [base])[0]
  expect(merged.grade_conflict).toBe(false)
  expect(merged.answers).toEqual(server.answers)
  expect(merged.grade_version).toEqual(server.grade_version)
})
it('still rejects genuinely conflicting student inputs and explicit teacher verdicts', () => {
  const local = { ...base, answers: [{ ...base.answers[0], student_answer: 2 }] }
  const server = { ...base, grade_version: { score_id: 'score', revision: 2 }, answers: [{ ...base.answers[0], student_answer: 3, is_correct: true }] }
  expect(mergeGradeDrafts([local], [server], [base])[0]).toMatchObject({ grade_conflict: true, answers: local.answers, grade_version: base.grade_version })
  const teacherLocal = { ...base, answers: [{ ...base.answers[0], teacher_confirmed: true, is_correct: true }] }
  const teacherServer = { ...server, answers: [{ ...base.answers[0], teacher_confirmed: true, is_correct: false }] }
  expect(mergeGradeDrafts([teacherLocal], [teacherServer], [base])[0].grade_conflict).toBe(true)
})

it('preserves a newly captured photo when OCR answers equal the previous answers',()=>{
 const local={...base,exam_photo_path:'week/s/new-photo'}
 const server={...base,stored_exam_photo_path:'week/s/old-photo',grade_version:{...base.grade_version,student_id:'s'}}
 const merged=mergeGradeDrafts([local],[server],[base])[0]
 expect(merged.exam_photo_path).toBe('week/s/new-photo')
 expect(merged.grade_conflict).toBe(false)
 const acknowledged={...server,stored_exam_photo_path:'week/s/new-photo'}
 expect(mergeGradeDrafts([merged],[acknowledged],[server])[0].exam_photo_path).toBeUndefined()
})

it('does not attach another writer’s new version to a pending photo receipt',()=>{
 const local={...base,exam_photo_path:'week/s/ours'}
 const server={...base,stored_exam_photo_path:'week/s/theirs',grade_version:{score_id:'score',revision:2}}
 const merged=mergeGradeDrafts([local],[server],[base])[0]
 expect(merged).toMatchObject({exam_photo_path:'week/s/ours',grade_conflict:true,grade_version:base.grade_version})
})
