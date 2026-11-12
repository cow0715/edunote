import { afterEach, describe, expect, it, vi } from 'vitest'
import { logExamPhotos } from '@/lib/exam-photo-log'

const { createServiceClient } = vi.hoisted(() => ({ createServiceClient: vi.fn() }))
vi.mock('@/lib/supabase/service', () => ({ createServiceClient }))

const weekId = '00000000-0000-4000-8000-000000000001'
const studentId = '00000000-0000-4000-8000-000000000002'
const photoId = '00000000-0000-4000-8000-000000000003'

afterEach(() => {
  vi.resetAllMocks()
  vi.restoreAllMocks()
  vi.unstubAllEnvs()
})

describe('독해 사진 처리 로그', () => {
  it('사진과 답안 없이 유효한 식별자와 처리 결과만 기록한다', async () => {
    vi.stubEnv('VERCEL_DEPLOYMENT_ID', 'dpl_test')
    vi.spyOn(console, 'info').mockImplementation(() => {})
    const insert = vi.fn().mockReturnValue({ abortSignal: vi.fn().mockResolvedValue({ error: null }) })
    createServiceClient.mockReturnValue({ from: vi.fn().mockReturnValue({ insert }) })

    await logExamPhotos(weekId, [{ studentId, photoId }, { studentId, photoId: 'not-a-uuid' }], 'grade_save', 'succeeded', 200)

    expect(insert).toHaveBeenCalledWith([{
      week_id: weekId,
      student_id: studentId,
      photo_id: photoId,
      stage: 'grade_save',
      outcome: 'succeeded',
      http_status: 200,
      deployment_id: 'dpl_test',
    }])
  })

  it('로그 저장 오류가 사진 처리 요청에 전파되지 않는다', async () => {
    vi.spyOn(console, 'info').mockImplementation(() => {})
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    createServiceClient.mockImplementation(() => { throw new Error('service unavailable') })

    await expect(logExamPhotos(weekId, [{ studentId, photoId }], 'upload', 'failed', 503)).resolves.toBeUndefined()
    expect(warn).toHaveBeenCalledWith('[exam-photo] event_write_failed')
  })
})
