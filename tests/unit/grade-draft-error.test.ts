// @vitest-environment jsdom
import { createElement, type ReactNode } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, cleanup, renderHook } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { useSaveGradeDraft, useSaveWeekScore, type GradeRow } from '@/hooks/use-grade'
import { createGradeSaveQueue } from '@/lib/atomic-grade'

const m = vi.hoisted(() => ({ error: vi.fn() }))
vi.mock('sonner', () => ({ toast: { error: m.error } }))
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.clearAllMocks() })

it('사진 검증 실패로 임시저장이 거절되면 성공 취급하지 않고 오류를 알린다', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, json: async () => ({ error: '사진 파일을 확인하지 못했습니다.' }) })))
  const client = new QueryClient({ defaultOptions: { mutations: { retry: false } } })
  const wrapper = ({ children }: { children: ReactNode }) => createElement(QueryClientProvider, { client }, children)
  const { result } = renderHook(() => useSaveGradeDraft('week'), { wrapper })
  await act(async () => {
    await expect(result.current.mutateAsync([])).rejects.toThrow('사진 파일을 확인하지 못했습니다.')
  })
  expect(m.error).toHaveBeenCalledWith('사진 파일을 확인하지 못했습니다.')
  client.clear()
})

it('메모 저장과 연속 임시저장은 같은 큐에서 성공한 버전을 이어 사용한다', async () => {
  const queue = createGradeSaveQueue()
  const row: GradeRow = { student_id: 'student', student_name: '가상 학생', present: true, reading_present: true,
    grade_version: { score_id: 'score', revision: 7 }, vocab_correct: null, reading_correct: null,
    homework_done: 2, memo: 'new memo', answers: [] }
  const fetchMock = vi.fn(async () => Response.json({ ok: true, versions: [{ student_id: 'student', score_id: 'score', revision: 8 }] }))
  vi.stubGlobal('fetch', fetchMock)
  const client = new QueryClient({ defaultOptions: { mutations: { retry: false } } })
  const wrapper = ({ children }: { children: ReactNode }) => createElement(QueryClientProvider, { client }, children)
  const { result } = renderHook(() => ({ metadata: useSaveWeekScore('week', queue), draft: useSaveGradeDraft('week', queue) }), { wrapper })
  await act(async () => {
    await Promise.all([result.current.metadata.mutateAsync(row), result.current.draft.mutateAsync([row])])
  })
  const calls = (fetchMock.mock.calls as unknown as [string, RequestInit][])
  expect(calls[0][1].method).toBe('PATCH')
  expect(JSON.parse(calls[0][1].body as string).grade_version.revision).toBe(7)
  expect(JSON.parse(calls[1][1].body as string)).toMatchObject({ skip_ai: true, rows: [{ grade_version: { revision: 8 } }] })
  client.clear()
})
