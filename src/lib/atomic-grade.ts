// Production uses its existing snapshot hash, not a new DB revision column.
// Numeric revisions remain supported by isolated development fixtures only.
export type GradeVersion = { score_id: string | null; revision: string | number | null }
export type SavedGradeVersion = GradeVersion & { student_id: string }
export type GradeSaveResult = { ok: true; versions: SavedGradeVersion[] }

export function isGradeVersion(value: unknown): value is GradeVersion {
  if (!value || typeof value !== 'object') return false
  const v = value as GradeVersion
  return (v.score_id === null && v.revision === null) ||
    (v.score_id === null && typeof v.revision === 'string' && /^[a-f0-9]{64}$/.test(v.revision)) ||
    (typeof v.score_id === 'string' && v.score_id.length > 0 && typeof v.revision === 'number' && Number.isSafeInteger(v.revision) && v.revision >= 0)
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

