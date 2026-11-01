import type { GradeRow } from '@/hooks/use-grade'

const fields = ['present', 'vocab_correct', 'reading_present', 'reading_correct', 'homework_done', 'memo', 'answers'] as const
const equal = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b)
function editableValue(row: GradeRow, key: typeof fields[number]) {
  if (key !== 'answers') return row[key]
  // Verdicts/feedback are server outputs. Compare the student's input and explicit teacher decisions.
  return row.answers.map((answer) => ({
    exam_question_id: answer.exam_question_id,
    student_answer: answer.student_answer ?? null,
    student_answer_text: answer.student_answer_text ?? '',
    ox_selection: answer.ox_selection ?? null,
    teacher_confirmed: !!answer.teacher_confirmed,
    confirmed_correct: answer.teacher_confirmed ? !!answer.is_correct : null,
  })).sort((a, b) => a.exam_question_id.localeCompare(b.exam_question_id))
}

/** Three-way merge: preserve edits and never attach a fresh version to conflicting stale content. */
export function mergeGradeDrafts(local: GradeRow[], incoming: GradeRow[], baseline: GradeRow[]): GradeRow[] {
  return incoming.map((server) => {
    const current = local.find((row) => row.student_id === server.student_id)
    const base = baseline.find((row) => row.student_id === server.student_id)
    if (!current || !base) return server
    if (typeof current.grade_version.revision === 'number' && typeof server.grade_version.revision === 'number' && current.grade_version.score_id === server.grade_version.score_id &&
      (current.grade_version.revision ?? -1) > (server.grade_version.revision ?? -1)) return current
    const dirty = fields.filter((key) => !equal(editableValue(current, key), editableValue(base, key)))
    const pendingPhoto = !!current.exam_photo_path && current.exam_photo_path !== server.stored_exam_photo_path
    if (!dirty.length && !current.grade_conflict && !pendingPhoto) return server
    const photoConflict = pendingPhoto && (current.grade_version.score_id !== server.grade_version.score_id || current.grade_version.revision !== server.grade_version.revision)
    const conflict = current.grade_conflict || photoConflict || dirty.some((key) =>
      !equal(editableValue(server, key), editableValue(base, key)) && !equal(editableValue(server, key), editableValue(current, key)))
    const pending = dirty.filter((key) => !equal(editableValue(server, key), editableValue(current, key)))
    return { ...server, ...Object.fromEntries(pending.map((key) => [key, current[key]])),
      exam_photo_path: pendingPhoto ? current.exam_photo_path : undefined,
      grade_conflict: !!conflict,
      grade_version: conflict ? current.grade_version : server.grade_version }
  })
}
