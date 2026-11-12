import { describe, expect, it, vi } from 'vitest'
import { createGradeSaveQueue, isGradeVersion, type GradeSaveResult, type GradeVersion } from '@/lib/atomic-grade'

const receipt = (revision: number | null, score_id: string | null = 'score'): GradeSaveResult =>
  ({ ok: true, versions: [{ student_id: 'student', score_id, revision }] })
type Send = (rows: { student_id: string; grade_version: GradeVersion; memo?: string }[]) => Promise<GradeSaveResult>

describe('one editor saving drafts, metadata and grades in sequence', () => {
  it('sends queued edits with the last acknowledged version while retaining their individual contents', async () => {
    const queue = createGradeSaveQueue()
    const version: GradeVersion = { score_id: null, revision: null }
    let finish!: (value: GradeSaveResult) => void
    const first = vi.fn(() => new Promise<GradeSaveResult>((resolve) => { finish = resolve }))
    const second = vi.fn<Send>(async () => receipt(2))
    const a = queue.run([{ student_id: 'student', grade_version: version, memo: 'first' }], first)
    const b = queue.run([{ student_id: 'student', grade_version: version, memo: 'second' }], second)
    await vi.waitFor(() => expect(first).toHaveBeenCalledOnce())
    expect(second).not.toHaveBeenCalled()
    finish(receipt(1))
    await Promise.all([a, b])
    expect(second.mock.calls[0][0][0]).toMatchObject({ memo: 'second', grade_version: { score_id: 'score', revision: 1 } })
    expect(queue.resolve(version)).toEqual({ score_id: 'score', revision: 2 })
  })
  it('does not upgrade an independent stale snapshot even when its numeric version matches an older own save', async () => {
    const queue = createGradeSaveQueue()
    const own = { score_id: 'score', revision: 1 }, other = { ...own }
    await queue.run([{ student_id: 'student', grade_version: own }], async () => receipt(2))
    const send = vi.fn<Send>(async () => { throw Error('409') })
    await expect(queue.run([{ student_id: 'student', grade_version: other }], send)).rejects.toThrow('409')
    expect(send.mock.calls[0][0][0].grade_version).toEqual(other)
    expect(queue.resolve(other)).toBe(other)
  })
  it('does not poison later saves or advance the version after a failed request', async () => {
    const queue = createGradeSaveQueue(), version = { score_id: 'score', revision: 1 }
    const rows = [{ student_id: 'student', grade_version: version }]
    await expect(queue.run(rows, async () => { throw Error('offline') })).rejects.toThrow('offline')
    expect(queue.resolve(version)).toBe(version)
    const send = vi.fn<Send>(async () => receipt(2))
    await queue.run(rows, send)
    expect(send.mock.calls[0][0][0].grade_version).toEqual(version)
  })
  it('supports a no-op save and deletion followed by creation without version cycles', async () => {
    const queue = createGradeSaveQueue(), version = { score_id: 'score', revision: 1 }
    const rows = [{ student_id: 'student', grade_version: version }]
    await queue.run(rows, async () => receipt(1))
    await queue.run(rows, async () => receipt(null, null))
    const send = vi.fn<Send>(async () => receipt(3, 'new-score'))
    await queue.run(rows, send)
    expect(send.mock.calls[0][0][0].grade_version).toEqual({ score_id: null, revision: null })
    expect(queue.resolve(version)).toEqual({ score_id: 'new-score', revision: 3 })
  })
  it('does not adopt a missing or invalid save receipt', async () => {
    const queue = createGradeSaveQueue(), version = { score_id: 'score', revision: 1 }
    await expect(queue.run([{ student_id: 'student', grade_version: version }], async () => ({ ok: true, versions: [] })))
      .rejects.toThrow('저장 결과')
    expect(queue.resolve(version)).toBe(version)
  })
  it('requires either a complete score version or an explicit unsaved sentinel', () => {
    expect(isGradeVersion({ score_id: null, revision: null })).toBe(true)
    for (const invalid of [undefined, {}, { score_id: 'score', revision: null }, { score_id: null, revision: 1 }, { score_id: 'score', revision: -1 }]) {
      expect(isGradeVersion(invalid)).toBe(false)
    }
  })
})
