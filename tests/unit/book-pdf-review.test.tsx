// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { BookResult } from '@/components/exam-bank/book-import-panel'
import { document, draft, manifest } from '../fixtures/book-pdf'
import { nativeFixture } from '../fixtures/book-native'
vi.mock('@/components/pdf-import/job-list', () => ({ PdfImportJobList: () => null }))
vi.mock('@/lib/supabase/client', () => ({ createClient: vi.fn() }))
afterEach(() => { cleanup(); vi.unstubAllGlobals() })
describe('automatic import result UI', () => {
  it('shows automatic results without per-question approval controls', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (url === '/api/book-pdf') return Response.json({ enabled: true, documents: [{ id: 'doc', title: '교재', status: 'published' }] })
      if (url.includes('/units/')) {
        const f = nativeFixture()
        const u = draft()
        u.extraction!.questions[0].solution = '<strong><u>원문 해설</u></strong>'
        return Response.json({ ...u, verification: f.proof, enrichment: f.enrichment })
      }
      const u = draft()
      return Response.json({ document: { ...document(), status: 'published', manifest: { ...manifest, units: undefined, unit_count: 1 } },
        units: [{ ...u, manifest: undefined, pages: u.manifest.pages, questions: u.manifest.questions, has_extraction: true }] })
    }))
    const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } })
    render(<QueryClientProvider client={client}><BookResult id="doc" /></QueryClientProvider>)
    expect(await screen.findByText(/1\/1묶음 자동 검증 통과/)).toBeTruthy()
    expect(screen.queryByRole('button', { name: '원문 확인 완료' })).toBeNull()
    expect(screen.queryByRole('button', { name: '문제은행에 등록' })).toBeNull()
    fireEvent.click(screen.getByText('전체 처리 내역 1묶음'))
    fireEvent.click(await screen.findByRole('button', { name: /1강 1번/ }))
    expect(await screen.findByTitle('교재 원본 PDF')).toBeTruthy()
    expect(await screen.findByText('AI 보완 풀이')).toBeTruthy()
    expect(await screen.findByText('추가 설명')).toBeTruthy()
    expect(screen.getByText('원문 해설', { selector: 'h3' })).toBeTruthy()
    expect(screen.getByText('원문 해설', { selector: 'strong u' })).toBeTruthy()
    expect(screen.queryByRole('checkbox')).toBeNull()
    client.clear()
  })
})
