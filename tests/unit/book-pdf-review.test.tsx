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
  it('distinguishes registered and detected years and names the metadata hold',async()=>{
    vi.stubGlobal('fetch',vi.fn(async()=>Response.json({document:{...document(),status:'review',manifest:{...manifest,printed_years:[2023],classification_error:'선택한 2027학년도와 감지된 2023학년도가 다릅니다.',unit_count:105}},units:[]})))
    const client=new QueryClient({defaultOptions:{queries:{retry:false,gcTime:0}}})
    render(<QueryClientProvider client={client}><BookResult id="doc" /></QueryClientProvider>)
    expect(await screen.findByText(/등록 학년도: 2027 · PDF 학년도 표기: 2023/)).toBeTruthy()
    expect(screen.getByText(/교재 분류 검사에서 등록을 보류/)).toBeTruthy()
    expect(screen.queryByText(/원문 문항 경계를 확정할 수 없어/)).toBeNull()
    client.clear()
  })
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
