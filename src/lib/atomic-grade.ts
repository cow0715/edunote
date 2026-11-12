export type GradeVersion = { score_id: string | null; revision: number | null }
export type SavedGradeVersion = GradeVersion & { student_id: string }
export type GradeSaveResult = { ok: true; versions: SavedGradeVersion[] }

export function isGradeVersion(value: unknown): value is GradeVersion {
  if (!value || typeof value !== 'object') return false
  const v = value as GradeVersion
  return (v.score_id === null && v.revision === null) ||
    (typeof v.score_id === 'string' && v.score_id.length > 0 && Number.isSafeInteger(v.revision) && v.revision! >= 0)
}

/** Only advance versions acknowledged by this editor; never adopt another editor's version on conflict. */
export function createGradeSaveQueue() {
  let tail: Promise<unknown> = Promise.resolve()
  const successors = new WeakMap<GradeVersion, GradeVersion>()
  function resolve(version: GradeVersion): GradeVersion {
    let latest = version
    while (successors.has(latest)) latest = successors.get(latest)!
    if (latest !== version) successors.set(version, latest)
    return latest
  }
  return {
    resolve,
    idle: () => tail,
    run<T extends { student_id: string; grade_version: GradeVersion }>(
      rows: T[], send: (rows: T[]) => Promise<GradeSaveResult>,
    ): Promise<GradeSaveResult> {
      const task = tail.then(async () => {
        const submitted = rows.map((row) => ({ ...row, grade_version: resolve(row.grade_version) }))
        const result = await send(submitted)
        if (!Array.isArray(result.versions) || submitted.some((row) =>
          !result.versions.some((v) => v.student_id === row.student_id && isGradeVersion(v)))) {
          throw new Error('저장 결과를 확인하지 못했습니다. 새로고침 후 확인해주세요.')
        }
        for (const row of submitted) {
          const version = result.versions.find((v) => v.student_id === row.student_id)!
          // New object identity avoids cycles when a no-op save returns the same revision.
          successors.set(row.grade_version, { score_id: version.score_id, revision: version.revision })
        }
        return result
      })
      tail = task.catch(() => undefined)
      return task
    },
  }
}
export type GradeSaveQueue = ReturnType<typeof createGradeSaveQueue>

export type PreparedReadingAnswer = {
  exam_question_id: string
  student_answer: number | null
  student_answer_text: string | null
  ox_selection: string | null
  is_correct: boolean | null
  needs_review: boolean
  teacher_confirmed: boolean
  ai_feedback?: string | null
}

export type PreparedReadingRow = {
  score_id: string
  expected_revision: number | null
  student_id: string
  present: boolean
  reading_present: boolean
  vocab_correct: number | null
  reading_correct: number | null
  homework_done: number | null
  memo: string
  exam_photo_path?: string | null
  answers: PreparedReadingAnswer[]
}

export function gradePersistenceStatus(code?: string): number {
  if (code === '40001') return 409
  if (code === '42501') return 403
  if (code === '22023' || code === '22P02') return 422
  return 503
}
