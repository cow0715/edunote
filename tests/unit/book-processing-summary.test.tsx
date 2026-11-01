// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { BookProcessingSummary } from '@/components/exam-bank/book-processing-summary'

afterEach(() => { cleanup(); vi.unstubAllGlobals() })
function show(documentId: string, bankId: string | null = 'bank', total = 120) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } })
  render(<QueryClientProvider client={client}><BookProcessingSummary documentId={documentId} bankId={bankId} total={total} status="review" /></QueryClientProvider>)
  return client
}
it('shows live saved counts, historical hold reasons and costs in processing, and links to the normal material list without mutations', async () => {
  const fetch = vi.fn(async () => Response.json(Array.from({ length: 116 }, (_, i) => ({ source_key: `saved:${i}` }))))
  vi.stubGlobal('fetch', fetch)
  const client = show('20ff4edc-8f08-4f73-a096-e2363a2f166b')
  expect(await screen.findByText('116문항을 문제은행에서 사용할 수 있어요')).toBeTruthy()
  expect(screen.getByText('120문항 중 116문항 저장 · 4문항 미저장')).toBeTruthy()
  expect(screen.getByRole('link', { name: '저장된 116문항 보기' }).getAttribute('href')).toBe('/exam-bank?tab=list&material=bank')
  fireEvent.click(screen.getByRole('button', { name: '확인할 문항 4' }))
  fireEvent.click(screen.getByRole('button', { name: 'Mini Test 3회 13번' }))
  expect(screen.getByText(/밑줄 번호 ③이 두 번/)).toBeTruthy()
  expect(screen.getByTitle('Mini Test 3회 13번 원본 PDF').getAttribute('src')).toContain('page=103')
  fireEvent.click(screen.getByRole('button', { name: '비용 내역' }))
  expect(screen.getByText('이전 복구의 추가 AI 비용 $0')).toBeTruthy()
  expect(screen.getByText(/실시간 청구액이 아닙니다/)).toBeTruthy()
  expect(fetch.mock.calls.length).toBe(1)
  client.clear()
})
it('excludes recovered keys from historical holds and does not show another book’s costs', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => Response.json([{ source_key: 'reading:mini_test:2:8' }])))
  const client = show('20ff4edc-8f08-4f73-a096-e2363a2f166b', 'bank', 4)
  await screen.findByText('1문항을 문제은행에서 사용할 수 있어요')
  fireEvent.click(screen.getByRole('button', { name: '확인할 문항 3' }))
  expect(screen.queryByRole('button', { name: 'Mini Test 2회 8번' })).toBeNull()
  client.clear(); cleanup()
  const other = show('other', null, 10)
  fireEvent.click(screen.getByRole('button', { name: '비용 내역' }))
  expect(screen.queryByText(/\$4.56/)).toBeNull()
  expect(screen.getByText(/이 교재의 비용을 이 화면에서 확정할 수 없습니다/)).toBeTruthy()
  other.clear()
})
it('keeps a failed count lookup distinct from zero saved and permits read-only retry', async () => {
  const fetch = vi.fn().mockResolvedValueOnce(Response.json({ error: 'failed' }, { status: 503 })).mockResolvedValueOnce(Response.json([]))
  vi.stubGlobal('fetch', fetch)
  const client = show('other')
  expect(await screen.findByRole('alert')).toBeTruthy()
  expect(screen.queryByText('아직 문제은행에 저장된 문항이 없어요')).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: '저장 결과 다시 확인' }))
  expect(await screen.findByText('아직 문제은행에 저장된 문항이 없어요')).toBeTruthy()
  client.clear()
})
it('finds the partially recovered bank even when the original document was never published', async () => {
  const fetch = vi.fn(async () => Response.json([{ source_key: 'saved:1' }]))
  vi.stubGlobal('fetch', fetch)
  const client = show('20ff4edc-8f08-4f73-a096-e2363a2f166b', null)
  await screen.findByText('1문항을 문제은행에서 사용할 수 있어요')
  expect(vi.mocked(globalThis.fetch).mock.calls[0][0]).toBe('/api/exam-bank/f5c4b658-42f6-42ca-9fd6-1699fa3a03f6/questions')
  client.clear()
})
