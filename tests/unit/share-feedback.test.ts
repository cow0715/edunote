import { describe, expect, it } from 'vitest'
import { shareErrorMessage } from '@/app/share/[token]/share-feedback'

describe('공유 리포트 조회 오류', () => {
  it.each([undefined, 500, 503, 429])('일시적 오류 %s는 링크 오류로 안내하지 않고 재시도한다', (status) => {
    expect(shareErrorMessage(status)).toMatchObject({ title: '리포트를 불러오지 못했어요', retryable: true })
  })
  it.each([400, 403, 404, 410])('접근 불가능한 링크 %s는 반복 재시도 대신 안내한다', (status) => {
    expect(shareErrorMessage(status).retryable).toBe(false)
  })
})
