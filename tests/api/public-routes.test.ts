/**
 * 토큰 기반 공개 라우트 — 학부모/학생에게 노출되는 표면.
 *
 * 로그인이 필요 없어서 개발 서버만 떠 있으면 바로 돈다.
 * 읽기(GET)만 한다 — 쓰기/문자발송/백업은 실제 부수효과가 있어 제외한다.
 */

import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import {
  MISSING_TOKEN,
  announcePrerequisites,
  announceSkip,
  apiGet,
  baseUrl,
  checkDb,
  checkServer,
  expectClientError,
  expectJson,
  findPublishedMockExamReportToken,
  findPublishedReportCardToken,
  findShareToken,
  pageGet,
} from './_harness'

// 사전 조건을 먼저 확인한다 (top-level await — vitest 지원)
const serverUp = await checkServer()
const dbStatus = await checkDb()

// DB가 살아있을 때만 fixture 를 찾는다.
// 죽은 DB에서 조회하면 "토큰 없음"으로 보여서 원인을 오해하게 된다.
const shareToken = dbStatus.reachable ? await findShareToken() : null
const reportCardToken = dbStatus.reachable ? await findPublishedReportCardToken() : null
const mockReportToken = dbStatus.reachable ? await findPublishedMockExamReportToken() : null

announcePrerequisites([
  { label: '개발 서버', ok: serverUp, detail: '`npm run dev` 로 띄운 뒤 다시 실행하세요' },
  { label: '개발 DB 접속', ok: dbStatus.reachable, detail: dbStatus.reason },
  { label: '공유 토큰 (재원 학생)', ok: !!shareToken, detail: dbStatus.reachable ? '해당 데이터 없음' : 'DB 접속 실패로 확인 못 함' },
  { label: '발행된 성적표', ok: !!reportCardToken, detail: dbStatus.reachable ? '해당 데이터 없음' : 'DB 접속 실패로 확인 못 함' },
  { label: '발행된 모의고사 리포트', ok: !!mockReportToken, detail: dbStatus.reachable ? '해당 데이터 없음' : 'DB 접속 실패로 확인 못 함' },
])

// ── 스키마 ───────────────────────────────────────────────────────────────────

const periodOption = z.object({
  id: z.string(),
  class_id: z.string(),
  class_name: z.string(),
  class_type: z.string(),
  label: z.string(),
  is_active_class: z.boolean(),
})

const shareSchema = z.object({
  student: z.object({ id: z.string(), name: z.string() }).loose(),
  classes: z.array(z.object({ id: z.string(), name: z.string() }).loose()),
  currentPeriod: z.object({ id: z.string(), label: z.string() }).loose().nullable(),
  periodOptions: z.array(periodOption.loose()),
  weeks: z.array(z.object({ id: z.string(), week_number: z.number() }).loose()),
  weekScores: z.array(z.unknown()),
  studentAnswers: z.array(z.unknown()),
  vocabAnswers: z.array(z.unknown()),
  vocabWords: z.array(z.unknown()),
  attendance: z.array(z.unknown()),
  clinicAttendance: z.array(z.unknown()),
  classAverages: z.record(
    z.string(),
    z.object({ readingRate: z.number().nullable(), vocabRate: z.number().nullable() }),
  ),
})

// ── /api/share/[token] ───────────────────────────────────────────────────────

describe.skipIf(!serverUp)('GET /api/share/[token]', () => {
  it.skipIf(!shareToken)('학부모 대시보드 데이터를 규격대로 돌려준다', async () => {
    const data = expectJson(await apiGet(`/api/share/${shareToken}`), shareSchema)
    expect(data.student.id).toBeTruthy()
  })

  it.skipIf(!shareToken)('주차마다 반 평균 항목이 있다', async () => {
    const data = expectJson(await apiGet(`/api/share/${shareToken}`), shareSchema)
    for (const week of data.weeks) {
      expect(Object.keys(data.classAverages), `week ${week.id} 의 반 평균 누락`).toContain(week.id)
    }
  })

  it.skipIf(!shareToken)('기본 화면에는 비활성 반의 기간이 선택되지 않는다', async () => {
    const data = expectJson(await apiGet(`/api/share/${shareToken}`), shareSchema)
    if (!data.currentPeriod) return
    const selected = data.periodOptions.find((option) => option.id === data.currentPeriod!.id)
    expect(selected?.is_active_class).toBe(true)
  })

  // 특강반 분리(커밋 ccea5bc)에서 깨졌던 부분 — 기간을 고르면 그 반만 남아야 한다
  it.skipIf(!shareToken)('periodId 를 주면 해당 반 하나로 좁혀진다', async () => {
    const base = expectJson(await apiGet(`/api/share/${shareToken}`), shareSchema)
    const target = base.periodOptions.find((option) => option.is_active_class)
    if (!target) return announceSkip('periodId 필터', '활성 반 기간이 없음')

    const scoped = expectJson(await apiGet(`/api/share/${shareToken}?periodId=${target.id}`), shareSchema)
    expect(scoped.classes.map((c) => c.id)).toEqual([target.class_id])
    expect(scoped.currentPeriod?.id).toBe(target.id)
  })

  it('없는 토큰이면 4xx 로 답한다 (500 으로 터지지 않음)', async () => {
    expectClientError(await apiGet(`/api/share/${MISSING_TOKEN}`))
  })

  it('없는 기간 id 를 주면 4xx 로 답한다', async () => {
    if (!shareToken) return announceSkip('없는 기간 id', '공유 토큰 없음')
    expectClientError(await apiGet(`/api/share/${shareToken}?periodId=${MISSING_TOKEN}`))
  })
})

// ── /api/share/[token]/retake/[weekId] ───────────────────────────────────────

describe.skipIf(!serverUp)('GET /api/share/[token]/retake/[weekId]', () => {
  it.skipIf(!shareToken)('주차 단어 재시험 데이터를 돌려준다', async () => {
    const base = expectJson(await apiGet(`/api/share/${shareToken}`), shareSchema)
    const week = base.weeks[0]
    if (!week) return announceSkip('재시험', '이 학생에게 주차 데이터가 없음')

    const response = await apiGet(`/api/share/${shareToken}/retake/${week.id}`)
    // 재시험 대상이 없으면 에러를 줄 수 있다 — 200 이거나 4xx 이면 되고, 500 이면 안 된다
    expect(response.status, `본문: ${response.raw.slice(0, 200)}`).toBeLessThan(500)
  })

  it('없는 주차 id 를 주면 5xx 로 터지지 않는다', async () => {
    if (!shareToken) return announceSkip('없는 주차 id', '공유 토큰 없음')
    const response = await apiGet(`/api/share/${shareToken}/retake/00000000-0000-0000-0000-000000000000`)
    expect(response.status).toBeLessThan(500)
  })
})

// ── 서버 렌더링 공개 페이지 ───────────────────────────────────────────────────

describe.skipIf(!serverUp)('공개 성적표 페이지', () => {
  it.skipIf(!reportCardToken)('발행된 성적표가 200 으로 그려진다', async () => {
    const page = await pageGet(`/report-cards/${reportCardToken}`)
    expect(page.status).toBe(200)
    expect(page.html).not.toContain('Application error')
  })

  it.skipIf(!mockReportToken)('발행된 모의고사 리포트가 200 으로 그려진다', async () => {
    const page = await pageGet(`/mock-exam-reports/${mockReportToken}`)
    expect(page.status).toBe(200)
    expect(page.html).not.toContain('Application error')
  })

  it('없는 토큰이어도 5xx 로 터지지 않는다', async () => {
    expect((await pageGet(`/report-cards/${MISSING_TOKEN}`)).status).toBeLessThan(500)
    expect((await pageGet(`/mock-exam-reports/${MISSING_TOKEN}`)).status).toBeLessThan(500)
  })
})

// ── 인증 경계 ────────────────────────────────────────────────────────────────
// 공개 라우트가 아닌 것이 실수로 열리지 않았는지 확인한다.

describe.skipIf(!serverUp)('인증 경계', () => {
  const protectedPaths = [
    '/api/classes',
    '/api/students',
    '/api/exam-bank',
    '/api/mock-exams',
    '/api/report-cards',
    '/api/weeks/today',
    '/api/admin/teachers',
  ]

  it.each(protectedPaths)('%s 는 로그인 없이 데이터를 주지 않는다', async (pathname) => {
    const response = await apiGet(pathname)
    // 로그인으로 리다이렉트(3xx) 하거나 401/403 이어야 한다. 200 이면 데이터가 새는 것이다.
    expect(response.status, `본문: ${response.raw.slice(0, 200)}`).toBeGreaterThanOrEqual(300)
  })

  it('pdf-extract presign 은 로그인 없이 업로드 URL 을 발급하지 않는다', async () => {
    const response = await fetch(`${baseUrl()}/api/pdf-extract/presign`, { method: 'POST', redirect: 'manual' })
    expect(response.status).not.toBe(200)
  })
})
